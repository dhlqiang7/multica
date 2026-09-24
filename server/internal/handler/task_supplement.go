package handler

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
	"github.com/multica-ai/multica/server/pkg/protocol"
)

func (h *Handler) hydrateTaskSupplementMetadata(ctx context.Context, r *http.Request, workspaceID pgtype.UUID, tasks []db.AgentTaskQueue, resp []AgentTaskResponse) {
	if len(tasks) == 0 || len(tasks) != len(resp) {
		return
	}
	taskIDs := make([]pgtype.UUID, 0, len(tasks))
	for i := range tasks {
		if tasks[i].IssueID.Valid {
			taskIDs = append(taskIDs, tasks[i].ID)
		}
	}
	if len(taskIDs) == 0 {
		return
	}
	rows, err := h.Queries.ListTaskSupplementMetadata(ctx, db.ListTaskSupplementMetadataParams{
		WorkspaceID: workspaceID,
		TaskIds:     taskIDs,
	})
	if err != nil {
		return // metadata is optional and must fail closed
	}
	byTask := make(map[string]db.ListTaskSupplementMetadataRow, len(rows))
	for _, row := range rows {
		byTask[uuidToString(row.TaskID)] = row
	}

	userID := requestUserID(r)
	permission := make(map[string]bool)
	for i, task := range tasks {
		row, ok := byTask[uuidToString(task.ID)]
		if !ok {
			continue
		}
		resp[i].SupplementCapability = row.Capability
		resp[i].SupplementCommentIDs = uuidsToStrings(row.CommentIds)
		if task.Status != "running" || row.Capability != protocol.DaemonCapabilityTaskSupplementV1 || userID == "" {
			continue
		}
		agentID := uuidToString(task.AgentID)
		allowed, checked := permission[agentID]
		if !checked {
			agent, loadErr := h.Queries.GetAgentInWorkspace(ctx, db.GetAgentInWorkspaceParams{
				ID: task.AgentID, WorkspaceID: workspaceID,
			})
			allowed = loadErr == nil && h.canInvokeAgent(ctx, agent, "member", userID, userID, uuidToString(workspaceID))
			permission[agentID] = allowed
		}
		resp[i].CanSupplement = allowed
	}
}

type taskSupplementReceiptResponse struct {
	TaskID        string  `json:"supplement_task_id"`
	Status        string  `json:"supplement_status"`
	FailureReason *string `json:"supplement_failure_reason,omitempty"`
	DeliveredAt   *string `json:"supplement_delivered_at,omitempty"`
}

func supplementReceipt(s db.TaskSupplement) taskSupplementReceiptResponse {
	return taskSupplementReceiptResponse{
		TaskID:        uuidToString(s.TaskID),
		Status:        s.Status,
		FailureReason: textToPtr(s.FailureReason),
		DeliveredAt:   timestampToPtr(s.DeliveredAt),
	}
}

// CommentSupplementResponse is one delivery receipt of a comment that steered
// a running turn. A comment can steer several agents' turns at once.
type CommentSupplementResponse struct {
	TaskID        string  `json:"task_id"`
	AgentID       string  `json:"agent_id,omitempty"`
	Status        string  `json:"status"`
	FailureReason *string `json:"failure_reason,omitempty"`
	DeliveredAt   *string `json:"delivered_at,omitempty"`
}

// listCommentSupplements groups every receipt by comment id, oldest first.
// Receipts are optional metadata: a failed read leaves comments without them.
func (h *Handler) listCommentSupplements(ctx context.Context, workspaceID pgtype.UUID, commentIDs []pgtype.UUID) map[string][]CommentSupplementResponse {
	out := make(map[string][]CommentSupplementResponse)
	if len(commentIDs) == 0 {
		return out
	}
	rows, err := h.Queries.ListTaskSupplementsByCommentIDs(ctx, db.ListTaskSupplementsByCommentIDsParams{
		WorkspaceID: workspaceID, CommentIds: commentIDs,
	})
	if err != nil {
		return out
	}
	for _, row := range rows {
		id := uuidToString(row.CommentID)
		out[id] = append(out[id], CommentSupplementResponse{
			TaskID:        uuidToString(row.TaskID),
			AgentID:       uuidToString(row.AgentID),
			Status:        row.Status,
			FailureReason: textToPtr(row.FailureReason),
			DeliveredAt:   timestampToPtr(row.DeliveredAt),
		})
	}
	return out
}

