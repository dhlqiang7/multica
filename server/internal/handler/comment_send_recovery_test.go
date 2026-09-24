package handler

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/multica-ai/multica/server/internal/testutil"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
)

// failSendClaim fails every attempt to claim a send for dispatch.
type failSendClaim struct{ db.DBTX }

func (q failSendClaim) Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error) {
	if strings.Contains(sql, "-- name: ClaimCommentSendDispatch") {
		return pgconn.CommandTag{}, errors.New("claim write failed")
	}
	return q.DBTX.Exec(ctx, sql, args...)
}

func TestCreateCommentSendReachesItsAgentsExactlyOnceAcrossRetries(t *testing.T) {
	f := newSupplementFixture(t, "codex", "running", true)
	dbfx.Cleanup(t, `DELETE FROM agent_task_queue WHERE issue_id = $1`, f.issueID)
	dbfx.Exec(t, `UPDATE agent_task_queue SET delivered_comment_ids = ARRAY[trigger_comment_id] WHERE id = $1`, f.taskID)
	body := map[string]any{
		"content":           agentMention("A", f.agentID) + " do this once",
		"steer_task_ids":    []string{f.taskID},
		"client_request_id": "0199a4e8-22ce-7b01-bba5-666666666666",
	}
	send := func(h *Handler) *testutil.Response {
		return testutil.Call(t, h.CreateComment, withURLParam(newRequest(http.MethodPost,
			"/api/issues/"+f.issueID+"/comments", body), "id", f.issueID))
	}
	// The first attempt saves the comment but cannot claim the send, so it
	// reaches no one and asks the client to retry.
	failing := *testHandler
	failing.Queries = db.New(failSendClaim{testPool})
	send(&failing).Want(http.StatusInternalServerError)
	if n := dbfx.Count(t, `SELECT count(*) FROM task_supplement WHERE task_id = $1`, f.taskID); n != 0 {
		t.Fatalf("an unclaimed send steered the turn %d times", n)
	}
	// The retry claims it and steers the turn.
	var retried CommentResponse
	send(testHandler).Want(http.StatusOK).JSON(&retried)
	if len(retried.Supplements) != 1 || retried.Supplements[0].TaskID != f.taskID {
		t.Fatalf("receipts = %+v, want the chosen turn", retried.Supplements)
	}
	// The turn reads it and completes; a later retry reaches no one again.
	dbfx.Exec(t, `UPDATE task_supplement SET status = 'delivered', delivered_at = now() WHERE comment_id = $1`, retried.ID)
	completeTaskViaDaemon(t, f.taskID)
	send(testHandler).Want(http.StatusOK)
	if n := dbfx.Count(t, `SELECT count(*) FROM agent_task_queue WHERE issue_id = $1`, f.issueID); n != 1 {
		t.Fatalf("a retry after delivery started the message again: %d runs, want 1", n)
	}
}

// concurrentBegin holds the first two transactions until both have their
// connection, so two sends occupy a small pool at the same time.
type concurrentBegin struct {
	pool  *pgxpool.Pool
	count atomic.Int32
	ready chan struct{}
}

func (b *concurrentBegin) Begin(ctx context.Context) (pgx.Tx, error) {
	tx, err := b.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	if n := b.count.Add(1); n <= 2 {
		if n == 2 {
			close(b.ready)
		}
		select {
		case <-b.ready:
		case <-time.After(5 * time.Second):
			_ = tx.Rollback(context.Background())
			return nil, errors.New("second send did not start")
		}
	}
	return tx, nil
}

func TestCreateCommentConcurrentSendsProgressWithABoundedPool(t *testing.T) {
	f := newSupplementFixture(t, "codex", "running", true)
	cfg := testPool.Config().Copy()
	cfg.MaxConns = 2
	cfg.MinConns = 0
	pool, err := pgxpool.NewWithConfig(context.Background(), cfg)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	h := *testHandler
	h.Queries = db.New(pool)
	h.TxStarter = &concurrentBegin{pool: pool, ready: make(chan struct{})}
	var wg sync.WaitGroup
	replies := make([]*httptest.ResponseRecorder, 2)
	for i, id := range []string{"0199a4e8-22ce-7b01-bba5-777777777777", "0199a4e8-22ce-7b01-bba5-888888888888"} {
		req := withURLParam(newRequest(http.MethodPost, "/api/issues/"+f.issueID+"/comments",
			map[string]any{"content": "/note independent send", "client_request_id": id}), "id", f.issueID)
		replies[i] = httptest.NewRecorder()
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			ctx, cancel := context.WithTimeout(req.Context(), 2*time.Second)
			defer cancel()
			h.CreateComment(replies[i], req.WithContext(ctx))
		}(i)
	}
	wg.Wait()
	for i, resp := range replies {
		if resp.Code != http.StatusCreated {
			t.Errorf("send %d: HTTP %d %s, want 201", i, resp.Code, resp.Body.String())
		}
	}
}
