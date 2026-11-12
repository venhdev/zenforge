package storage

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strconv"
	"testing"

	"github.com/ncruces/go-sqlite3/driver"
	"github.com/ncruces/go-sqlite3/ext/fts5"
)

func openRawDB(t *testing.T, path string, statements string) {
	t.Helper()
	conn, err := driver.Open("file:"+path, fts5.Register)
	if err != nil {
		t.Fatalf("failed to create raw db: %v", err)
	}
	if _, err := conn.Exec(statements); err != nil {
		_ = conn.Close()
		t.Fatalf("failed to seed raw db: %v", err)
	}
	if err := conn.Close(); err != nil {
		t.Fatalf("failed to close raw db: %v", err)
	}
}

func TestMigrate_CurrentVersionMatchesLatestEmbedded(t *testing.T) {
	migrations, err := loadMigrations()
	if err != nil {
		t.Fatalf("loadMigrations failed: %v", err)
	}
	latest := migrations[len(migrations)-1]
	if strconv.Itoa(latest.version) != CurrentSchemaVersion {
		t.Fatalf("CurrentSchemaVersion = %q, want latest embedded version %d", CurrentSchemaVersion, latest.version)
	}
	if latest.name != "baseline" {
		t.Fatalf("expected 0001 name 'baseline', got %q", latest.name)
	}
}

func TestMigrate_RejectsLegacyDatabaseWithoutMutatingIt(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "legacy.db")
	openRawDB(t, dbPath, `
		CREATE TABLE schema_info (version TEXT PRIMARY KEY, created_at DATETIME NOT NULL);
		INSERT INTO schema_info VALUES ('4', CURRENT_TIMESTAMP);
		CREATE TABLE tasks (id TEXT PRIMARY KEY);
	`)

	_, err := Open(dbPath)
	if !errors.Is(err, ErrLegacyDatabase) {
		t.Fatalf("expected ErrLegacyDatabase, got %v", err)
	}

	conn, err := driver.Open("file:"+dbPath, fts5.Register)
	if err != nil {
		t.Fatalf("failed to reopen legacy db: %v", err)
	}
	defer conn.Close()

	var ledgerCount int
	if err := conn.QueryRow("SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='schema_migrations'").
		Scan(&ledgerCount); err != nil {
		t.Fatalf("failed to inspect sqlite_master: %v", err)
	}
	if ledgerCount != 0 {
		t.Fatalf("legacy database must not gain a migration ledger")
	}
}

func TestMigrate_RejectsNewerDatabase(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "ahead.db")
	db, err := Open(dbPath)
	if err != nil {
		t.Fatalf("Open failed: %v", err)
	}
	if err := db.Close(); err != nil {
		t.Fatalf("close failed: %v", err)
	}

	openRawDB(t, dbPath, `UPDATE schema_migrations SET version = 99 WHERE version = 1;`)

	_, err = Open(dbPath)
	if !errors.Is(err, ErrDatabaseAhead) {
		t.Fatalf("expected ErrDatabaseAhead, got %v", err)
	}
}

func TestMigrate_RejectsModifiedAppliedMigration(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "drift.db")
	db, err := Open(dbPath)
	if err != nil {
		t.Fatalf("Open failed: %v", err)
	}
	if err := db.Close(); err != nil {
		t.Fatalf("close failed: %v", err)
	}

	openRawDB(t, dbPath, `UPDATE schema_migrations SET checksum = 'tampered' WHERE version = 1;`)

	_, err = Open(dbPath)
	if !errors.Is(err, ErrMigrationDrift) {
		t.Fatalf("expected ErrMigrationDrift, got %v", err)
	}
}

func TestMigrate_AppliesPendingStepsAndWritesBackup(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "pending.db")
	db, err := Open(dbPath)
	if err != nil {
		t.Fatalf("Open failed: %v", err)
	}
	defer db.Close()

	base, err := loadMigrations()
	if err != nil {
		t.Fatalf("loadMigrations failed: %v", err)
	}
	step := migration{
		version:  2,
		name:     "add_scratch",
		filename: "0002_add_scratch.sql",
		content:  "CREATE TABLE scratch (id INTEGER PRIMARY KEY);",
	}

	if err := applyMigrations(context.Background(), db.sqlDB, dbPath, append(base, step)); err != nil {
		t.Fatalf("applyMigrations failed: %v", err)
	}

	var applied int
	if err := db.QueryRow(context.Background(),
		"SELECT COUNT(*) FROM schema_migrations WHERE version IN (1, 2)").Scan(&applied); err != nil {
		t.Fatalf("failed to count migrations: %v", err)
	}
	if applied != 2 {
		t.Fatalf("expected 2 applied migrations, got %d", applied)
	}

	var count int
	if err := db.QueryRow(context.Background(),
		"SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='scratch'").Scan(&count); err != nil {
		t.Fatalf("failed to inspect scratch table: %v", err)
	}
	if count != 1 {
		t.Fatalf("expected scratch table to exist")
	}

	if _, err := os.Stat(dbPath + ".pre-migration.bak"); err != nil {
		t.Fatalf("expected pre-migration backup, got %v", err)
	}
}

func TestMigrate_FailedStepLeavesSchemaUntouched(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "failed.db")
	db, err := Open(dbPath)
	if err != nil {
		t.Fatalf("Open failed: %v", err)
	}
	defer db.Close()

	base, err := loadMigrations()
	if err != nil {
		t.Fatalf("loadMigrations failed: %v", err)
	}
	bad := migration{
		version:  2,
		name:     "broken",
		filename: "0002_broken.sql",
		content:  "CREATE TABLE broken (id INTEGER PRIMARY KEY); CREATE TABLE broken (id INTEGER);",
	}

	if err := applyMigrations(context.Background(), db.sqlDB, dbPath, append(base, bad)); err == nil {
		t.Fatal("expected the broken migration to fail")
	}

	var applied int
	if err := db.QueryRow(context.Background(),
		"SELECT COUNT(*) FROM schema_migrations WHERE version = 2").Scan(&applied); err != nil {
		t.Fatalf("failed to count migrations: %v", err)
	}
	if applied != 0 {
		t.Fatalf("failed migration must not be recorded")
	}

	var count int
	if err := db.QueryRow(context.Background(),
		"SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='broken'").Scan(&count); err != nil {
		t.Fatalf("failed to inspect broken table: %v", err)
	}
	if count != 0 {
		t.Fatalf("failed migration must roll back its DDL")
	}
}
