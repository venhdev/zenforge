package storage

import (
	"context"
	"database/sql"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"

	"github.com/ncruces/go-sqlite3/driver"
	"github.com/ncruces/go-sqlite3/ext/fts5"
)

// DB encapsulates the connection pool for SQLite WAL.
type DB struct {
	sqlDB   *sql.DB
	writeMu sync.Mutex // Serializes write transactions to prevent lock contention
}

// Open creates parent directories, opens the SQLite database with WAL pragmas,
// and applies any pending schema migrations. A database that predates the
// migration ledger (or was written by a newer binary) is rejected without
// being modified.
func Open(dbPath string) (*DB, error) {
	if dbPath != ":memory:" {
		if err := os.MkdirAll(filepath.Dir(dbPath), 0755); err != nil {
			return nil, fmt.Errorf("failed to create db directory: %w", err)
		}
	}

	dsn := fmt.Sprintf("file:%s?_pragma=journal_mode(WAL)&_pragma=synchronous(NORMAL)&_pragma=busy_timeout(5000)&_pragma=foreign_keys(ON)&_txlock=immediate", dbPath)
	conn, err := driver.Open(dsn, fts5.Register)
	if err != nil {
		return nil, fmt.Errorf("failed to open sqlite database: %w", err)
	}

	maxConns := 10
	if dbPath == ":memory:" {
		maxConns = 1
	}
	conn.SetMaxOpenConns(maxConns)
	conn.SetMaxIdleConns(maxConns)
	conn.SetConnMaxLifetime(0)

	if err := conn.Ping(); err != nil {
		_ = conn.Close()
		return nil, fmt.Errorf("failed to ping sqlite database: %w", err)
	}

	var journalMode string
	if err := conn.QueryRow("PRAGMA journal_mode;").Scan(&journalMode); err != nil {
		_ = conn.Close()
		return nil, fmt.Errorf("failed to verify journal mode: %w", err)
	}
	if strings.ToUpper(journalMode) != "WAL" && dbPath != ":memory:" {
		_ = conn.Close()
		return nil, fmt.Errorf("expected WAL journal mode, got: %s", journalMode)
	}

	ctx := context.Background()
	if err := migrate(ctx, conn, dbPath); err != nil {
		_ = conn.Close()
		return nil, err
	}

	return &DB{sqlDB: conn}, nil
}

func tableExists(ctx context.Context, conn *sql.DB, name string) (bool, error) {
	var count int
	err := conn.QueryRowContext(ctx,
		"SELECT COUNT(*) FROM sqlite_master WHERE type IN ('table','view') AND name = ?", name).Scan(&count)
	if err != nil {
		return false, fmt.Errorf("failed to inspect table %s: %w", name, err)
	}
	return count > 0, nil
}

func columnExists(ctx context.Context, conn *sql.DB, table, column string) (bool, error) {
	rows, err := conn.QueryContext(ctx, "PRAGMA table_info("+table+")")
	if err != nil {
		return false, fmt.Errorf("failed to inspect table %s: %w", table, err)
	}
	defer rows.Close()

	for rows.Next() {
		var (
			cid        int
			name       string
			colType    string
			notNull    int
			defaultV   sql.NullString
			primaryKey int
		)
		if err := rows.Scan(&cid, &name, &colType, &notNull, &defaultV, &primaryKey); err != nil {
			return false, fmt.Errorf("failed to scan table info for %s: %w", table, err)
		}
		if name == column {
			return true, nil
		}
	}
	return false, rows.Err()
}

// Query executes a read-only query that returns rows without acquiring writeMu.
func (d *DB) Query(ctx context.Context, query string, args ...any) (*sql.Rows, error) {
	return d.sqlDB.QueryContext(ctx, query, args...)
}

// QueryRow executes a read-only query that returns at most one row without
// acquiring writeMu.
func (d *DB) QueryRow(ctx context.Context, query string, args ...any) *sql.Row {
	return d.sqlDB.QueryRowContext(ctx, query, args...)
}

// ExecImmediate executes a write operation inside an immediate transaction,
// serializing access via writeMu to prevent in-process writer contention.
func (d *DB) ExecImmediate(ctx context.Context, fn func(tx *sql.Tx) error) error {
	d.writeMu.Lock()
	defer d.writeMu.Unlock()

	tx, err := d.sqlDB.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelDefault})
	if err != nil {
		return fmt.Errorf("failed to begin transaction: %w", err)
	}
	defer tx.Rollback()

	if err := fn(tx); err != nil {
		return err
	}

	if err := tx.Commit(); err != nil {
		return fmt.Errorf("failed to commit transaction: %w", err)
	}

	return nil
}

// Close gracefully terminates the database connection pool.
func (d *DB) Close() error {
	return d.sqlDB.Close()
}
