package gateway

import (
	"context"
	"embed"
	"fmt"
	"io/fs"
	"log"
	"net"
	"net/http"
	"net/url"
	"sync"
	"time"

	"zenf/internal/domain"
	"zenf/internal/runner"
	"zenf/internal/service"
	"zenf/internal/worker"
)

//go:embed all:web_dist
var defaultWebDist embed.FS

// CreatePlanRequest specifies the payload for plan ingestion via REST.

// Storage is the subset of persistence the HTTP gateway needs. It composes
// per-aggregate interfaces so each repository stays independently replaceable.
type Storage interface {
	domain.ProjectRepository
	domain.PlanRepository
	domain.TaskRepository
	domain.TaskLifecycle
	domain.ResourceRepository
	domain.AgentRepository
	domain.ArtifactRepository
	domain.EventRepository
	domain.SearchRepository
}

// Server provides the HTTP/SSE gateway for the zenf control plane.
type Server struct {
	storage Storage

	sseMu      sync.RWMutex
	sseClients map[chan domain.EventMessage]struct{}

	watchMu     sync.Mutex
	watchCancel context.CancelFunc

	done     chan struct{}
	doneOnce sync.Once

	startedAt time.Time
	envOnce   sync.Once
	envInfo   map[string]any

	mux            *http.ServeMux
	httpServer     *http.Server
	webFS          fs.FS
	runnerRegistry *runner.SessionRegistry
	taskService    service.TaskService
	autoRunWorker  *worker.AutoRunWorker
}

// NewServer constructs a new Gateway Server.
func NewServer(storage Storage) *Server {
	sub, err := fs.Sub(defaultWebDist, "web_dist")
	var webFS fs.FS
	if err == nil {
		webFS = sub
	}

	s := &Server{
		storage:        storage,
		sseClients:     make(map[chan domain.EventMessage]struct{}),
		done:           make(chan struct{}),
		startedAt:      time.Now(),
		mux:            http.NewServeMux(),
		webFS:          webFS,
		runnerRegistry: runner.NewSessionRegistry(),
	}
	s.taskService = service.NewTaskService(storage, s.runnerRegistry, s)
	s.autoRunWorker = worker.NewAutoRunWorker(storage, s.runnerRegistry, s, 1*time.Second)

	s.setupRoutes()
	return s
}

// TaskService returns the task application service attached to the server.
func (s *Server) TaskService() service.TaskService {
	return s.taskService
}

// SetTaskService overrides the task application service (e.g. for testing).
func (s *Server) SetTaskService(svc service.TaskService) {
	s.taskService = svc
}

// RunnerRegistry returns the runner session registry instance attached to the server.
func (s *Server) RunnerRegistry() *runner.SessionRegistry {
	return s.runnerRegistry
}

// AutoRunWorker returns the auto-run background worker attached to the server.
func (s *Server) AutoRunWorker() *worker.AutoRunWorker {
	return s.autoRunWorker
}

// setupRoutes registers all HTTP and SSE endpoints using Go 1.22+ routing syntax.

