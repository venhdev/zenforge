package storage

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"embed"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"os"
	"sort"
	"strconv"
	"strings"
)

// Embedded, ordered schema migrations. `0001_baseline.sql` is the frozen
// v0.1.0 baseline; every later schema change is a new NNNN_*.sql step that the
// runner applies automatically and records in `schema_migrations`.
//
//go:embed migrations/*.sql
var migrationFS embed.FS

const migrationDir = "migrations"

// CurrentSchemaVersion is the newest embedded migration. A test keeps it in
// sync with the migrations directory so a forgotten bump fails the build.
const CurrentSchemaVersion = "1"

var (
	// ErrLegacyDatabase reports a database created before the migration ledger
	// existed (or any database with tables but no ledger). The runner never
	// mutates such a file: the operator backs it up and starts fresh.
	ErrLegacyDatabase = errors.New("incompatible legacy database")
	// ErrDatabaseAhead reports a database whose applied version is newer than
	// the binary, which happens when an older binary opens a dev-upgraded file.
	ErrDatabaseAhead = errors.New("database schema is newer than this binary")
	// ErrMigrationDrift reports an embedded migration whose content no longer
	// matches the checksum recorded when it was applied.
	ErrMigrationDrift = errors.New("applied migration was modified")
)

type migration struct {
	version  int
	name     string
	filename string
	content  string
}

func (m migration) checksum() string {
	sum := sha256.Sum256([]byte(m.content))
	return hex.EncodeToString(sum[:])
}

// loadMigrations reads and orders the embedded migration steps.
func loadMigrations() ([]migration, error) {
	entries, err := migrationFS.ReadDir(migrationDir)
	if err != nil {
		return nil, fmt.Errorf("failed to read embedded migrations: %w", err)
	}

	migrations := make([]migration, 0, len(entries))
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".sql") {
			continue
		}
		parts := strings.SplitN(entry.Name(), "_", 2)
		if len(parts) != 2 {
			return nil, fmt.Errorf("migration %q must be named NNNN_description.sql", entry.Name())
		}
		version, err := strconv.Atoi(parts[0])
		if err != nil || version <= 0 {
			return nil, fmt.Errorf("migration %q has an invalid version prefix", entry.Name())
		}
		raw, err := migrationFS.ReadFile(migrationDir + "/" + entry.Name())
		if err != nil {
			return nil, fmt.Errorf("failed to read migration %q: %w", entry.Name(), err)
		}
		migrations = append(migrations, migration{
			version:  version,
			name:     strings.TrimSuffix(parts[1], ".sql"),
			filename: entry.Name(),
			content:  string(raw),
		})
	}

	if len(migrations) == 0 {
		return nil, errors.New("no embedded schema migrations found")
	}
	sort.Slice(migrations, func(i, j int) bool {
		return migrations[i].version < migrations[j].version
	})
	for i := 1; i < len(migrations); i++ {
		if migrations[i].version == migrations[i-1].version {
			return nil, fmt.Errorf("duplicate migration version %04d", migrations[i].version)
		}
	}
	return migrations, nil
}

// migrate loads the embedded steps and applies everything the database is
// missing. It never rotates or renames the database file.
func migrate(ctx context.Context, conn *sql.DB, dbPath string) error {
	migrations, err := loadMigrations()
	if err != nil {
		return err
	}
	return applyMigrations(ctx, conn, dbPath, migrations)
}

// applyMigrations is the testable core: apply `migrations` in version order.
func applyMigrations(ctx context.Context, conn *sql.DB, dbPath string, migrations []migration) error {
	if len(migrations) == 0 {
		return errors.New("no migrations to apply")
	}
	latest := migrations[len(migrations)-1].version

	ledgerExists, err := tableExists(ctx, conn, "schema_migrations")
	if err != nil {
		return err
	}
	if !ledgerExists {
		// A file with app tables but no ledger predates the migration mechanism.
		// Fail closed instead of guessing or silently relabelling its version.
		hasTables, err := hasAnyUserTable(ctx, conn)
		if err != nil {
			return err
		}
		if hasTables {
			return fmt.Errorf(
				"%w: %s has existing tables but no schema_migrations ledger; back it up and delete it to start fresh",
				ErrLegacyDatabase, dbPath,
			)
		}
		if err := createLedger(ctx, conn); err != nil {
			return err
		}
	}

	applied, err := loadAppliedMigrations(ctx, conn)
	if err != nil {
		return err
	}

	latestApplied := 0
	for version := range applied {
		if version > latestApplied {
			latestApplied = version
		}
	}
	if latestApplied > latest {
		return fmt.Errorf(
			"%w: applied schema v%d but this binary only knows v%d; upgrade zenf before opening %s",
			ErrDatabaseAhead, latestApplied, latest, dbPath,
		)
	}

	byVersion := make(map[int]migration, len(migrations))
	for _, m := range migrations {
		byVersion[m.version] = m
	}
	for version, checksum := range applied {
		m, ok := byVersion[version]
		if !ok {
			return fmt.Errorf("%w: applied migration %04d is missing from this binary", ErrMigrationDrift, version)
		}
		if m.checksum() != checksum {
			return fmt.Errorf(
				"%w: %s changed after it was applied; restore the original file or reset the development database",
				ErrMigrationDrift, m.filename,
			)
		}
	}

	pending := make([]migration, 0, len(migrations))
	for _, m := range migrations {
		if m.version > latestApplied {
			pending = append(pending, m)
		}
	}
	if len(pending) == 0 {
		return nil
	}

	// Keep exactly one recovery point for the upgrade path.
	if latestApplied > 0 && dbPath != ":memory:" {
		if err := backupDatabase(ctx, conn, dbPath); err != nil {
			return err
		}
	}

	for _, m := range pending {
		if err := applyMigration(ctx, conn, m); err != nil {
			return err
		}
	}
	return nil
}

