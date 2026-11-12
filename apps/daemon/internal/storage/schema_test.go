package storage

import (
	"context"
	"os"
	"path/filepath"
	"testing"
)

func TestSchema_CreatesBaselineTrackingPlane(t *testing.T) {
	db, err := Open(filepath.Join(t.TempDir(), "schema.db"))
	if err != nil {
		t.Fatalf("Open failed: %v", err)
	}
	defer db.Close()

	ctx := context.Background()
	for _, table := range []string{
		"schema_migrations", "projects", "plans", "tasks", "resources", "resources_fts",
		"resource_tags", "agents", "artifacts", "events",
	} {
		exists, err := tableExists(ctx, db.sqlDB, table)
		if err != nil {
			t.Fatalf("tableExists(%s) failed: %v", table, err)
		}
		if !exists {
			t.Errorf("expected table %s to exist", table)
		}
	}

	for _, column := range []string{
		"project_slug", "plan_slug", "agent_slug", "required_docs",
		"claim_session_id", "review_options", "auto_run",
		"phases", "current_phase",
	} {
		exists, err := columnExists(ctx, db.sqlDB, "tasks", column)
		if err != nil {
			t.Fatalf("columnExists(tasks.%s) failed: %v", column, err)
		}
		if !exists {
			t.Errorf("expected tasks.%s to exist", column)
		}
	}
}

func TestSchema_RecordsAppliedMigration(t *testing.T) {
	db, err := Open(filepath.Join(t.TempDir(), "version.db"))
	if err != nil {
		t.Fatalf("Open failed: %v", err)
	}
	defer db.Close()

	var version int
	if err := db.QueryRow(context.Background(),
		"SELECT MAX(version) FROM schema_migrations").Scan(&version); err != nil {
		t.Fatalf("failed to read schema_migrations: %v", err)
	}
	if version != 1 || CurrentSchemaVersion != "1" {
		t.Fatalf("expected applied v1 and CurrentSchemaVersion 1, got %d / %s", version, CurrentSchemaVersion)
	}
}

func TestSchema_ReopenPreservesData(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "reopen.db")
	db, err := Open(dbPath)
	if err != nil {
		t.Fatalf("Open failed: %v", err)
	}
	if _, err := db.sqlDB.Exec(`
		INSERT INTO projects (slug, name, created_at, updated_at)
		VALUES ('p1', 'Project One', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`); err != nil {
		_ = db.Close()
		t.Fatalf("failed to seed project: %v", err)
	}
	if err := db.Close(); err != nil {
		t.Fatalf("failed to close: %v", err)
	}

	reopened, err := Open(dbPath)
	if err != nil {
		t.Fatalf("reopen failed: %v", err)
	}
	defer reopened.Close()

	var name string
	if err := reopened.QueryRow(context.Background(),
		"SELECT name FROM projects WHERE slug = 'p1'").Scan(&name); err != nil {
		t.Fatalf("expected data to survive reopen: %v", err)
	}
	if name != "Project One" {
		t.Fatalf("name = %q, want Project One", name)
	}

	var migrations int
	if err := reopened.QueryRow(context.Background(),
		"SELECT COUNT(*) FROM schema_migrations").Scan(&migrations); err != nil {
		t.Fatalf("failed to count migrations: %v", err)
	}
	if migrations != 1 {
		t.Fatalf("expected 1 applied migration after reopen, got %d", migrations)
	}
}

func TestSchema_DoesNotRotateDatabase(t *testing.T) {
	dbDir := t.TempDir()
	dbPath := filepath.Join(dbDir, "state.db")

	db, err := Open(dbPath)
	if err != nil {
		t.Fatalf("Open failed: %v", err)
	}
	if err := db.Close(); err != nil {
		t.Fatalf("close failed: %v", err)
	}

	entries, err := os.ReadDir(dbDir)
	if err != nil {
		t.Fatalf("ReadDir failed: %v", err)
	}
	for _, entry := range entries {
		switch entry.Name() {
		case "state.db", "state.db-wal", "state.db-shm":
		default:
			t.Fatalf("unexpected file created next to the database: %s", entry.Name())
		}
	}
}
