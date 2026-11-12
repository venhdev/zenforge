package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"zenf/internal/domain"
	"zenf/internal/gateway"
	zenfmcp "zenf/internal/mcp"

	"github.com/spf13/cobra"
)

type ClientStatus struct {
	Client        string `json:"client"`
	ConfigPath    string `json:"config_path"`
	Configured    bool   `json:"configured"`
	BinaryValid   bool   `json:"binary_valid"`
	StatusMessage string `json:"status_message"`
}

type DaemonStatusReport struct {
	Active     bool                              `json:"active"`
	GatewayURL string                            `json:"gateway_url"`
	StatusCode int                               `json:"status_code,omitempty"`
	Projects   int                               `json:"projects,omitempty"`
	Plans      int                               `json:"plans,omitempty"`
	Tasks      int                               `json:"tasks,omitempty"`
	Agents     int                               `json:"agents,omitempty"`
	Resources  int                               `json:"resources,omitempty"`
	TasksBySt  map[string]int                    `json:"tasks_by_status,omitempty"`
	Telemetry  *gateway.RuntimeTelemetryResponse `json:"telemetry,omitempty"`
	DBStorage  DatabaseStorageInfo               `json:"db_storage"`
	Clients    []ClientStatus                    `json:"clients"`
}

func newStatusCmd() *cobra.Command {
	var statusJSON bool

	statusCmd := &cobra.Command{
		Use:   "status",
		Short: "Check the health, metrics, and MCP configuration status across all AI clients",
		RunE: func(cmd *cobra.Command, args []string) error {
			resolvedDB := resolveHomePath(defaultDBPath)
			report := probeDaemonStatus(defaultURL, resolvedDB)
			report.Clients = auditMCPClients()

			if statusJSON {
				enc := json.NewEncoder(os.Stdout)
				enc.SetIndent("", "  ")
				return enc.Encode(report)
			}

			termWidth := getTerminalWidth()
			fmt.Printf("ZenForge Control Plane Status (zenf v%s)\n", Version)
			printHorizontalRule(termWidth)

			renderDaemonRuntimeSection(report, resolvedDB, termWidth)
			renderAIClientMCPSection(report.Clients, termWidth)

			printHorizontalRule(termWidth)
			return nil
		},
	}
	statusCmd.Flags().BoolVar(&statusJSON, "json", false, "Output status report as JSON")
	return statusCmd
}