func applyMigration(ctx context.Context, conn *sql.DB, m migration) error {
	tx, err := conn.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("failed to start migration %s: %w", m.filename, err)
	}
	defer func() {
		_ = tx.Rollback()
	}()

	if _, err := tx.ExecContext(ctx, m.content); err != nil {
		return fmt.Errorf("migration %s failed: %w", m.filename, err)
	}
	if _, err := tx.ExecContext(ctx,
		"INSERT INTO schema_migrations (version, name, checksum, applied_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)",
		m.version, m.name, m.checksum(),
	); err != nil {
		return fmt.Errorf("failed to record migration %s: %w", m.filename, err)
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("failed to commit migration %s: %w", m.filename, err)
	}
	return nil
}

func createLedger(ctx context.Context, conn *sql.DB) error {
	_, err := conn.ExecContext(ctx, `
		CREATE TABLE IF NOT EXISTS schema_migrations (
			version    INTEGER PRIMARY KEY,
			name       TEXT NOT NULL,
			checksum   TEXT NOT NULL,
			applied_at DATETIME NOT NULL
		)`)
	if err != nil {
		return fmt.Errorf("failed to create schema_migrations ledger: %w", err)
	}
	return nil
}

func loadAppliedMigrations(ctx context.Context, conn *sql.DB) (map[int]string, error) {
	rows, err := conn.QueryContext(ctx, "SELECT version, checksum FROM schema_migrations")
	if err != nil {
		return nil, fmt.Errorf("failed to read schema_migrations: %w", err)
	}
	defer rows.Close()

	applied := make(map[int]string)
	for rows.Next() {
		var version int
		var checksum string
		if err := rows.Scan(&version, &checksum); err != nil {
			return nil, fmt.Errorf("failed to scan schema_migrations: %w", err)
		}
		applied[version] = checksum
	}
	return applied, rows.Err()
}

func hasAnyUserTable(ctx context.Context, conn *sql.DB) (bool, error) {
	var count int
	err := conn.QueryRowContext(ctx, `
		SELECT COUNT(*) FROM sqlite_master
		WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name <> 'schema_migrations'`).Scan(&count)
	if err != nil {
		return false, fmt.Errorf("failed to inspect sqlite_master: %w", err)
	}
	return count > 0, nil
}

// backupDatabase writes a single pre-migration recovery copy next to the
// database. WAL is checkpointed first so the copy is self-contained.
func backupDatabase(ctx context.Context, conn *sql.DB, dbPath string) error {
	if _, err := conn.ExecContext(ctx, "PRAGMA wal_checkpoint(TRUNCATE)"); err != nil {
		return fmt.Errorf("failed to checkpoint before migration backup: %w", err)
	}

	src, err := os.Open(dbPath)
	if err != nil {
		return fmt.Errorf("failed to open database for backup: %w", err)
	}
	defer src.Close()

	backupPath := dbPath + ".pre-migration.bak"
	dst, err := os.Create(backupPath)
	if err != nil {
		return fmt.Errorf("failed to create migration backup %s: %w", backupPath, err)
	}
	if _, err := io.Copy(dst, src); err != nil {
		_ = dst.Close()
		return fmt.Errorf("failed to write migration backup %s: %w", backupPath, err)
	}
	if err := dst.Sync(); err != nil {
		_ = dst.Close()
		return fmt.Errorf("failed to sync migration backup %s: %w", backupPath, err)
	}
	if err := dst.Close(); err != nil {
		return fmt.Errorf("failed to close migration backup %s: %w", backupPath, err)
	}
	return nil
}
