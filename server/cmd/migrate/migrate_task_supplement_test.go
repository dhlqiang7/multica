package main

import (
	"context"
	"math/rand/v2"
	"slices"
	"testing"
	"time"
)

func TestTaskSupplementMigrationsUpDownUpInIsolatedSchema(t *testing.T) {
	base := openTestPool(t)
	ctx, cancel := context.WithTimeout(t.Context(), 30*time.Second)
	defer cancel()
	schema := createScratchSchema(t, ctx, base, "task_supplement_")
	pool := openTestPoolWithSearchPath(t, schema)
	if _, err := pool.Exec(ctx, `CREATE TABLE agent_task_queue (id UUID PRIMARY KEY, status TEXT NOT NULL)`); err != nil {
		t.Fatal(err)
	}

	for _, direction := range []string{"up", "down", "up"} {
		versions := []string{
			"536_task_supplement",
			"537_task_supplement_request_index",
			"538_task_supplement_capability_index",
			"539_task_supplement_comment_index",
		}
		if direction == "down" {
			slices.Reverse(versions)
		}
		if err := runMigrations(ctx, pool, runOptions{
			Direction:             direction,
			Files:                 realMigrationFiles(t, versions, direction),
			SchemaMigrationsTable: schema + ".schema_migrations",
			AdvisoryLockKey:       int64(rand.Uint64()&0x7fffffffffffffff) | 1,
			Hooks:                 hooksForDirection(direction),
			Conditions:            conditionsForDirection(direction),
		}); err != nil {
			t.Fatalf("migrate %s: %v", direction, err)
		}
		for _, table := range []string{"task_supplement", "task_supplement_capability"} {
			var exists bool
			if err := pool.QueryRow(ctx, `SELECT to_regclass($1) IS NOT NULL`, schema+"."+table).Scan(&exists); err != nil || exists != (direction == "up") {
				t.Fatalf("after %s, table %s exists=%v: %v", direction, table, exists, err)
			}
		}
		if direction == "up" {
			var indexes int
			err := pool.QueryRow(ctx, `
				SELECT count(*) FROM pg_index i
				JOIN pg_class c ON c.oid = i.indexrelid
				JOIN pg_namespace n ON n.oid = c.relnamespace
				WHERE n.nspname = $1 AND i.indisvalid AND c.relname = ANY($2::text[])
			`, schema, []string{"task_supplement_task_request_uidx", "task_supplement_capability_task_uidx", "task_supplement_comment_uidx"}).Scan(&indexes)
			if err != nil || indexes != 3 {
				t.Fatalf("valid supplement indexes = %d, want 3: %v", indexes, err)
			}
		}
	}
}