// applyCommentSupplements sets the receipt list and mirrors its first entry
// into the single-receipt fields older clients read.
func applyCommentSupplements(resp *CommentResponse, receipts []CommentSupplementResponse) {
	if len(receipts) == 0 {
		return
	}
	resp.Supplements = receipts
	resp.SupplementTaskID = receipts[0].TaskID
	resp.SupplementStatus = receipts[0].Status
	resp.SupplementFailureReason = receipts[0].FailureReason
	resp.SupplementDeliveredAt = receipts[0].DeliveredAt
}

// commentSteer is what a member asked to steer: the exact running turns they
// saw, and the logical send that makes a retry idempotent.
type commentSteer struct {
	TaskIDs         []pgtype.UUID
	ClientRequestID pgtype.UUID
}

// commentForRequest finds the comment an author already saved for this
// logical send, so a retry after a lost response never posts it twice —
// whether that send steered a running turn or fell back to a normal trigger.
func (h *Handler) commentForRequest(ctx context.Context, issue db.Issue, authorID, requestID pgtype.UUID) (db.Comment, bool) {
	if !requestID.Valid {
		return db.Comment{}, false
	}
	comment, err := h.Queries.GetCommentByClientRequest(ctx, db.GetCommentByClientRequestParams{
		IssueID: issue.ID, AuthorID: authorID, ClientRequestID: requestID,
	})
	if err != nil {
		return db.Comment{}, false
	}
	return comment, true
}

// lockCommentRequest holds one logical send until release runs. The lock lives
// in a transaction of its own: it outlasts a dropped client connection, and it
// ends with the process, so a retry after a crash can finish the send.
func (h *Handler) lockCommentRequest(ctx context.Context, issue db.Issue, authorID, requestID pgtype.UUID) (func(), error) {
	ctx = context.WithoutCancel(ctx)
	tx, err := h.TxStarter.Begin(ctx)
	if err != nil {
		return nil, err
	}
	// A twin waits for the attempt in progress, but not without bound.
	_, err = tx.Exec(ctx, "SET LOCAL lock_timeout = '30s'")
	if err == nil {
		_, err = tx.Exec(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
			"comment_request:"+uuidToString(issue.ID)+":"+uuidToString(authorID)+":"+uuidToString(requestID))
	}
	if err != nil {
		_ = tx.Rollback(ctx)
		return nil, err
	}
	return func() { _ = tx.Rollback(ctx) }, nil
}

func isLockTimeout(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "55P03"
}

// writeReplayedComment answers a retried send with the comment it already
// saved, as it stands now, including every receipt it holds.
func (h *Handler) writeReplayedComment(ctx context.Context, w http.ResponseWriter, issue db.Issue, comment db.Comment) {
	if comment.DeletedAt.Valid {
		writeError(w, http.StatusConflict, "this message was already sent and then deleted")
		return
	}
	resp := commentToResponse(comment, nil, nil)
	applyCommentSupplements(&resp, h.listCommentSupplements(ctx, issue.WorkspaceID, []pgtype.UUID{comment.ID})[uuidToString(comment.ID)])
	writeJSON(w, http.StatusOK, resp)
}

// isCommentRequestConflict reports that a concurrent twin of this send saved
// its comment first.
func isCommentRequestConflict(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23505" && pgErr.ConstraintName == "comment_client_request_uidx"
}

