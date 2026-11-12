// Package attachment copies agent-provided media into the ZenForge attachment
// store and classifies it as a task INPUT artifact. The daemon never executes
// the file; it only stores bytes and metadata for the next claim.
package attachment

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"io/fs"
	"mime"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"zenf/internal/domain"
)

// MaxBytes bounds a single attachment. Agents should downscale screenshots
// rather than pushing multi-megabyte blobs through the context packet.
const MaxBytes = 25 << 20

// RootEnv overrides the attachment directory (used by tests and by operators
// who keep state outside the home directory).
const RootEnv = "ZENF_ATTACHMENTS_DIR"

// StorageRoot returns the root directory for attachments, honoring RootEnv.
func StorageRoot() (string, error) {
	if override := os.Getenv(RootEnv); override != "" {
		return override, nil
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return "", fmt.Errorf("cannot resolve home directory: %w", err)
	}
	return filepath.Join(home, ".zenforge", "attachments"), nil
}

func storageRoot() (string, error) {
	return StorageRoot()
}

// Ingest copies srcPath into ~/.zenforge/attachments/<ownerID>/ and returns the
// artifact metadata to register. The owner is a task or a resource; the caller
// owns the returned row and should delete it if registration fails.
func Ingest(ownerID, srcPath, displayName string) (domain.Artifact, error) {
	info, err := os.Stat(srcPath)
	if err != nil {
		return domain.Artifact{}, fmt.Errorf("cannot read %s: %w", srcPath, err)
	}
	if !info.Mode().IsRegular() {
		return domain.Artifact{}, fmt.Errorf("%s is not a regular file", srcPath)
	}

	src, err := os.Open(srcPath)
	if err != nil {
		return domain.Artifact{}, fmt.Errorf("cannot open %s: %w", srcPath, err)
	}
	defer src.Close()

	artifact, err := IngestReader(ownerID, filepath.Base(srcPath), src, info.Size())
	if err != nil {
		return domain.Artifact{}, err
	}
	if displayName != "" {
		artifact.Name = displayName
	}
	return artifact, nil
}

// IngestReader stores bytes from src under the owner directory and returns the
// artifact metadata. fileName supplies the extension used for MIME resolution;
// it never becomes the on-disk name.
//
// Files are content-addressed by SHA-256, so ingesting identical bytes twice
// reuses the same file instead of duplicating it. Data is staged and renamed
// atomically, so an interrupted upload never leaves a partial attachment.
func IngestReader(ownerID, fileName string, src io.Reader, size int64) (domain.Artifact, error) {
	if err := ValidateOwnerID(ownerID); err != nil {
		return domain.Artifact{}, err
	}
	if size > MaxBytes {
		return domain.Artifact{}, fmt.Errorf("%s is %d bytes, limit is %d", fileName, size, MaxBytes)
	}

	root, err := storageRoot()
	if err != nil {
		return domain.Artifact{}, err
	}
	dir := filepath.Join(root, ownerID)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return domain.Artifact{}, fmt.Errorf("cannot create attachment directory: %w", err)
	}

	artID := fmt.Sprintf("art-in-%s-%d", ownerID, time.Now().UnixNano())
	baseName := filepath.Base(fileName)

	staged, err := os.CreateTemp(dir, ".ingest-*")
	if err != nil {
		return domain.Artifact{}, fmt.Errorf("cannot stage media in %s: %w", dir, err)
	}
	stagedPath := staged.Name()

	// Read one byte past the cap so an oversized stream is detected even when
	// the caller cannot supply a reliable size.
	hasher := sha256.New()
	written, copyErr := io.Copy(io.MultiWriter(staged, hasher), io.LimitReader(src, MaxBytes+1))
	closeErr := staged.Close()
	if copyErr != nil {
		_ = os.Remove(stagedPath)
		return domain.Artifact{}, fmt.Errorf("failed to copy media: %w", copyErr)
	}
	if closeErr != nil {
		_ = os.Remove(stagedPath)
		return domain.Artifact{}, fmt.Errorf("failed to flush media: %w", closeErr)
	}
	if written > MaxBytes {
		_ = os.Remove(stagedPath)
		return domain.Artifact{}, fmt.Errorf("%s exceeds the %d byte attachment limit", fileName, MaxBytes)
	}

	digest := hex.EncodeToString(hasher.Sum(nil))
	targetPath := filepath.Join(dir, digest+strings.ToLower(filepath.Ext(baseName)))

	// Identical bytes already on disk: drop the staged copy and reuse the file.
	if _, statErr := os.Stat(targetPath); statErr == nil {
		_ = os.Remove(stagedPath)
	} else {
		if err := os.Chmod(stagedPath, 0o644); err != nil {
			_ = os.Remove(stagedPath)
			return domain.Artifact{}, fmt.Errorf("cannot set permissions on %s: %w", stagedPath, err)
		}
		if err := os.Rename(stagedPath, targetPath); err != nil {
			_ = os.Remove(stagedPath)
			return domain.Artifact{}, fmt.Errorf("cannot commit media to %s: %w", targetPath, err)
		}
	}

	mimeType := ResolveMime(targetPath, baseName, "")

	return domain.Artifact{
		ID:        artID,
		TaskID:    ownerID,
		Role:      domain.ArtifactRoleInput,
		Name:      baseName,
		Type:      Classify(mimeType, baseName),
		FilePath:  targetPath,
		MimeType:  mimeType,
		ByteSize:  written,
		Sha256:    digest,
		CreatedAt: time.Now().UTC(),
	}, nil
}

