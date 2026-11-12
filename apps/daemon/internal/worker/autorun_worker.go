package worker

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"time"

	"zenf/internal/adaptor"
	"zenf/internal/domain"
	"zenf/internal/runner"
	"zenf/internal/service"
)

// TaskStorage defines the persistence operations needed by the background worker.
type TaskStorage interface {
	service.TaskStorage
	ListTasks(ctx context.Context, filter domain.TaskFilter) ([]domain.Task, error)
	GetAgent(ctx context.Context, slug string) (*domain.Agent, error)
	GetProject(ctx context.Context, slug string) (*domain.Project, error)
	GetResourceByKey(ctx context.Context, projectSlug string, key string) (*domain.Resource, error)
	ListResources(ctx context.Context, filter domain.ResourceFilter) ([]domain.Resource, error)
	RecordArtifact(ctx context.Context, artifact domain.Artifact) error
}

// Broadcaster is the interface used to publish domain event notifications.
type Broadcaster interface {
	Broadcast(evt domain.EventMessage)
}

// DefaultMaxConcurrency bounds parallel background task executions.
const DefaultMaxConcurrency = 4

// AutoRunWorker coordinates the autonomous background execution of tasks marked
// with auto_run. It continuously scans for READY tasks, verifies typed agent
// predicate gates, interpolates runner templates, streams live NDJSON to WebSockets,
// and finalizes task status when the process exits.
type AutoRunWorker struct {
	storage         TaskStorage
	runnerRegistry  *runner.SessionRegistry
	broadcaster     Broadcaster
	taskService     service.TaskService
	interval        time.Duration
	predicateEngine *domain.TypedPredicateEngine
	streamFormatter *StreamFormatter
	sem             chan struct{}
	running         sync.Map // taskID -> struct{}
}

// NewAutoRunWorker constructs a new AutoRunWorker with explicit dependencies.
func NewAutoRunWorker(
	storage TaskStorage,
	runnerRegistry *runner.SessionRegistry,
	broadcaster Broadcaster,
	interval time.Duration,
) *AutoRunWorker {
	if interval <= 0 {
		interval = 1 * time.Second
	}
	return &AutoRunWorker{
		storage:         storage,
		runnerRegistry:  runnerRegistry,
		broadcaster:     broadcaster,
		taskService:     service.NewTaskService(storage, runnerRegistry, broadcaster),
		interval:        interval,
		predicateEngine: domain.NewTypedPredicateEngine(),
		streamFormatter: NewStreamFormatter(),
		sem:             make(chan struct{}, DefaultMaxConcurrency),
	}
}

// SetTaskService overrides the task application service (e.g. for testing).
func (w *AutoRunWorker) SetTaskService(svc service.TaskService) {
	w.taskService = svc
}

// Start launches the background polling loop. It terminates when ctx is cancelled.
func (w *AutoRunWorker) Start(ctx context.Context) {
	ticker := time.NewTicker(w.interval)
	go func() {
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				w.Tick(ctx)
			}
		}
	}()
}

// Tick performs a single evaluation pass for eligible auto_run tasks.
func (w *AutoRunWorker) Tick(ctx context.Context) {
	trueVal := true
	tasks, err := w.storage.ListTasks(ctx, domain.TaskFilter{
		Status:  domain.StatusReady,
		AutoRun: &trueVal,
	})
	if err != nil || len(tasks) == 0 {
		return
	}

	for _, task := range tasks {
		if _, loaded := w.running.LoadOrStore(task.ID, struct{}{}); loaded {
			continue
		}

		select {
		case w.sem <- struct{}{}:
			go func(t domain.Task) {
				defer func() { <-w.sem }()
				w.executeTask(ctx, t)
			}(task)
		default:
			// Concurrency ceiling reached; release claim guard and retry on next tick
			w.running.Delete(task.ID)
			return
		}
	}
}

