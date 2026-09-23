package handler

import (
	"net/http"
	"strconv"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
)

// ---------------------------------------------------------------------------
// Analytics: delivery and cost breakdown
//
//   GET /api/dashboard/delivery          one row per issue agents picked up
//   GET /api/dashboard/usage/breakdown   per-(agent, runtime, project, model)
//
// Both take the same ?days=N / ?project_id / ?tz parameters as the rollups in
// dashboard.go. Delivery returns the current AND the previous period in one
// payload (with the two boundaries on the wire) so the page can put a period-
// over-period delta on every figure without a second request, and so the
// client never re-derives the viewer-tz day boundary on its own.
// ---------------------------------------------------------------------------

// Issue sources, derived from who created the issue.
const (
	deliverySourceMember    = "member"
	deliverySourceAgent     = "agent"
	deliverySourceAutopilot = "autopilot"
)

// DashboardDeliveryResponse carries the issues of both periods. An issue
// belongs to the current period when AssignedAt >= WindowStart and to the
// previous one otherwise.
type DashboardDeliveryResponse struct {
	WindowStart         string                           `json:"window_start"`
	PreviousWindowStart string                           `json:"previous_window_start"`
	Issues              []DashboardDeliveryIssueResponse `json:"issues"`
}

// DashboardDeliveryIssueResponse is one issue's delivery facts. See
// ListDashboardDeliveryIssues for how each timestamp is derived.
type DashboardDeliveryIssueResponse struct {
	IssueID     string  `json:"issue_id"`
	Identifier  string  `json:"identifier"`
	Title       string  `json:"title"`
	Status      string  `json:"status"`
	StatusKind  string  `json:"status_kind"`
	ProjectID   *string `json:"project_id"`
	Source      string  `json:"source"`
	AgentID     string  `json:"agent_id"`
	AssignedAt  string  `json:"assigned_at"`
	DeliveredAt *string `json:"delivered_at"`
	// AcceptedAt is set only while the issue's status kind is done: an issue
	// that was done and then reopened is no longer accepted.
	AcceptedAt     *string `json:"accepted_at"`
	BounceCount    int32   `json:"bounce_count"`
	LastBounceAt   *string `json:"last_bounce_at"`
	RunCount       int32   `json:"run_count"`
	FailedRunCount int32   `json:"failed_run_count"`
	// RunSeconds is agent run time up to the first delivery.
	RunSeconds int64 `json:"run_seconds"`
}

// deliveryWindow returns the start of the current N-day period and of the
// period before it, both at start-of-day in the viewer's zone. The current
// boundary is exactly the one parseExactSinceParamInTZ yields for the same
// request, so this lines up with the per-agent rollups.
func deliveryWindow(r *http.Request, tz string) (current, previous time.Time) {
	days := parseDaysParam(r, 30)
	loc := loadLocationOrUTC(tz)
	now := dayWindowNow()
	return sinceFromDays(now, days-1, loc), sinceFromDays(now, 2*days-1, loc)
}

func deliverySource(row db.ListDashboardDeliveryIssuesRow) string {
	switch {
	case row.OriginType == "autopilot":
		return deliverySourceAutopilot
	case row.CreatorType == "agent":
		return deliverySourceAgent
	default:
		return deliverySourceMember
	}
}

