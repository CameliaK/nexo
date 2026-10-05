// Package db opens the gateway's Postgres pool and applies its own
// migrations. The agent still owns its tables (rag_fragments,
// generated_nodes, live_messages); the gateway owns accounts and friends.
package db

import (
	"context"
	"embed"
	"fmt"
	"io/fs"
	"log"
	"sort"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

//go:embed migrations/*.sql
var migrations embed.FS

// Open connects to Postgres, retrying for ~30 s while the container starts.
func Open(ctx context.Context, url string) (*pgxpool.Pool, error) {
	pool, err := pgxpool.New(ctx, url)
	if err != nil {
		return nil, fmt.Errorf("parse POSTGRES_URL: %w", err)
	}
	for attempt := 1; ; attempt++ {
		pingCtx, cancel := context.WithTimeout(ctx, 3*time.Second)
		err = pool.Ping(pingCtx)
		cancel()
		if err == nil {
			return pool, nil
		}
		if attempt == 15 {
			pool.Close()
			return nil, fmt.Errorf("postgres unreachable: %w", err)
		}
		log.Printf("db: waiting for postgres (attempt %d): %v", attempt, err)
		time.Sleep(2 * time.Second)
	}
}

// Migrate applies every migrations/*.sql not yet recorded in
// gateway_migrations, in filename order, each in its own transaction.
// An advisory lock keeps two gateway replicas from racing.
func Migrate(ctx context.Context, pool *pgxpool.Pool) error {
	conn, err := pool.Acquire(ctx)
	if err != nil {
		return err
	}
	defer conn.Release()

	const lockID = 7_412_001 // arbitrary, unique to the gateway
	if _, err := conn.Exec(ctx, "SELECT pg_advisory_lock($1)", lockID); err != nil {
		return fmt.Errorf("advisory lock: %w", err)
	}
	defer conn.Exec(context.Background(), "SELECT pg_advisory_unlock($1)", lockID)

	if _, err := conn.Exec(ctx, `CREATE TABLE IF NOT EXISTS gateway_migrations (
		version    TEXT PRIMARY KEY,
		applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`); err != nil {
		return fmt.Errorf("create gateway_migrations: %w", err)
	}

	names, err := fs.Glob(migrations, "migrations/*.sql")
	if err != nil {
		return err
	}
	sort.Strings(names)
	for _, name := range names {
		var done bool
		if err := conn.QueryRow(ctx,
			"SELECT EXISTS (SELECT 1 FROM gateway_migrations WHERE version = $1)", name,
		).Scan(&done); err != nil {
			return err
		}
		if done {
			continue
		}
		sqlText, err := migrations.ReadFile(name)
		if err != nil {
			return err
		}
		tx, err := conn.Begin(ctx)
		if err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, string(sqlText)); err != nil {
			tx.Rollback(ctx)
			return fmt.Errorf("%s: %w", name, err)
		}
		if _, err := tx.Exec(ctx, "INSERT INTO gateway_migrations (version) VALUES ($1)", name); err != nil {
			tx.Rollback(ctx)
			return err
		}
		if err := tx.Commit(ctx); err != nil {
			return err
		}
		log.Printf("db: applied %s", name)
	}
	return nil
}