// steerCommentAgentTriggers binds a member comment to the turn its author
// chose for each recipient. A bound agent leaves the enqueue list: that turn
// receives the comment instead of a follow-up run. A chosen turn that has
// ended, has not started, or cannot take additional input is never swapped
// for another turn of the same agent; that recipient keeps its normal
// queued / coalesced / deferred handling, so losing a race never drops or
// misdirects the comment.
func (h *Handler) steerCommentAgentTriggers(ctx context.Context, issue db.Issue, comment db.Comment, actorType string, triggers []commentAgentTrigger, steer commentSteer) ([]commentAgentTrigger, map[string]commentEnqueueResult) {
	if len(steer.TaskIDs) == 0 || len(triggers) == 0 || actorType != "member" {
		return triggers, nil
	}
	// Each chosen turn names its agent; only a turn of this issue counts.
	chosen := make(map[string]pgtype.UUID, len(steer.TaskIDs))
	for _, taskID := range steer.TaskIDs {
		task, err := h.Queries.GetAgentTask(ctx, taskID)
		if err != nil || task.IssueID != issue.ID {
			continue
		}
		chosen[uuidToString(task.AgentID)] = task.ID
	}
	requestID := steer.ClientRequestID
	if !requestID.Valid {
		requestID = comment.ID
	}
	kept := make([]commentAgentTrigger, 0, len(triggers))
	steered := make(map[string]commentEnqueueResult)
	for _, trigger := range triggers {
		agentID := uuidToString(trigger.Agent.ID)
		taskID, ok := chosen[agentID]
		// One comment steers at most one turn until every server claims
		// receipts per (comment, run): a server from before that claims all of
		// a comment's receipts at once, which would mark a second turn's copy
		// in flight without delivering it. Later recipients keep their normal
		// trigger meanwhile.
		if !ok || len(steered) > 0 {
			kept = append(kept, trigger)
			continue
		}
		bound, err := h.Queries.BindCommentTaskSupplement(ctx, db.BindCommentTaskSupplementParams{
			TaskID: taskID, IssueID: issue.ID, AgentID: trigger.Agent.ID, WorkspaceID: issue.WorkspaceID,
			CommentID: comment.ID, AuthorID: comment.AuthorID, ClientRequestID: requestID,
		})
		if isUniqueViolation(err) {
			// A concurrent twin of this send already put the same input into
			// this turn: neither deliver it twice nor start a follow-up for it.
			steered[agentID] = commentEnqueueResult{status: DispatchSteered, reason: ReasonSteered}
			continue
		}
		if err != nil {
			if !errors.Is(err, pgx.ErrNoRows) {
				slog.Warn("steer comment into running turn failed",
					"issue_id", uuidToString(issue.ID), "comment_id", uuidToString(comment.ID), "task_id", uuidToString(taskID), "error", err)
			}
			kept = append(kept, trigger)
			continue
		}
		steered[agentID] = commentEnqueueResult{status: DispatchSteered, reason: ReasonSteered}
		if h.DaemonTaskSupplement != nil && bound.RuntimeID.Valid {
			h.DaemonTaskSupplement.NotifyTaskSupplementAvailable(uuidToString(bound.RuntimeID), uuidToString(bound.TaskID))
		}
	}
	if len(steered) > 0 {
		h.publishCommentSupplementUpdate(ctx, issue.WorkspaceID, comment.ID)
	}
	return kept, steered
}