func (s *Server) setupRoutes() {
	// Project APIs
	s.mux.HandleFunc("GET /api/v1/projects", s.handleListProjects)
	s.mux.HandleFunc("POST /api/v1/projects", s.handleCreateProject)
	s.mux.HandleFunc("GET /api/v1/projects/{slug}", s.handleGetProject)
	s.mux.HandleFunc("PATCH /api/v1/projects/{slug}", s.handleUpdateProject)
	s.mux.HandleFunc("DELETE /api/v1/projects/{slug}", s.handleDeleteProject)

	// Plan APIs
	s.mux.HandleFunc("GET /api/v1/plans", s.handleListPlans)
	s.mux.HandleFunc("POST /api/v1/plans", s.handleCreatePlan)
	s.mux.HandleFunc("DELETE /api/v1/plans/{slug}", s.handleDeletePlan)
	s.mux.HandleFunc("GET /api/v1/plans/{slug}", s.handleGetPlan)

	// Task APIs
	s.mux.HandleFunc("GET /api/v1/tasks", s.handleListTasks)
	s.mux.HandleFunc("POST /api/v1/tasks", s.handleCreateTask)
	s.mux.HandleFunc("GET /api/v1/tasks/{id}", s.handleGetTask)
	s.mux.HandleFunc("PATCH /api/v1/tasks/{id}", s.handleUpdateTask)
	s.mux.HandleFunc("DELETE /api/v1/tasks/{id}", s.handleDeleteTask)
	s.mux.HandleFunc("POST /api/v1/tasks/{id}/status", s.handleUpdateTaskStatus)
	s.mux.HandleFunc("POST /api/v1/tasks/{id}/dependencies", s.handleUpdateTaskDependencies)
	s.mux.HandleFunc("PATCH /api/v1/tasks/{id}/context", s.handleUpdateTaskContext)
	s.mux.HandleFunc("POST /api/v1/tasks/{id}/claim", s.handleClaimTask)
	s.mux.HandleFunc("POST /api/v1/tasks/{id}/evict", s.handleEvictTask)
	s.mux.HandleFunc("POST /api/v1/tasks/{id}/attachments", s.handleUploadTaskAttachment)
	s.mux.HandleFunc("GET /api/v1/tasks/{id}/artifacts", s.handleListTaskArtifacts)

	// Resource registry
	s.mux.HandleFunc("GET /api/v1/resources", s.handleListResources)
	s.mux.HandleFunc("POST /api/v1/resources", s.handleCreateResource)
	s.mux.HandleFunc("GET /api/v1/resources/search", s.handleSearchResources)
	s.mux.HandleFunc("GET /api/v1/resources/{id}", s.handleGetResource)
	s.mux.HandleFunc("PATCH /api/v1/resources/{id}", s.handleUpdateResource)
	s.mux.HandleFunc("DELETE /api/v1/resources/{id}", s.handleDeleteResource)
	s.mux.HandleFunc("POST /api/v1/resources/{id}/refresh", s.handleRefreshResource)
	s.mux.HandleFunc("GET /api/v1/resources/{id}/files", s.handleListResourceFiles)
	s.mux.HandleFunc("POST /api/v1/resources/{id}/files", s.handleUploadResourceFile)
	s.mux.HandleFunc("DELETE /api/v1/resources/{id}/files/{fileId}", s.handleDeleteResourceFile)

	// Agent definitions
	s.mux.HandleFunc("GET /api/v1/agents", s.handleListAgents)
	s.mux.HandleFunc("POST /api/v1/agents", s.handleCreateAgent)
	s.mux.HandleFunc("GET /api/v1/agents/{slug}", s.handleGetAgent)
	s.mux.HandleFunc("PATCH /api/v1/agents/{slug}", s.handleUpdateAgent)
	s.mux.HandleFunc("DELETE /api/v1/agents/{slug}", s.handleDeleteAgent)
	s.mux.HandleFunc("GET /api/v1/sessions/{id}/terminal", s.handleSessionTerminal)

	// Cross-entity search
	s.mux.HandleFunc("GET /api/v1/search", s.handleSearch)

	// Global Environment & Runtime Telemetry APIs
	s.mux.HandleFunc("GET /api/v1/env/global", s.handleGetGlobalEnv)
	s.mux.HandleFunc("GET /api/v1/status", s.handleGetRuntimeStatus)

	// Activity log + real-time stream
	s.mux.HandleFunc("GET /api/v1/events", s.handleListEvents)
	s.mux.HandleFunc("GET /api/v1/events/stream", s.handleEventStream)

	// Artifact Retrieval API
	s.mux.HandleFunc("GET /api/v1/artifacts/{id}", s.handleGetArtifact)

	// Web UI SPA & Static Files
	s.mux.HandleFunc("GET /", s.handleStaticSPA)
}

// Handler returns the HTTP handler with origin guards applied.
func (s *Server) Handler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !allowRequest(r) {
			writeHttpError(w, "cross-origin request rejected", http.StatusForbidden)
			return
		}

		// The SPA is served same-origin (directly or through the Vite proxy), so
		// CORS is only echoed back for loopback origins.
		if origin := r.Header.Get("Origin"); origin != "" && isLoopbackOrigin(origin) {
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Vary", "Origin")
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS")
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type, X-Requested-With")
		}

		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}

		s.mux.ServeHTTP(w, r)
	})
}