func probeDaemonStatus(url string, resolvedDB string) DaemonStatusReport {
	report := DaemonStatusReport{
		GatewayURL: url,
		TasksBySt:  make(map[string]int),
		DBStorage:  getDatabaseStorage(resolvedDB),
	}

	client := &http.Client{Timeout: 1500 * time.Millisecond}
	resp, err := client.Get(url + "/api/v1/tasks")
	if err != nil {
		return report
	}
	defer resp.Body.Close()

	report.StatusCode = resp.StatusCode
	if resp.StatusCode != http.StatusOK {
		return report
	}

	report.Active = true
	var payload struct {
		Tasks []domain.Task `json:"tasks"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&payload); err == nil {
		report.Tasks = len(payload.Tasks)
		for _, t := range payload.Tasks {
			report.TasksBySt[string(t.Status)]++
		}
	}

	if pResp, pErr := client.Get(url + "/api/v1/projects"); pErr == nil {
		defer pResp.Body.Close()
		var pPayload struct {
			Projects []domain.Project `json:"projects"`
		}
		if err := json.NewDecoder(pResp.Body).Decode(&pPayload); err == nil {
			report.Projects = len(pPayload.Projects)
		}
	}

	if plResp, plErr := client.Get(url + "/api/v1/plans"); plErr == nil {
		defer plResp.Body.Close()
		var plPayload struct {
			Plans []domain.Plan `json:"plans"`
		}
		if err := json.NewDecoder(plResp.Body).Decode(&plPayload); err == nil {
			report.Plans = len(plPayload.Plans)
		}
	}

	if agResp, agErr := client.Get(url + "/api/v1/agents"); agErr == nil {
		defer agResp.Body.Close()
		var agPayload struct {
			Agents []domain.Agent `json:"agents"`
		}
		if err := json.NewDecoder(agResp.Body).Decode(&agPayload); err == nil {
			report.Agents = len(agPayload.Agents)
		}
	}

	if resResp, resErr := client.Get(url + "/api/v1/resources?include_global=true"); resErr == nil {
		defer resResp.Body.Close()
		var resPayload struct {
			Resources []domain.Resource `json:"resources"`
		}
		if err := json.NewDecoder(resResp.Body).Decode(&resPayload); err == nil {
			report.Resources = len(resPayload.Resources)
		}
	}

	// Probe live runtime telemetry from GET /api/v1/status
	if stResp, stErr := client.Get(url + "/api/v1/status"); stErr == nil {
		defer stResp.Body.Close()
		if stResp.StatusCode == http.StatusOK {
			var tm gateway.RuntimeTelemetryResponse
			if err := json.NewDecoder(stResp.Body).Decode(&tm); err == nil && tm.PID > 0 {
				report.Telemetry = &tm
			}
		}
	}

	// Fallback if talking to an older daemon binary without /api/v1/status:
	// try local OS probe using PID from zenf.pid
	if report.Telemetry == nil {
		pidFile := filepath.Join(filepath.Dir(resolvedDB), "zenf.pid")
		if data, err := os.ReadFile(pidFile); err == nil {
			if pid, err := strconv.Atoi(strings.TrimSpace(string(data))); err == nil && pid > 0 {
				tm := gateway.CollectProcessTelemetry(pid, time.Time{}, 0, 0)
				report.Telemetry = &tm
			}
		}
	}

	return report
}

func auditMCPClients() []ClientStatus {
	supportedClients := []zenfmcp.ClientType{
		zenfmcp.ClientAgy,
		zenfmcp.ClientClaude,
		zenfmcp.ClientCursor,
		zenfmcp.ClientOpenCode,
	}

	var clients []ClientStatus
	for _, c := range supportedClients {
		checkRes, _ := zenfmcp.CheckMCP(c, "")
		cs := ClientStatus{Client: string(c)}
		if checkRes != nil {
			cs.ConfigPath = checkRes.ConfigPath
			cs.Configured = checkRes.Configured
			cs.BinaryValid = checkRes.BinaryExists
			cs.StatusMessage = checkRes.StatusMessage
		}
		clients = append(clients, cs)
	}
	return clients
}

func renderDaemonRuntimeSection(report DaemonStatusReport, resolvedDB string, termWidth int) {
	fmt.Println("DAEMON & GATEWAY RUNTIME")
	if report.Active {
		pidStr := "active"
		if report.Telemetry != nil && report.Telemetry.PID > 0 {
			pidStr = fmt.Sprintf("pid %d", report.Telemetry.PID)
			if report.Telemetry.UptimeSeconds > 0 {
				pidStr = fmt.Sprintf("%s | uptime %s", pidStr, formatDurationShort(report.Telemetry.UptimeSeconds))
			}
		} else {
			pidFile := filepath.Join(filepath.Dir(resolvedDB), "zenf.pid")
			if data, err := os.ReadFile(pidFile); err == nil {
				pidStr = fmt.Sprintf("pid %s", strings.TrimSpace(string(data)))
			}
		}
		printField("Status", fmt.Sprintf("● ACTIVE (%s)", pidStr), fmt.Sprintf("serving at %s", report.GatewayURL), termWidth)

		if tm := report.Telemetry; tm != nil {
			var resParts []string
			if tm.RSSBytes > 0 {
				if tm.HeapAllocBytes > 0 {
					resParts = append(resParts, fmt.Sprintf("%s RSS (Heap: %s | Sys: %s)",
						formatBytes(int64(tm.RSSBytes)),
						formatBytes(int64(tm.HeapAllocBytes)),
						formatBytes(int64(tm.SysBytes))))
				} else {
					resParts = append(resParts, fmt.Sprintf("%s RSS", formatBytes(int64(tm.RSSBytes))))
				}
			}
			if tm.CPUSeconds > 0 {
				if tm.UptimeSeconds > 0 {
					cpuPct := (tm.CPUSeconds / tm.UptimeSeconds) * 100
					resParts = append(resParts, fmt.Sprintf("CPU %.2fs (%.1f%%)", tm.CPUSeconds, cpuPct))
				} else {
					resParts = append(resParts, fmt.Sprintf("CPU %.2fs", tm.CPUSeconds))
				}
			}
			if tm.Goroutines > 0 {
				resParts = append(resParts, fmt.Sprintf("%d Goroutines", tm.Goroutines))
			}
			if tm.OpenFDs >= 0 {
				resParts = append(resParts, fmt.Sprintf("%d FDs", tm.OpenFDs))
			}
			if len(resParts) > 0 {
				printField("Resources", strings.Join(resParts, " | "), fmt.Sprintf("%s/%s", tm.OS, tm.Arch), termWidth)
			}

			if tm.Goroutines > 0 || tm.SSEClients > 0 || tm.ActiveSessions > 0 {
				connVal := fmt.Sprintf("%d SSE Clients | %d Active Sessions", tm.SSEClients, tm.ActiveSessions)
				var versionExtra string
				if tm.Version != "" && tm.Version != Version {
					versionExtra = fmt.Sprintf("⚠ daemon v%s != cli v%s", tm.Version, Version)
				}
				printField("Workloads", connVal, versionExtra, termWidth)
			}
		}

		printField("Cockpit UI", report.GatewayURL, "Web Dashboard", termWidth)
		printField("Database", resolvedDB, "SQLite WAL", termWidth)
		if report.DBStorage.TotalBytes > 0 {
			storageExtra := fmt.Sprintf("Main: %s | WAL: %s", report.DBStorage.MainHuman, report.DBStorage.WalHuman)
			if report.DBStorage.LogBytes > 0 {
				storageExtra = fmt.Sprintf("%s | Log: %s", storageExtra, report.DBStorage.LogHuman)
			}
			printField("DB Storage", report.DBStorage.TotalHuman, storageExtra, termWidth)
		}
		metricsVal := fmt.Sprintf("%d Projects | %d Plans | %d Tasks | %d Agents | %d Resources",
			report.Projects, report.Plans, report.Tasks, report.Agents, report.Resources)
		var metricsExtra string
		if report.Tasks > 0 {
			metricsExtra = fmt.Sprintf("%d Ready, %d Running, %d Done",
				report.TasksBySt[string(domain.StatusReady)],
				report.TasksBySt[string(domain.StatusRunning)],
				report.TasksBySt[string(domain.StatusCompleted)])
		}
		printField("Metrics", metricsVal, metricsExtra, termWidth)
	} else {
		printField("Status", "○ INACTIVE", "Daemon not running", termWidth)
		printField("Gateway URL", report.GatewayURL, "", termWidth)
		printField("Database", resolvedDB, "SQLite WAL", termWidth)
		if report.DBStorage.TotalBytes > 0 {
			storageExtra := fmt.Sprintf("Main: %s | WAL: %s", report.DBStorage.MainHuman, report.DBStorage.WalHuman)
			if report.DBStorage.LogBytes > 0 {
				storageExtra = fmt.Sprintf("%s | Log: %s", storageExtra, report.DBStorage.LogHuman)
			}
			printField("DB Storage", report.DBStorage.TotalHuman, storageExtra, termWidth)
		}
		fmt.Println(" • Quickstart   : Run 'zenf daemon start -d' to start daemon in background")
	}
}

func renderAIClientMCPSection(clients []ClientStatus, termWidth int) {
	fmt.Println("\nAI CLIENT MCP INTEGRATIONS")
	for _, cs := range clients {
		var badge string
		if cs.Configured && cs.BinaryValid {
			badge = "✔ CONFIGURED"
		} else if cs.Configured && !cs.BinaryValid {
			badge = "⚠ BROKEN_BINARY"
		} else {
			badge = "○ NOT CONFIGURED"
		}
		printField(cs.Client, badge, cs.ConfigPath, termWidth)
	}
	fmt.Println("\n💡 To configure an AI client: run 'zenf mcp setup <client>'")
}
