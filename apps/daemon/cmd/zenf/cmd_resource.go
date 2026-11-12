package main

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"sort"
	"strings"

	"zenf/internal/domain"

	"github.com/spf13/cobra"
)

func newResourceCmd() *cobra.Command {
	resourceCmd := &cobra.Command{
		Use:   "resource [command]",
		Short: "Query and inspect knowledge resources & tags",
		Run: func(cmd *cobra.Command, args []string) {
			_ = cmd.Help()
		},
	}

	var resProject string
	var resKind string
	var resTag string
	var resJSON bool

	resListCmd := &cobra.Command{
		Use:   "list",
		Short: "List knowledge resources with optional kind/tag/project filter",
		RunE: func(cmd *cobra.Command, args []string) error {
			params := url.Values{}
			if resProject != "" {
				params.Set("project_slug", resProject)
			}
			if resKind != "" {
				params.Set("kind", resKind)
			}
			if resTag != "" {
				params.Set("tag", strings.TrimPrefix(resTag, "#"))
			}
			params.Set("include_global", "true")

			apiURL := fmt.Sprintf("%s/api/v1/resources?%s", defaultURL, params.Encode())
			resp, err := cliHTTPClient.Get(apiURL)
			if err != nil {
				return fmt.Errorf("failed to query resources: %w", err)
			}
			defer resp.Body.Close()

			if resp.StatusCode != http.StatusOK {
				body, _ := io.ReadAll(resp.Body)
				return fmt.Errorf("daemon returned HTTP %d: %s", resp.StatusCode, string(body))
			}

			var payload struct {
				Resources []domain.Resource `json:"resources"`
			}
			if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
				return err
			}

			if resJSON {
				enc := json.NewEncoder(os.Stdout)
				enc.SetIndent("", "  ")
				return enc.Encode(payload.Resources)
			}

			if len(payload.Resources) == 0 {
				fmt.Println("No resources found matching the filter.")
				return nil
			}

			termWidth := getTerminalWidth()
			fmt.Printf("ZenForge Context Resources (%d items)\n", len(payload.Resources))
			printHorizontalRule(termWidth)
			for _, r := range payload.Resources {
				tagStr := ""
				if len(r.Tags) > 0 {
					tagStr = " #" + strings.Join(r.Tags, " #")
				} else if len(r.Types) > 0 {
					tagStr = " #" + strings.Join(r.Types, " #")
				}
				scopeInfo := fmt.Sprintf("[%s/%s]", r.Kind, r.Scope)
				if r.ProjectSlug != "" {
					scopeInfo = fmt.Sprintf("[%s/%s/%s]", r.Kind, r.Scope, r.ProjectSlug)
				}
				fmt.Printf("%-24s %-20s %s%s\n", r.Key, scopeInfo, r.Title, tagStr)
			}
			printHorizontalRule(termWidth)
			return nil
		},
	}
	resListCmd.Flags().StringVarP(&resProject, "project", "p", "", "Filter by project slug")
	resListCmd.Flags().StringVarP(&resKind, "kind", "k", "", "Filter by kind (spec, soul, harness, artifact)")
	resListCmd.Flags().StringVarP(&resTag, "tag", "t", "", "Filter by tag (e.g. #policy or policy)")
	resListCmd.Flags().BoolVar(&resJSON, "json", false, "Output as JSON")
	resourceCmd.AddCommand(resListCmd)

	var tagCloudJSON bool
	var tagCloudProject string

	resTagsCmd := &cobra.Command{
		Use:   "tags",
		Short: "Display dynamic tag cloud with occurrence counts",
		RunE: func(cmd *cobra.Command, args []string) error {
			params := url.Values{}
			if tagCloudProject != "" {
				params.Set("project_slug", tagCloudProject)
			}
			params.Set("include_global", "true")

			apiURL := fmt.Sprintf("%s/api/v1/resources?%s", defaultURL, params.Encode())
			resp, err := cliHTTPClient.Get(apiURL)
			if err != nil {
				return fmt.Errorf("failed to query resources for tag cloud: %w", err)
			}
			defer resp.Body.Close()

			if resp.StatusCode != http.StatusOK {
				body, _ := io.ReadAll(resp.Body)
				return fmt.Errorf("daemon returned HTTP %d: %s", resp.StatusCode, string(body))
			}

			var payload struct {
				Resources []domain.Resource `json:"resources"`
			}
			if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
				return err
			}

			counts := make(map[string]int)
			for _, r := range payload.Resources {
				seen := make(map[string]bool)
				for _, t := range r.Tags {
					t = strings.ToLower(strings.TrimSpace(strings.TrimPrefix(t, "#")))
					if t != "" && !seen[t] {
						seen[t] = true
						counts[t]++
					}
				}
				for _, t := range r.Types {
					t = strings.ToLower(strings.TrimSpace(strings.TrimPrefix(t, "#")))
					if t != "" && !seen[t] {
						seen[t] = true
						counts[t]++
					}
				}
			}

			type tagItem struct {
				Tag   string `json:"tag"`
				Count int    `json:"count"`
			}
			var list []tagItem
			for tag, cnt := range counts {
				list = append(list, tagItem{Tag: tag, Count: cnt})
			}
			sort.Slice(list, func(i, j int) bool {
				if list[i].Count != list[j].Count {
					return list[i].Count > list[j].Count
				}
				return list[i].Tag < list[j].Tag
			})

			if tagCloudJSON {
				enc := json.NewEncoder(os.Stdout)
				enc.SetIndent("", "  ")
				return enc.Encode(list)
			}

			termWidth := getTerminalWidth()
			fmt.Printf("ZenForge Resource Tag Cloud (%d distinct tags)\n", len(list))
			printHorizontalRule(termWidth)
			for _, item := range list {
				fmt.Printf(" • #%-18s (%d resources)\n", item.Tag, item.Count)
			}
			printHorizontalRule(termWidth)
			return nil
		},
	}
	resTagsCmd.Flags().StringVarP(&tagCloudProject, "project", "p", "", "Filter by project slug")
	resTagsCmd.Flags().BoolVar(&tagCloudJSON, "json", false, "Output as JSON")
	resourceCmd.AddCommand(resTagsCmd)

	return resourceCmd
}