// isLoopbackOrigin accepts http(s) origins whose host is a loopback address on
// any port, which covers the Vite dev server and preview builds.
func isLoopbackOrigin(origin string) bool {
	parsed, err := url.Parse(origin)
	if err != nil {
		return false
	}
	host := parsed.Hostname()
	return host == "localhost" || host == "127.0.0.1" || host == "::1"
}

// allowRequest blocks cross-site browser writes. Requests without an Origin
// header come from the CLI, curl, or an MCP client and are allowed. A browser
// always attaches Origin to a cross-origin mutating request, so rejecting a
// non-loopback Origin closes the CSRF hole without requiring tokens.
func allowRequest(r *http.Request) bool {
	if r.Method == http.MethodGet || r.Method == http.MethodHead || r.Method == http.MethodOptions {
		return true
	}
	origin := r.Header.Get("Origin")
	if origin == "" {
		return true
	}
	return isLoopbackOrigin(origin)
}

// Broadcast distributes an event message to all connected SSE clients. Audit
// persistence is handled by database triggers, so the client sees the same
// activity log regardless of which process performed the write.

func (s *Server) Serve(ln net.Listener) error {
	s.httpServer = &http.Server{
		Handler:           s.Handler(),
		ReadHeaderTimeout: 10 * time.Second,
		IdleTimeout:       120 * time.Second,
	}

	watchCtx, cancel := context.WithCancel(context.Background())
	s.watchMu.Lock()
	s.watchCancel = cancel
	s.watchMu.Unlock()
	go s.watchStateChanges(watchCtx, stateWatchInterval)
	if s.autoRunWorker != nil {
		s.autoRunWorker.Start(watchCtx)
	}

	err := s.httpServer.Serve(ln)
	cancel()
	return err
}

// stateWatchInterval controls how often the gateway fingerprints the SQLite
// state to detect writes from processes outside the daemon event hub. The
// fingerprint is an O(1) revision read, so a sub-second interval is cheap and
// keeps MCP/CLI writes visible almost immediately.
const stateWatchInterval = 1 * time.Second

// watchStateChanges polls the storage fingerprint and broadcasts state.changed
// when an external writer (MCP stdio server, CLI, raw SQLite) commits. This
// keeps SSE as the single update channel for the web cockpit without requiring
// every writer to publish events.
func (s *Server) watchStateChanges(ctx context.Context, interval time.Duration) {
	fp, ok := s.storage.(domain.StateFingerprinter)
	if !ok {
		return
	}

	last, err := fp.StateFingerprint(ctx)
	if err != nil {
		log.Printf("zenf: state watcher disabled, fingerprint failed: %v", err)
		return
	}

	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	var lastErr string
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			current, err := fp.StateFingerprint(ctx)
			if err != nil {
				// Log transitions only: a persistent failure would otherwise
				// spam the log every interval.
				if msg := err.Error(); msg != lastErr {
					log.Printf("zenf: state fingerprint failed: %v", err)
					lastErr = msg
				}
				continue
			}
			lastErr = ""
			if current == last {
				continue
			}
			last = current
			s.Broadcast(domain.EventMessage{
				Type:      "state.changed",
				Payload:   "{}",
				Timestamp: time.Now().UTC(),
			})
		}
	}
}

// Start begins listening on the specified address (e.g. "127.0.0.1:1123" or ":1123").
func (s *Server) Start(addr string) error {
	ln, err := net.Listen("tcp", addr)
	if err != nil {
		return fmt.Errorf("failed to bind address %s: %w", addr, err)
	}
	return s.Serve(ln)
}

// Shutdown gracefully stops the HTTP server. SSE handlers are released through
// the done channel so graceful shutdown does not wait for clients to disconnect.
func (s *Server) Shutdown(ctx context.Context) error {
	s.doneOnce.Do(func() { close(s.done) })

	s.watchMu.Lock()
	if s.watchCancel != nil {
		s.watchCancel()
		s.watchCancel = nil
	}
	s.watchMu.Unlock()

	if s.httpServer != nil {
		return s.httpServer.Shutdown(ctx)
	}
	return nil
}