func (w *AutoRunWorker) executeTask(ctx context.Context, task domain.Task) {
	defer w.running.Delete(task.ID)

	sessionID := fmt.Sprintf("sess-worker-%s-%d", task.ID, time.Now().UnixNano())

	// 1. Fetch Agent definition if assigned
	var agent *domain.Agent
	if task.AgentSlug != "" {
		if a, err := w.storage.GetAgent(ctx, task.AgentSlug); err == nil && a != nil {
			agent = a
		}
	}

	// 2. Evaluate Typed Predicate Engine Gate against the effective skill set
	// (soul baseline union task extras).
	activeClaims := w.activeClaimsForAgent(task.AgentSlug)
	evalRes := w.predicateEngine.Evaluate(task, agent, activeClaims, w.resolveSoulSkills(ctx, task, agent))
	if !evalRes.Passed {
		return
	}

	workerID := task.AgentSlug
	if workerID == "" {
		workerID = "auto-runner"
	}

	// 3. Atomic claim
	_, err := w.storage.ClaimTask(ctx, task.ID, domain.ClaimOptions{
		WorkerID:  workerID,
		SessionID: sessionID,
	})
	if err != nil {
		return
	}

	// 4. Broadcast RUNNING state
	if w.broadcaster != nil {
		w.broadcaster.Broadcast(domain.EventMessage{
			TaskID:    task.ID,
			Type:      "task.status",
			Payload:   eventPayload(map[string]string{"task_id": task.ID, "status": string(domain.StatusRunning)}),
			Timestamp: time.Now().UTC(),
		})
	}

	// 5. Resolve execution directory. Draft projects often carry a root_path that
	// does not exist yet (e.g. a slug typed into the form); passing that to
	// cmd.Dir makes the runner fail with "chdir ...: no such file or directory".
	workDir := task.WorktreePath
	if workDir == "" && task.ProjectSlug != "" {
		if proj, err := w.storage.GetProject(ctx, task.ProjectSlug); err == nil && proj != nil && proj.RootPath != "" {
			workDir = proj.RootPath
		}
	}
	if workDir != "" && !isUsableDir(workDir) {
		workDir = ""
	}
	if workDir == "" {
		workDir, _ = os.Getwd()
	}

	// 6. Assemble execution command with template interpolation
	timeoutSec := 900
	if agent != nil && agent.StopConditions.TimeoutSeconds > 0 {
		timeoutSec = agent.StopConditions.TimeoutSeconds
	}

	var prompt string
	if len(task.VerificationCommands) > 0 {
		prompt = strings.Join(task.VerificationCommands, " && ")
	} else if task.Description != "" {
		prompt = fmt.Sprintf("%s: %s", task.Title, task.Description)
	} else {
		prompt = task.Title
	}

	var runnerTmpl string
	if agent != nil {
		runnerTmpl = agent.Runner
	}

	ad := adaptor.DefaultRegistry().Resolve(runnerTmpl)
	spec := adaptor.ExecutionSpec{
		TaskID:         task.ID,
		Title:          task.Title,
		Prompt:         prompt,
		WorkDir:        workDir,
		TimeoutSeconds: timeoutSec,
		RunnerTemplate: runnerTmpl,
		ExtraArgs:      task.VerificationCommands,
	}
	cmdSpec := ad.BuildCommand(spec)
	cmdStr := cmdSpec.ShellCmd

	var shell string
	var args []string
	if runtime.GOOS == "windows" {
		shell = "cmd.exe"
		args = []string{"/c", cmdStr}
	} else {
		shell = "sh"
		args = []string{"-c", cmdStr}
	}

	// Enforce hard execution timeout context
	runCtx, cancel := context.WithTimeout(ctx, time.Duration(timeoutSec)*time.Second)
	defer cancel()

	cmd := exec.CommandContext(runCtx, shell, args...)
	cmd.Dir = workDir
	cmd.Env = os.Environ()

	// 7. Allocate ProcessRunner with stream-json line formatter hook
	rnr := runner.NewProcessRunner(runner.ModeHeadless, 1024*1024)
	rnr.SetLineTransformer(w.streamFormatter.FormatLine)

	if w.runnerRegistry != nil {
		_ = w.runnerRegistry.Register(sessionID, rnr)
	}

	// 8. Launch headless process
	if err := rnr.StartHeadless(cmd); err != nil {
		if w.runnerRegistry != nil {
			w.runnerRegistry.Unregister(sessionID)
		}
		if w.taskService != nil {
			_, _ = w.taskService.TransitionTask(context.Background(), task.ID, service.TransitionRequest{
				Action: "FAIL",
				Reason: "Failed to start headless runner process: " + err.Error(),
			})
		} else {
			_ = w.storage.UpdateTaskStatus(context.Background(), task.ID, domain.StatusRunning, domain.StatusFailed)
			if w.broadcaster != nil {
				w.broadcaster.Broadcast(domain.EventMessage{
					TaskID:    task.ID,
					Type:      "task.status",
					Payload:   eventPayload(map[string]string{"task_id": task.ID, "status": string(domain.StatusFailed)}),
					Timestamp: time.Now().UTC(),
				})
			}
		}
		return
	}

	// 9. Wait for completion
	exitCode, waitErr := rnr.Wait()

	finalStatus := domain.StatusCompleted
	if waitErr != nil || exitCode != 0 {
		if agent != nil && agent.StopConditions.OnFailure == "AWAITING_REVIEW" {
			finalStatus = domain.StatusAwaitingReview
		} else {
			finalStatus = domain.StatusFailed
		}
	}

	// 10. Capture execution output and persist as artifact + task notes
	output := rnr.Buffer().Snapshot()
	var noteSummary string
	if len(output) > 0 {
		homeDir, _ := os.UserHomeDir()
		artDir := filepath.Join(homeDir, ".zenforge", "artifacts")
		_ = os.MkdirAll(artDir, 0755)

		fileName := fmt.Sprintf("%s-output.log", task.ID)
		filePath := filepath.Join(artDir, fileName)
		if err := os.WriteFile(filePath, output, 0644); err == nil {
			h := sha256.Sum256(output)
			hashStr := hex.EncodeToString(h[:])
			_ = w.storage.RecordArtifact(ctx, domain.Artifact{
				ID:        fmt.Sprintf("art-%s-%d", task.ID, time.Now().Unix()),
				TaskID:    task.ID,
				Role:      domain.ArtifactRoleOutput,
				Name:      fmt.Sprintf("%s Execution Log", task.ID),
				Type:      domain.ArtifactTypeFile,
				FilePath:  filePath,
				MimeType:  "text/plain",
				ByteSize:  int64(len(output)),
				Sha256:    hashStr,
				CreatedAt: time.Now().UTC(),
			})
		}

		const maxNoteLen = 4000
		outText := string(output)
		if len(outText) > maxNoteLen {
			noteSummary = fmt.Sprintf("Execution Output (Exit Code %d):\n%s\n\n... [Output truncated. Full %d bytes saved to Artifacts]", exitCode, outText[:maxNoteLen], len(output))
		} else {
			noteSummary = fmt.Sprintf("Execution Output (Exit Code %d):\n%s", exitCode, outText)
		}
	} else if waitErr != nil {
		noteSummary = fmt.Sprintf("Execution failed: %v", waitErr)
	}

	if w.taskService != nil {
		action := "COMPLETE"
		if finalStatus == domain.StatusAwaitingReview {
			action = "REQUEST_REVIEW"
		} else if finalStatus == domain.StatusFailed {
			action = "FAIL"
		}
		_, _ = w.taskService.TransitionTask(context.Background(), task.ID, service.TransitionRequest{
			Action:  action,
			Summary: noteSummary,
			Notes:   noteSummary,
			Reason:  noteSummary,
		})
	} else {
		if noteSummary != "" {
			_ = w.storage.UpdateTaskStatusWithNote(context.Background(), task.ID, domain.StatusRunning, finalStatus, noteSummary)
		} else {
			_ = w.storage.UpdateTaskStatus(context.Background(), task.ID, domain.StatusRunning, finalStatus)
		}

		if w.broadcaster != nil {
			w.broadcaster.Broadcast(domain.EventMessage{
				TaskID:    task.ID,
				Type:      "task.status",
				Payload:   eventPayload(map[string]string{"task_id": task.ID, "status": string(finalStatus)}),
				Timestamp: time.Now().UTC(),
			})
		}
	}
}

