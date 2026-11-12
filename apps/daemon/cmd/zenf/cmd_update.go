package main

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"zenf/internal/updater"

	"github.com/spf13/cobra"
)

func newUpdateCmd() *cobra.Command {
	var (
		updateCheckOnly bool
		updateForce     bool
		updateVersion   string
	)

	updateCmd := &cobra.Command{
		Use:   "update",
		Short: "Update zenf to the latest release (or specified version)",
		Long: `Downloads and installs the latest binary release from GitHub Releases.
Verifies SHA-256 checksums and performs atomic in-place binary replacement without requiring sudo.`,
		RunE: func(cmd *cobra.Command, args []string) error {
			execPath, err := os.Executable()
			if err != nil {
				return fmt.Errorf("failed to locate zenf executable: %w", err)
			}
			if resolved, err := filepath.EvalSymlinks(execPath); err == nil {
				execPath = resolved
			}

			if err := updater.CheckWritePermission(execPath); err != nil {
				return err
			}

			fmt.Printf("Checking for updates (current version: v%s)...\n", Version)

			const repo = "venhdev/zenforge"
			var release *updater.Release
			if updateVersion != "" {
				tag := updateVersion
				if !strings.HasPrefix(tag, "v") {
					tag = "v" + tag
				}
				release = updater.ConstructReleaseFromTag(repo, tag)
				fmt.Printf("Targeting requested version: %s\n", release.TagName)
			} else {
				rel, err := updater.GetLatestRelease(repo)
				if err != nil {
					return fmt.Errorf("failed to check for updates: %w", err)
				}
				release = rel
			}

			if !updateForce && updateVersion == "" && !updater.IsNewer(release.TagName, Version) {
				fmt.Printf("✔ zenf is already up to date (v%s).\n", Version)
				return nil
			}

			fmt.Printf("Available release: %s\n", release.TagName)
			if updateCheckOnly {
				fmt.Println("Run 'zenf update' to install.")
				return nil
			}

			targetAsset := updater.TargetAssetName(release.TagName)
			var assetURL, checksumURL string
			for _, a := range release.Assets {
				if a.Name == targetAsset {
					assetURL = a.BrowserDownloadURL
				} else if a.Name == "checksums.txt" {
					checksumURL = a.BrowserDownloadURL
				}
			}

			if assetURL == "" {
				assetURL = fmt.Sprintf("https://github.com/%s/releases/download/%s/%s", repo, release.TagName, targetAsset)
			}
			if checksumURL == "" {
				checksumURL = fmt.Sprintf("https://github.com/%s/releases/download/%s/checksums.txt", repo, release.TagName)
			}

			fmt.Printf("Downloading %s...\n", targetAsset)
			assetBytes, err := updater.DownloadBytes(assetURL)
			if err != nil {
				return fmt.Errorf("download failed: %w", err)
			}

			fmt.Println("Verifying SHA-256 checksum...")
			checksumsBytes, err := updater.DownloadBytes(checksumURL)
			if err != nil {
				return fmt.Errorf("failed downloading checksums: %w", err)
			}

			if err := updater.VerifyChecksum(assetBytes, string(checksumsBytes), targetAsset); err != nil {
				return fmt.Errorf("security verification failed: %w", err)
			}
			fmt.Println("  ✔ Checksum verified successfully.")

			fmt.Println("Extracting binary...")
			binBytes, err := updater.ExtractBinary(assetBytes, targetAsset)
			if err != nil {
				return fmt.Errorf("extraction failed: %w", err)
			}

			fmt.Printf("Installing to %s...\n", execPath)
			if err := updater.ReplaceBinary(execPath, binBytes); err != nil {
				return fmt.Errorf("failed to replace binary: %w", err)
			}

			fmt.Printf("✔ Successfully updated zenf to %s at %s\n", release.TagName, execPath)

			restartActiveDaemonIfRunning(defaultPort, defaultDBPath, execPath)
			return nil
		},
	}

	updateCmd.Flags().BoolVarP(&updateCheckOnly, "check", "c", false, "Check for available updates without applying")
	updateCmd.Flags().BoolVarP(&updateForce, "force", "f", false, "Force reinstall even if version is up to date")
	updateCmd.Flags().StringVar(&updateVersion, "version", "", "Install a specific version tag (e.g. v0.3.2)")
	return updateCmd
}
