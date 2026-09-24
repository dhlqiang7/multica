package main

import (
	"context"
	"math/rand/v2"
	"slices"
	"testing"
	"time"
)

func TestCommentSendIntentMigrationsUpDownUpInIsolatedSchema(t *testing.T) {
	base := openTestPool(t)
	ctx, cancel := context.WithTimeout(t.Context(), 30*time.Second)
	defer cancel()
	schema := createScratchSchema(t, ctx, base, "comment_send_intent_")
	pool := openTestPoolWithSearchPath(t, schema)
	if _, err := pool.Exec(ctx, `CREATE TABLE comment (id UUID PRIMARY KEY, issue_id UUID NOT NULL, author_id UUID NOT NULL)`); err != nil {
		t.Fatal(err)
	}

	for _, direction := range []string{"up", "down", "up"} {
		versions := []string{"550_comment_send_intent", "551_comment_client_request_index", "552_comment_request_dispatched"}
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
		var columns int
		if err := pool.QueryRow(ctx, `
			SELECT count(*) FROM information_schema.columns
			WHERE table_schema = $1 AND table_name = 'comment'
			  AND column_name IN ('client_request_id', 'suppressed_agent_ids', 'client_request_dispatched_at')
		`, schema).Scan(&columns); err != nil {
			t.Fatal(err)
		}
		if want := map[string]int{"up": 3, "down": 0}[direction]; columns != want {
			t.Fatalf("after %s, send-intent columns = %d, want %d", direction, columns, want)
		}
	}

	var valid bool
	if err := pool.QueryRow(ctx, `
		SELECT i.indisvalid AND i.indisunique FROM pg_index i
		JOIN pg_class c ON c.oid = i.indexrelid
		JOIN pg_namespace n ON n.oid = c.relnamespace
		WHERE n.nspname = $1 AND c.relname = 'comment_client_request_uidx'
	`, schema).Scan(&valid); err != nil || !valid {
		t.Fatalf("comment_client_request_uidx valid unique = %v: %v", valid, err)
	}
	// One author's logical send on an issue is saved once; comments without a
	// request id are unconstrained.
	insert := `INSERT INTO comment (id, issue_id, author_id, client_request_id) VALUES (gen_random_uuid(), $1, $2, $3)`
	issue, author, request := "0199a4e8-22ce-7b01-bba5-000000000001", "0199a4e8-22ce-7b01-bba5-000000000002", "0199a4e8-22ce-7b01-bba5-000000000003"
	for i := 0; i < 2; i++ {
		if _, err := pool.Exec(ctx, insert, issue, author, nil); err != nil {
			t.Fatalf("comment without a request: %v", err)
		}
	}
	if _, err := pool.Exec(ctx, insert, issue, author, request); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, insert, issue, author, request); err == nil {
		t.Fatal("a second comment for the same send was accepted")
	}
}