// resolveSoulSkills loads the soul bound to the agent and returns its declared
// skills. A missing or non-soul key yields no skills so dispatch falls back to
// the task's own requirements.
func (w *AutoRunWorker) resolveSoulSkills(ctx context.Context, task domain.Task, agent *domain.Agent) []string {
	if agent == nil || agent.SoulKey == "" {
		return nil
	}
	soul := domain.ResolveSoul(ctx, w.storage, task.ProjectSlug, agent.SoulKey)
	if soul == nil {
		return nil
	}
	return soul.Skills
}

func (w *AutoRunWorker) activeClaimsForAgent(agentSlug string) int {
	if agentSlug == "" {
		return 0
	}
	tasks, err := w.storage.ListTasks(context.Background(), domain.TaskFilter{
		AgentSlug: agentSlug,
		Status:    domain.StatusRunning,
	})
	if err != nil {
		return 0
	}
	return len(tasks)
}

func eventPayload(value any) string {
	encoded, err := json.Marshal(value)
	if err != nil {
		return "{}"
	}
	return string(encoded)
}

// isUsableDir reports whether path exists and is a directory. Autorun falls back
// to the daemon working directory when a project's root_path is unusable.
func isUsableDir(path string) bool {
	info, err := os.Stat(path)
	return err == nil && info.IsDir()
}