func (h *Handler) loadTaskSupplementTarget(w http.ResponseWriter, r *http.Request) (db.Issue, db.AgentTaskQueue, pgtype.UUID, bool) {
	issue, ok := h.loadIssueForUser(w, r, chi.URLParam(r, "id"))
	if !ok {
		return db.Issue{}, db.AgentTaskQueue{}, pgtype.UUID{}, false
	}
	userID, ok := requireUserID(w, r)
	if !ok {
		return db.Issue{}, db.AgentTaskQueue{}, pgtype.UUID{}, false
	}
	authorID, ok := parseUUIDOrBadRequest(w, userID, "user id")
	if !ok {
		return db.Issue{}, db.AgentTaskQueue{}, pgtype.UUID{}, false
	}
	taskID, ok := parseUUIDOrBadRequest(w, chi.URLParam(r, "taskId"), "task id")
	if !ok {
		return db.Issue{}, db.AgentTaskQueue{}, pgtype.UUID{}, false
	}
	task, err := h.Queries.GetAgentTask(r.Context(), taskID)
	if err != nil || uuidToString(task.IssueID) != uuidToString(issue.ID) {
		writeError(w, http.StatusNotFound, "task not found")
		return db.Issue{}, db.AgentTaskQueue{}, pgtype.UUID{}, false
	}
	agent, err := h.Queries.GetAgentInWorkspace(r.Context(), db.GetAgentInWorkspaceParams{
		ID: task.AgentID, WorkspaceID: issue.WorkspaceID,
	})
	if err != nil || !h.canInvokeAgent(r.Context(), agent, "member", userID, userID, uuidToString(issue.WorkspaceID)) {
		writeErrorCode(w, http.StatusForbidden, "invocation_not_allowed", "you cannot run this agent")
		return db.Issue{}, db.AgentTaskQueue{}, pgtype.UUID{}, false
	}
	return issue, task, authorID, true
}

type createTaskSupplementRequest struct {
	Content         string `json:"content"`
	ClientRequestID string `json:"client_request_id"`
}

// CreateTaskSupplement adds one ordinary historical comment to one exact run.
// The SQL statement owns the terminal race: when completion wins, no comment,
// binding, or coverage marker is created.
func (h *Handler) CreateTaskSupplement(w http.ResponseWriter, r *http.Request) {
	issue, task, authorID, ok := h.loadTaskSupplementTarget(w, r)
	if !ok {
		return
	}
	var req createTaskSupplementRequest
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 8*maxCommentContentBytes)).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	req.Content = sanitizeNullBytes(req.Content)
	if len(req.Content) > maxCommentContentBytes {
		writeError(w, http.StatusBadRequest, "content is too long")
		return
	}
	if strings.TrimSpace(req.Content) == "" {
		writeError(w, http.StatusBadRequest, "content is required")
		return
	}
	requestID, ok := parseUUIDOrBadRequest(w, req.ClientRequestID, "client_request_id")
	if !ok {
		return
	}
	lookup := db.GetTaskSupplementByRequestParams{
		TaskID: task.ID, WorkspaceID: issue.WorkspaceID, AuthorID: authorID, ClientRequestID: requestID,
	}
	if existing, err := h.Queries.GetTaskSupplementByRequest(r.Context(), lookup); err == nil {
		h.notifyTaskSupplementAvailable(task)
		h.writeExistingTaskSupplement(w, r, existing)
		return
	} else if !errors.Is(err, pgx.ErrNoRows) {
		writeError(w, http.StatusInternalServerError, "failed to check additional message")
		return
	}
	if task.Status != "running" {
		writeErrorCode(w, http.StatusConflict, "task_supplement_turn_ended", "this run has ended")
		return
	}
	capability, err := h.Queries.GetTaskSupplementCapability(r.Context(), task.ID)
	if errors.Is(err, pgx.ErrNoRows) || capability.Capability != protocol.DaemonCapabilityTaskSupplementV1 {
		writeErrorCode(w, http.StatusPreconditionFailed, "task_supplement_unsupported", "this run does not support additional messages")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to check additional-message support")
		return
	}

	created, err := h.Queries.CreateTaskSupplement(r.Context(), db.CreateTaskSupplementParams{
		TaskID: task.ID, IssueID: issue.ID, WorkspaceID: issue.WorkspaceID,
		AuthorID: authorID, Content: req.Content, ClientRequestID: requestID,
	})
	if isUniqueViolation(err) {
		if existing, loadErr := h.Queries.GetTaskSupplementByRequest(r.Context(), lookup); loadErr == nil {
			h.notifyTaskSupplementAvailable(task)
			h.writeExistingTaskSupplement(w, r, existing)
			return
		} else if !errors.Is(loadErr, pgx.ErrNoRows) {
			writeError(w, http.StatusInternalServerError, "failed to check additional message")
			return
		}
		writeError(w, http.StatusConflict, "client_request_id is already in use")
		return
	}
	if errors.Is(err, pgx.ErrNoRows) {
		writeErrorCode(w, http.StatusConflict, "task_supplement_turn_ended", "this run has ended")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to create additional message")
		return
	}
	comment := db.Comment{
		ID: created.ID, IssueID: created.IssueID, AuthorType: created.AuthorType,
		AuthorID: created.AuthorID, Content: created.Content, Type: created.Type,
		CreatedAt: created.CreatedAt, UpdatedAt: created.UpdatedAt, ParentID: created.ParentID,
		WorkspaceID: created.WorkspaceID, ResolvedAt: created.ResolvedAt,
		ResolvedByType: created.ResolvedByType, ResolvedByID: created.ResolvedByID,
		SourceTaskID: created.SourceTaskID, QuickActionID: created.QuickActionID,
		ViaPluginID: created.ViaPluginID, Revision: created.Revision,
		RecoverySettledAt: created.RecoverySettledAt, DeletedAt: created.DeletedAt,
	}
	resp := commentToResponse(comment, nil, nil)
	resp.IssueRevision = created.IssueRevision
	applyCommentSupplements(&resp, []CommentSupplementResponse{{
		TaskID:        uuidToString(created.SupplementTaskID),
		AgentID:       uuidToString(task.AgentID),
		Status:        created.SupplementStatus,
		FailureReason: textToPtr(created.SupplementFailureReason),
		DeliveredAt:   timestampToPtr(created.SupplementDeliveredAt),
	}})
	h.publish(protocol.EventCommentCreated, uuidToString(issue.WorkspaceID), "member", uuidToString(authorID), map[string]any{
		"comment": resp, "issue_title": issue.Title, "issue_revision": created.IssueRevision,
	})
	h.notifyTaskSupplementAvailable(task)
	writeJSON(w, http.StatusCreated, resp)
}

