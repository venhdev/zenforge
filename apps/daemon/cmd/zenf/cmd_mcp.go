package main

import (
	"encoding/json"
	"fmt"
	"os"

	"zenf/internal/contextpacket"
	zenfmcp "zenf/internal/mcp"
	"zenf/internal/storage"

	"github.com/spf13/cobra"
)

func newMCPCmd() *cobra.Command {
	var mcpDBPath string
	var mcpStdioForce bool

	mcpCmd := &cobra.Command{
		Use:   "mcp [command]",
		Short: "Manage or run Model Context Protocol (MCP) server for agents",
		Long: `The 'zenf mcp' command manages MCP integrations for AI agents.
When invoked directly by an AI client without a TTY (via stdin/stdout pipe), it automatically starts the JSON-RPC stdio server.
When invoked in an interactive terminal, it displays the integration status and available actions.`,
		RunE: func(cmd *cobra.Command, args []string) error {
			isTerminal := false
			if fileInfo, err := os.Stdin.Stat(); err == nil {
				isTerminal = (fileInfo.Mode() & os.ModeCharDevice) != 0
			}

			if isTerminal && !mcpStdioForce {
				fmt.Printf("ZenForge MCP Integrations (zenf v%s)\n", Version)
				printHorizontalRule(80)
				fmt.Println("AI CLIENT MCP STATUS:")

				supportedClients := []zenfmcp.ClientType{
					zenfmcp.ClientAgy,
					zenfmcp.ClientClaude,
					zenfmcp.ClientCursor,
					zenfmcp.ClientOpenCode,
				}
				for _, c := range supportedClients {
					checkRes, _ := zenfmcp.CheckMCP(c, "")
					var badge string
					var cfgPath string
					if checkRes != nil {
						cfgPath = checkRes.ConfigPath
						if checkRes.Configured && checkRes.BinaryExists {
							badge = "✔ CONFIGURED    "
						} else if checkRes.Configured && !checkRes.BinaryExists {
							badge = "⚠ BROKEN_BINARY "
						} else {
							badge = "○ NOT CONFIGURED"
						}
					}
					fmt.Printf(" • %-14s : %s (%s)\n", c, badge, cfgPath)
				}

				fmt.Println("\nAVAILABLE MCP ACTIONS:")
				fmt.Println("  zenf mcp setup <client>          Configure MCP server for AI client (agy, claude, cursor, opencode)")
				fmt.Println("  zenf mcp check [client]          Audit detailed client configuration and binary validity")
				fmt.Println("  zenf mcp --stdio                 Force start JSON-RPC stdio server (for manual piping)")
				fmt.Println("\nℹ When an AI client spawns 'zenf mcp', stdio JSON-RPC runs automatically.")
				printHorizontalRule(80)
				return nil
			}

			dbPath := resolveHomePath(mcpDBPath)
			db, err := storage.Open(dbPath)
			if err != nil {
				return fmt.Errorf("failed to open storage engine: %w", err)
			}
			defer db.Close()
			store := storage.NewStore(db)
			store.SetPacketBuilder(contextpacket.New(store.ArtifactRepository, nil,
				contextpacket.WithProjectReader(store.ProjectRepository),
				contextpacket.WithPlanReader(store.PlanRepository),
				contextpacket.WithAgentReader(store.AgentRepository),
				contextpacket.WithResourceReader(store.ResourceRepository),
			))

			srv := zenfmcp.NewServer(store)
			return srv.ServeStdio()
		},
	}
	mcpCmd.Flags().StringVarP(&mcpDBPath, "db", "d", "~/.zenforge/state.db", "Path to SQLite WAL database")
	mcpCmd.Flags().BoolVar(&mcpStdioForce, "stdio", false, "Force run stdio JSON-RPC server even if attached to terminal")

	var checkClient string
	var checkConfig string
	var checkJSON bool
	mcpCheckCmd := &cobra.Command{
		Use:   "check [client]",
		Short: "Audit client MCP configuration for zenf",
		RunE: func(cmd *cobra.Command, args []string) error {
			clientName := checkClient
			if len(args) > 0 {
				clientName = args[0]
			}
			if clientName == "" {
				clientName = "agy"
			}
			res, err := zenfmcp.CheckMCP(zenfmcp.ClientType(clientName), checkConfig)
			if err != nil {
				return fmt.Errorf("mcp check failed: %w", err)
			}
			if checkJSON {
				byt, _ := json.MarshalIndent(res, "", "  ")
				fmt.Println(string(byt))
				return nil
			}
			if res.Configured && res.BinaryExists {
				fmt.Printf("[OK] zenf MCP is configured and valid in %s (binary: %s)\n", res.ConfigPath, res.BinaryPath)
				return nil
			}
			fmt.Printf("[NOT_CONFIGURED] %s\n", res.StatusMessage)
			return nil
		},
	}
	mcpCheckCmd.Flags().StringVarP(&checkClient, "client", "c", "agy", "Target AI client: agy (default), claude, cursor, opencode")
	mcpCheckCmd.Flags().StringVar(&checkConfig, "config", "", "Override client config file path")
	mcpCheckCmd.Flags().BoolVar(&checkJSON, "json", false, "Output result as JSON")
	mcpCmd.AddCommand(mcpCheckCmd)

	var setupClient string
	var setupConfig string
	var setupDB string
	var setupBinary string
	var setupForce bool
	var setupDryRun bool
	mcpSetupCmd := &cobra.Command{
		Use:   "setup [client]",
		Short: "Configure zenf MCP server in client configuration",
		Long: `The 'zenf mcp setup' command configures the zenf MCP server in an AI client's configuration.

Supported AI Clients:
  agy         Antigravity / Gemini CLI (~/.gemini/config/mcp_config.json)
  claude      Claude Code (~/.claude.json)
  cursor      Cursor IDE (~/.cursor/mcp.json)
  opencode    OpenCode interpreter (~/.config/opencode/opencode.json)

Usage Examples:
  zenf mcp setup agy
  zenf mcp setup claude
  zenf mcp setup cursor
  zenf mcp setup opencode
  zenf mcp setup --client agy --dry-run
  zenf mcp setup -c claude --force`,
		RunE: func(cmd *cobra.Command, args []string) error {
			clientName := setupClient
			if clientName == "" && len(args) > 0 {
				clientName = args[0]
			}
			if clientName == "" {
				return cmd.Help()
			}
			res, err := zenfmcp.SetupMCP(zenfmcp.SetupOptions{
				Client:     zenfmcp.ClientType(clientName),
				ConfigPath: setupConfig,
				DBPath:     setupDB,
				BinaryPath: setupBinary,
				Force:      setupForce,
				DryRun:     setupDryRun,
			})
			if err != nil {
				return fmt.Errorf("mcp setup failed: %w", err)
			}

			if res.Action == "dry_run" {
				fmt.Printf("[DRY-RUN] Previewing configuration for %s at %s:\n\n%s\n", res.Client, res.ConfigPath, res.WrittenJSON)
				return nil
			}

			if res.Action == "already_configured" {
				fmt.Printf("[ALREADY_CONFIGURED] zenf MCP is already configured in %s (binary: %s)\n", res.ConfigPath, res.BinaryPath)
				return nil
			}

			fmt.Printf("[SUCCESS] Configured zenf MCP server for %s in %s\n", res.Client, res.ConfigPath)
			if res.BackupPath != "" {
				fmt.Printf("Backup saved to: %s\n", res.BackupPath)
			}
			fmt.Printf("Binary: %s\n", res.BinaryPath)
			fmt.Printf("Database: %s\n", res.DBPath)
			fmt.Println("Please restart your AI client session (e.g. opencode or agy) to load the zenf MCP tools.")
			return nil
		},
	}
	mcpSetupCmd.Flags().StringVarP(&setupClient, "client", "c", "", "Target AI client: agy, claude, cursor, opencode")
	mcpSetupCmd.Flags().StringVar(&setupConfig, "config", "", "Override client config file path")
	mcpSetupCmd.Flags().StringVarP(&setupDB, "db", "d", "~/.zenforge/state.db", "Path to SQLite WAL database")
	mcpSetupCmd.Flags().StringVarP(&setupBinary, "binary", "b", "", "Path to zenf binary (auto-detected if omitted)")
	mcpSetupCmd.Flags().BoolVarP(&setupForce, "force", "f", false, "Force overwrite existing entry")
	mcpSetupCmd.Flags().BoolVar(&setupDryRun, "dry-run", false, "Preview configuration changes without writing")
	mcpCmd.AddCommand(mcpSetupCmd)

	return mcpCmd
}
