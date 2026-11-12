package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"text/tabwriter"

	"zenf/internal/domain"
	"zenf/internal/gateway"
	"zenf/internal/parser"

	"github.com/spf13/cobra"
)

func newPlanCmd() *cobra.Command {
	var planProject string

	planPushCmd := &cobra.Command{
		Use:   "push <file.md>",
		Short: "Parse and ingest a living Markdown plan dossier into the daemon",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			filePath := args[0]
			if planProject == "" {
				return fmt.Errorf("--project is required; plans always belong to a project")
			}

			plan, tasks, err := parser.ParseMarkdownPlanFile(filePath)
			if err != nil {
				return fmt.Errorf("failed to parse plan dossier %s: %w", filePath, err)
			}

			payload := gateway.CreatePlanRequest{
				Slug:        plan.Slug,
				ProjectSlug: planProject,
				Title:       plan.Title,
				Tasks:       tasks,
			}

			bodyBytes, err := json.Marshal(payload)
			if err != nil {
				return err
			}

			resp, err := cliHTTPClient.Post(defaultURL+"/api/v1/plans", "application/json", bytes.NewReader(bodyBytes))
			if err != nil {
				return fmt.Errorf("failed to connect to daemon at %s: %w", defaultURL, err)
			}
			defer resp.Body.Close()

			if resp.StatusCode != http.StatusCreated && resp.StatusCode != http.StatusOK {
				return fmt.Errorf("daemon responded with HTTP %d", resp.StatusCode)
			}

			fmt.Printf("✓ Ingested Plan '%s' (%d tasks) into %s\n", plan.Slug, len(tasks), defaultURL)
			for _, t := range tasks {
				fmt.Printf("    [%s] %s (deps: %v)\n", t.Status, t.ID, t.Dependencies)
			}
			return nil
		},
	}
	planPushCmd.Flags().StringVarP(&planProject, "project", "p", "", "Owning project slug (required)")

	planGetCmd := &cobra.Command{
		Use:   "get <slug>",
		Short: "Retrieve and view a plan graph from the daemon",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			slug := args[0]
			resp, err := cliHTTPClient.Get(fmt.Sprintf("%s/api/v1/plans/%s", defaultURL, slug))
			if err != nil {
				return fmt.Errorf("failed to query plan: %w", err)
			}
			defer resp.Body.Close()

			if resp.StatusCode == http.StatusNotFound {
				return fmt.Errorf("plan '%s' not found on %s", slug, defaultURL)
			}
			if resp.StatusCode != http.StatusOK {
				return fmt.Errorf("daemon returned HTTP %d", resp.StatusCode)
			}

			var result struct {
				Plan  domain.Plan   `json:"plan"`
				Tasks []domain.Task `json:"tasks"`
			}
			if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
				return err
			}

			fmt.Printf("Plan: %s (Status: %s)\n", result.Plan.Slug, result.Plan.Status)
			fmt.Printf("Title: %s\n\n", result.Plan.Title)

			w := tabwriter.NewWriter(os.Stdout, 0, 0, 2, ' ', 0)
			fmt.Fprintf(w, "TASK ID\tSTATUS\tDEPENDENCIES\tTITLE\n")
			for _, t := range result.Tasks {
				deps := "-"
				if len(t.Dependencies) > 0 {
					deps = fmt.Sprintf("%v", t.Dependencies)
				}
				fmt.Fprintf(w, "%s\t%s\t%s\t%s\n", t.ID, t.Status, deps, t.Title)
			}
			return w.Flush()
		},
	}

	planCmd := &cobra.Command{
		Use:   "plan",
		Short: "Manage living plan dossiers",
	}
	planCmd.AddCommand(planPushCmd)
	planCmd.AddCommand(planGetCmd)
	return planCmd
}
