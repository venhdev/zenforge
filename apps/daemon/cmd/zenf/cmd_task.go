package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"text/tabwriter"

	"zenf/internal/domain"

	"github.com/spf13/cobra"
)

func newTaskCmd() *cobra.Command {
	var taskStatus string

	taskListCmd := &cobra.Command{
		Use:   "list",
		Short: "List tasks across active plans",
		RunE: func(cmd *cobra.Command, args []string) error {
			url := fmt.Sprintf("%s/api/v1/tasks?status=%s", defaultURL, taskStatus)
			resp, err := cliHTTPClient.Get(url)
			if err != nil {
				return fmt.Errorf("failed to fetch tasks: %w", err)
			}
			defer resp.Body.Close()

			var payload struct {
				Tasks []domain.Task `json:"tasks"`
			}
			bodyBytes, err := io.ReadAll(resp.Body)
			if err != nil {
				return err
			}
			if err := json.Unmarshal(bodyBytes, &payload); err != nil {
				var rawTasks []domain.Task
				if err2 := json.Unmarshal(bodyBytes, &rawTasks); err2 != nil {
					return fmt.Errorf("failed to decode tasks list: %w", err)
				}
				payload.Tasks = rawTasks
			}
			tasks := payload.Tasks

			if len(tasks) == 0 {
				fmt.Println("No tasks found.")
				return nil
			}

			w := tabwriter.NewWriter(os.Stdout, 0, 0, 2, ' ', 0)
			fmt.Fprintf(w, "TASK ID\tSCOPE\tSTATUS\tHARNESS\n")
			for _, t := range tasks {
				scope := t.PlanSlug
				if scope == "" {
					scope = t.ProjectSlug
				}
				if scope == "" {
					scope = "orphan"
				}
				fmt.Fprintf(w, "%s\t%s\t%s\n", t.ID, scope, t.Status)
			}
			return w.Flush()
		},
	}
	taskListCmd.Flags().StringVarP(&taskStatus, "status", "s", "", "Filter by task status (e.g. READY, RUNNING)")

	taskCmd := &cobra.Command{
		Use:   "task",
		Short: "Query and inspect tasks",
	}
	taskCmd.AddCommand(taskListCmd)

	taskStartCmd := &cobra.Command{
		Use:   "start <task-id>",
		Short: "Mark a task as RUNNING",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			return sendTaskStatus(args[0], domain.StatusRunning)
		},
	}
	taskCmd.AddCommand(taskStartCmd)

	taskDoneCmd := &cobra.Command{
		Use:   "done <task-id>",
		Short: "Mark a task as COMPLETED",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			return sendTaskStatus(args[0], domain.StatusCompleted)
		},
	}
	taskCmd.AddCommand(taskDoneCmd)

	taskFailCmd := &cobra.Command{
		Use:   "fail <task-id>",
		Short: "Mark a task as FAILED",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			return sendTaskStatus(args[0], domain.StatusFailed)
		},
	}
	taskCmd.AddCommand(taskFailCmd)

	var updateStatusStr string
	taskUpdateCmd := &cobra.Command{
		Use:   "update <task-id>",
		Short: "Update task status to a specific state",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			if updateStatusStr == "" {
				return fmt.Errorf("--status flag is required")
			}
			st := domain.TaskStatus(updateStatusStr)
			if !st.IsValid() {
				return fmt.Errorf("invalid status '%s'", updateStatusStr)
			}
			return sendTaskStatus(args[0], st)
		},
	}
	taskUpdateCmd.Flags().StringVarP(&updateStatusStr, "status", "s", "", "Target status (e.g. READY, RUNNING, COMPLETED, FAILED)")
	_ = taskUpdateCmd.MarkFlagRequired("status")
	taskCmd.AddCommand(taskUpdateCmd)

	var claimWorker string
	var claimJSON bool
	taskClaimCmd := &cobra.Command{
		Use:   "claim <task-id>",
		Short: "Claim a ready task and display its context packet",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			taskID := args[0]
			payload := map[string]any{
				"worker_id": claimWorker,
			}
			bodyBytes, _ := json.Marshal(payload)
			resp, err := cliHTTPClient.Post(fmt.Sprintf("%s/api/v1/tasks/%s/claim", defaultURL, taskID), "application/json", bytes.NewReader(bodyBytes))
			if err != nil {
				return fmt.Errorf("failed to connect to daemon: %w", err)
			}
			defer resp.Body.Close()

			if resp.StatusCode != http.StatusOK {
				body, _ := io.ReadAll(resp.Body)
				return fmt.Errorf("claim failed (HTTP %d): %s", resp.StatusCode, string(body))
			}

			var packet domain.ContextPacket
			if err := json.NewDecoder(resp.Body).Decode(&packet); err != nil {
				return err
			}

			if claimJSON {
				enc := json.NewEncoder(os.Stdout)
				enc.SetIndent("", "  ")
				return enc.Encode(packet)
			}

			fmt.Printf("✓ Task '%s' successfully claimed by %s (Status: RUNNING)\n\n", taskID, packet.Task.ClaimedBy)
			fmt.Println(packet.PromptMarkdown)
			return nil
		},
	}
	taskClaimCmd.Flags().StringVarP(&claimWorker, "worker", "w", "", "Worker identifier (defaults to a generated id)")
	taskClaimCmd.Flags().BoolVar(&claimJSON, "json", false, "Output raw ContextPacket JSON")
	taskCmd.AddCommand(taskClaimCmd)

	return taskCmd
}

func sendTaskStatus(taskID string, newStatus domain.TaskStatus) error {
	payload := map[string]string{
		"status": string(newStatus),
	}
	bodyBytes, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	resp, err := cliHTTPClient.Post(fmt.Sprintf("%s/api/v1/tasks/%s/status", defaultURL, taskID), "application/json", bytes.NewReader(bodyBytes))
	if err != nil {
		return fmt.Errorf("failed to connect to daemon at %s: %w", defaultURL, err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("daemon responded with HTTP %d: %s", resp.StatusCode, strings.TrimSpace(string(body)))
	}

	var respData struct {
		TaskID string `json:"task_id"`
		Status string `json:"status"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&respData); err != nil {
		return fmt.Errorf("failed to parse daemon response: %w", err)
	}
	finalStatus := newStatus
	if respData.Status != "" {
		finalStatus = domain.TaskStatus(respData.Status)
	}

	fmt.Printf("✓ Task '%s' status updated to %s\n", taskID, finalStatus)
	return nil
}