func (h *Handler) notifyTaskSupplementAvailable(task db.AgentTaskQueue) {
	if h.DaemonTaskSupplement == nil || task.Status != "running" || !task.RuntimeID.Valid {
		return
	}
	h.DaemonTaskSupplement.NotifyTaskSupplementAvailable(uuidToString(task.RuntimeID), uuidToString(task.ID))
}

func (h *Handler) writeExistingTaskSupplement(w http.ResponseWriter, r *http.Request, existing db.TaskSupplement) {
	comment, err := h.Queries.GetCommentInWorkspace(r.Context(), db.GetCommentInWorkspaceParams{
		ID: existing.CommentID, WorkspaceID: existing.WorkspaceID,
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to load additional message")
		return
	}
	resp := commentToResponse(comment, nil, nil)
	applyCommentSupplements(&resp, h.listCommentSupplements(r.Context(), existing.WorkspaceID, []pgtype.UUID{existing.CommentID})[uuidToString(existing.CommentID)])
	writeJSON(w, http.StatusOK, resp)
}

func (h *Handler) RetryTaskSupplement(w http.ResponseWriter, r *http.Request) {
	issue, task, _, ok := h.loadTaskSupplementTarget(w, r)
	if !ok {
		return
	}
	commentID, ok := parseUUIDOrBadRequest(w, chi.URLParam(r, "commentId"), "comment id")
	if !ok {
		return
	}
	row, err := h.Queries.RetryTaskSupplement(r.Context(), db.RetryTaskSupplementParams{
		CommentID: commentID, WorkspaceID: issue.WorkspaceID, TaskID: task.ID, IssueID: issue.ID,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		existing, loadErr := h.Queries.GetTaskSupplementForRun(r.Context(), db.GetTaskSupplementForRunParams{
			CommentID: commentID, TaskID: task.ID, WorkspaceID: issue.WorkspaceID,
		})
		if loadErr == nil && existing.Status == "pending" {
			row = existing // duplicate retry is an idempotent success
			err = nil
		}
	}
	if errors.Is(err, pgx.ErrNoRows) {
		writeErrorCode(w, http.StatusConflict, "task_supplement_not_retryable", "this message cannot be retried")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to retry additional message")
		return
	}
	h.publishTaskSupplementUpdate(r, row)
	h.notifyTaskSupplementAvailable(task)
	writeJSON(w, http.StatusOK, supplementReceipt(row))
}

type ackTaskSupplementRequest struct {
	Delivered bool   `json:"delivered"`
	Error     string `json:"error,omitempty"`
}

func (h *Handler) ClaimTaskSupplement(w http.ResponseWriter, r *http.Request) {
	taskID := chi.URLParam(r, "taskId")
	if _, ok := h.requireDaemonTaskAccess(w, r, taskID); !ok {
		return
	}
	row, err := h.Queries.ClaimNextTaskSupplement(r.Context(), parseUUID(taskID))
	if errors.Is(err, pgx.ErrNoRows) {
		writeJSON(w, http.StatusOK, map[string]any{})
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to claim additional message")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"comment_id": uuidToString(row.CommentID), "author_name": row.AuthorName, "content": row.Content,
	})
}

func (h *Handler) AckTaskSupplement(w http.ResponseWriter, r *http.Request) {
	taskID := chi.URLParam(r, "taskId")
	if _, ok := h.requireDaemonTaskAccess(w, r, taskID); !ok {
		return
	}
	commentID, ok := parseUUIDOrBadRequest(w, chi.URLParam(r, "commentId"), "comment id")
	if !ok {
		return
	}
	var req ackTaskSupplementRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	var row db.TaskSupplement
	var err error
	if req.Delivered {
		row, err = h.Queries.AckTaskSupplementDelivered(r.Context(), db.AckTaskSupplementDeliveredParams{
			TaskID: parseUUID(taskID), CommentID: commentID,
		})
	} else {
		reason := stableTaskSupplementFailureReason(req.Error)
		row, err = h.Queries.AckTaskSupplementFailed(r.Context(), db.AckTaskSupplementFailedParams{
			TaskID: parseUUID(taskID), CommentID: commentID,
			FailureReason: pgtype.Text{String: reason, Valid: true},
		})
	}
	if errors.Is(err, pgx.ErrNoRows) {
		writeError(w, http.StatusConflict, "additional message is no longer deliverable")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to acknowledge additional message")
		return
	}
	h.publishTaskSupplementUpdate(r, row)
	writeJSON(w, http.StatusOK, supplementReceipt(row))
}

func stableTaskSupplementFailureReason(reason string) string {
	reason = strings.TrimSpace(sanitizeNullBytes(reason))
	switch reason {
	case protocol.TaskSupplementFailureTurnNotStarted, protocol.TaskSupplementFailureTimeout,
		protocol.TaskSupplementFailureTurnEnded, protocol.TaskSupplementFailureProviderRejected:
		return reason
	default:
		// Provider and Go errors are private daemon diagnostics. Never persist or
		// rebroadcast them to workspace members, and never byte-truncate UTF-8.
		return protocol.TaskSupplementFailureProviderRejected
	}
}

func (h *Handler) publishTaskSupplementUpdate(r *http.Request, row db.TaskSupplement) {
	h.publishCommentSupplementUpdate(r.Context(), row.WorkspaceID, row.CommentID)
}

// publishCommentSupplementUpdate rebroadcasts a comment with every receipt it
// carries, so a change to one run's delivery never hides another run's.
func (h *Handler) publishCommentSupplementUpdate(ctx context.Context, workspaceID, commentID pgtype.UUID) {
	comment, err := h.Queries.GetCommentInWorkspace(ctx, db.GetCommentInWorkspaceParams{
		ID: commentID, WorkspaceID: workspaceID,
	})
	if err != nil {
		return
	}
	resp := commentToResponse(comment, nil, nil)
	applyCommentSupplements(&resp, h.listCommentSupplements(ctx, workspaceID, []pgtype.UUID{commentID})[uuidToString(commentID)])
	h.publish(protocol.EventCommentUpdated, uuidToString(workspaceID), "system", "", map[string]any{"comment": resp})
}