// GetDashboardDelivery returns the delivery facts of every issue agents picked
// up in the current or the previous period. Agents this viewer may not see are
// folded onto restrictedAgentsRowID, like the per-agent rollups.
func (h *Handler) GetDashboardDelivery(w http.ResponseWriter, r *http.Request) {
	workspaceID := h.resolveWorkspaceID(r)
	member, ok := h.workspaceMember(w, r, workspaceID)
	if !ok {
		return
	}
	projectID, ok := parseProjectIDParam(w, r)
	if !ok {
		return
	}
	restricted, ok := h.dashboardRestrictedAgents(w, r, workspaceID, member.Role)
	if !ok {
		return
	}
	current, previous := deliveryWindow(r, h.resolveViewingTZ(r))
	wsUUID := parseUUID(workspaceID)

	rows, err := h.Queries.ListDashboardDeliveryIssues(r.Context(), db.ListDashboardDeliveryIssuesParams{
		WorkspaceID: wsUUID,
		Since:       pgtype.Timestamptz{Time: previous, Valid: true},
		ProjectID:   projectID,
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list delivery")
		return
	}

	prefix := h.getIssuePrefix(r.Context(), wsUUID)
	issues := make([]DashboardDeliveryIssueResponse, len(rows))
	for i, row := range rows {
		agentID := uuidToString(row.AgentID)
		if _, hidden := restricted[agentID]; hidden {
			agentID = restrictedAgentsRowID
		}
		var acceptedAt *string
		if row.StatusKind == "done" {
			acceptedAt = timestampToPtr(row.LastDoneAt)
		}
		issues[i] = DashboardDeliveryIssueResponse{
			IssueID:        uuidToString(row.IssueID),
			Identifier:     prefix + "-" + strconv.Itoa(int(row.Number)),
			Title:          row.Title,
			Status:         row.Status,
			StatusKind:     row.StatusKind,
			ProjectID:      uuidToPtr(row.ProjectID),
			Source:         deliverySource(row),
			AgentID:        agentID,
			AssignedAt:     timestampToString(row.FirstTaskAt),
			DeliveredAt:    timestampToPtr(row.DeliveredAt),
			AcceptedAt:     acceptedAt,
			BounceCount:    row.BounceCount,
			LastBounceAt:   timestampToPtr(row.LastBounceAt),
			RunCount:       row.RunCount,
			FailedRunCount: row.FailedRunCount,
			RunSeconds:     row.RunSeconds,
		}
	}

	writeJSON(w, http.StatusOK, DashboardDeliveryResponse{
		WindowStart:         current.Format(time.RFC3339),
		PreviousWindowStart: previous.Format(time.RFC3339),
		Issues:              issues,
	})
}

// DashboardUsageBreakdownResponse is one (agent, runtime, project, provider,
// model) row. Cost is priced client-side exactly like the by-agent rows.
type DashboardUsageBreakdownResponse struct {
	AgentID                  string `json:"agent_id"`
	RuntimeID                string `json:"runtime_id"`
	ProjectID                string `json:"project_id"`
	Provider                 string `json:"provider"`
	Model                    string `json:"model"`
	InputTokens              int64  `json:"input_tokens"`
	OutputTokens             int64  `json:"output_tokens"`
	CacheReadTokens          int64  `json:"cache_read_tokens"`
	CacheWriteTokens         int64  `json:"cache_write_tokens"`
	CostUSDTicks             int64  `json:"cost_usd_ticks"`
	UncostedInputTokens      int64  `json:"uncosted_input_tokens"`
	UncostedOutputTokens     int64  `json:"uncosted_output_tokens"`
	UncostedCacheReadTokens  int64  `json:"uncosted_cache_read_tokens"`
	UncostedCacheWriteTokens int64  `json:"uncosted_cache_write_tokens"`
	TaskCount                int32  `json:"task_count"`
}

// GetDashboardUsageBreakdown returns token aggregates split by every dimension
// the hourly rollup keeps. No date dimension, so the window is the exact N-day
// one (see GetDashboardUsageByAgent).
func (h *Handler) GetDashboardUsageBreakdown(w http.ResponseWriter, r *http.Request) {
	workspaceID := h.resolveWorkspaceID(r)
	member, ok := h.workspaceMember(w, r, workspaceID)
	if !ok {
		return
	}
	projectID, ok := parseProjectIDParam(w, r)
	if !ok {
		return
	}
	restricted, ok := h.dashboardRestrictedAgents(w, r, workspaceID, member.Role)
	if !ok {
		return
	}
	since := parseExactSinceParamInTZ(r, 30, h.resolveViewingTZ(r))

	rows, err := h.Queries.ListDashboardUsageBreakdown(r.Context(), db.ListDashboardUsageBreakdownParams{
		WorkspaceID: parseUUID(workspaceID),
		Since:       since,
		ProjectID:   projectID,
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list usage breakdown")
		return
	}
	resp := make([]DashboardUsageBreakdownResponse, len(rows))
	for i, row := range rows {
		resp[i] = DashboardUsageBreakdownResponse{
			AgentID:                  uuidToString(row.AgentID),
			RuntimeID:                uuidToString(row.RuntimeID),
			ProjectID:                uuidToString(row.ProjectID),
			Provider:                 row.Provider,
			Model:                    row.Model,
			InputTokens:              row.InputTokens,
			OutputTokens:             row.OutputTokens,
			CacheReadTokens:          row.CacheReadTokens,
			CacheWriteTokens:         row.CacheWriteTokens,
			CostUSDTicks:             row.CostUsdTicks,
			UncostedInputTokens:      row.UncostedInputTokens,
			UncostedOutputTokens:     row.UncostedOutputTokens,
			UncostedCacheReadTokens:  row.UncostedCacheReadTokens,
			UncostedCacheWriteTokens: row.UncostedCacheWriteTokens,
			TaskCount:                row.TaskCount,
		}
	}
	writeJSON(w, http.StatusOK, foldRestrictedUsageBreakdown(resp, restricted))
}

type usageBreakdownKey struct{ runtimeID, projectID, provider, model string }

// The restricted bucket keeps every non-agent dimension so the runtime,
// project and model groupings still add up to the workspace total.
func foldRestrictedUsageBreakdown(
	rows []DashboardUsageBreakdownResponse,
	restricted map[string]struct{},
) []DashboardUsageBreakdownResponse {
	return foldRestrictedAgents(
		rows,
		restricted,
		func(row DashboardUsageBreakdownResponse) string { return row.AgentID },
		func(row DashboardUsageBreakdownResponse) (DashboardUsageBreakdownResponse, usageBreakdownKey) {
			row.AgentID = restrictedAgentsRowID
			return row, usageBreakdownKey{row.RuntimeID, row.ProjectID, row.Provider, row.Model}
		},
		func(dst, src DashboardUsageBreakdownResponse) DashboardUsageBreakdownResponse {
			dst.InputTokens += src.InputTokens
			dst.OutputTokens += src.OutputTokens
			dst.CacheReadTokens += src.CacheReadTokens
			dst.CacheWriteTokens += src.CacheWriteTokens
			dst.CostUSDTicks += src.CostUSDTicks
			dst.UncostedInputTokens += src.UncostedInputTokens
			dst.UncostedOutputTokens += src.UncostedOutputTokens
			dst.UncostedCacheReadTokens += src.UncostedCacheReadTokens
			dst.UncostedCacheWriteTokens += src.UncostedCacheWriteTokens
			dst.TaskCount += src.TaskCount
			return dst
		},
	)
}