// Remove deletes a copied attachment. Paths outside the attachment root are
// refused. A missing file is treated as already removed.
func Remove(filePath string) error {
	root, err := storageRoot()
	if err != nil {
		return err
	}

	absRoot, err := filepath.Abs(root)
	if err != nil {
		return err
	}
	absFile, err := filepath.Abs(filePath)
	if err != nil {
		return err
	}
	rel, err := filepath.Rel(absRoot, absFile)
	if err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
		return fmt.Errorf("%s is outside the attachment store", filePath)
	}

	if err := os.Remove(absFile); err != nil && !os.IsNotExist(err) {
		return fmt.Errorf("failed to remove %s: %w", filePath, err)
	}
	return nil
}

// ValidateOwnerID rejects values that would escape the attachment directory when
// used as a path component. Owner ids are task ids or resource ids.
func ValidateOwnerID(ownerID string) error {
	if ownerID == "" {
		return fmt.Errorf("owner id cannot be empty")
	}
	if strings.ContainsAny(ownerID, `/\`) || ownerID == "." || ownerID == ".." {
		return fmt.Errorf("owner id %q is not a safe path component", ownerID)
	}
	return nil
}

// ResolveMime prefers the declared type, then the file extension, then content
// sniffing. It is shared by the MCP ingest path and the HTTP upload path.
func ResolveMime(path, name, declared string) string {
	if declared != "" && declared != "application/octet-stream" {
		return declared
	}
	if byExt := mime.TypeByExtension(filepath.Ext(name)); byExt != "" {
		return byExt
	}
	return sniffMime(path)
}

// Classify maps a MIME type and file name onto the artifact taxonomy.
func Classify(mimeType, name string) domain.ArtifactType {
	switch {
	case strings.HasPrefix(mimeType, "image/"):
		return domain.ArtifactTypeImage
	case strings.Contains(mimeType, "markdown") || strings.HasSuffix(strings.ToLower(name), ".md"):
		return domain.ArtifactTypeMarkdown
	case strings.Contains(mimeType, "pdf"):
		return domain.ArtifactTypeDoc
	default:
		return domain.ArtifactTypeFile
	}
}

func sniffMime(path string) string {
	file, err := os.Open(path)
	if err != nil {
		return "application/octet-stream"
	}
	defer file.Close()

	buf := make([]byte, 512)
	n, err := file.Read(buf)
	if err != nil && n == 0 {
		return "application/octet-stream"
	}
	return http.DetectContentType(buf[:n])
}

// GC deletes attachment files that no longer have a metadata row. keep holds the
// absolute file paths that are still referenced; empty directories left behind
// are pruned as well.
func GC(keep map[string]struct{}) ([]string, error) {
	root, err := storageRoot()
	if err != nil {
		return nil, err
	}

	removed := make([]string, 0)
	dirs := make([]string, 0)

	walkErr := filepath.WalkDir(root, func(path string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			if os.IsNotExist(walkErr) {
				return nil
			}
			return walkErr
		}
		if entry.IsDir() {
			if path != root {
				dirs = append(dirs, path)
			}
			return nil
		}
		if _, referenced := keep[path]; referenced {
			return nil
		}
		if err := os.Remove(path); err != nil && !os.IsNotExist(err) {
			return err
		}
		removed = append(removed, path)
		return nil
	})
	if walkErr != nil && !os.IsNotExist(walkErr) {
		return removed, fmt.Errorf("failed to scan attachment store: %w", walkErr)
	}

	// Deepest directories first so parents become empty before they are tested.
	sort.Sort(sort.Reverse(sort.StringSlice(dirs)))
	for _, dir := range dirs {
		entries, err := os.ReadDir(dir)
		if err != nil || len(entries) > 0 {
			continue
		}
		_ = os.Remove(dir)
	}

	return removed, nil
}
