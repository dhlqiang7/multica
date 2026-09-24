package scheduler

import (
	"context"
	"time"
)

type ChildDoneSweeper interface{ SweepChildDone(context.Context) error }

// ChildDoneSweepJob retries child-done transitions that the status write
// recorded but the request did not finish processing (a crash, a deploy, a
// transient database error). The rows themselves are the durable queue.
func ChildDoneSweepJob(sweeper ChildDoneSweeper) JobSpec {
	return JobSpec{
		Name: "issue_child_done_sweep", Cadence: 30 * time.Second, CatchUpMode: CatchUpLatestOnly, CatchUpWindow: time.Hour,
		RunTimeout: 45 * time.Second, StaleTimeout: time.Minute, HeartbeatInterval: 10 * time.Second,
		AllowStaleReentry: true, MaxAttempts: 1, Scopes: StaticScopes(ScopeGlobal),
		Handler: func(ctx context.Context, _ HandlerInput) (HandlerResult, error) {
			return HandlerResult{}, sweeper.SweepChildDone(ctx)
		},
	}
}
