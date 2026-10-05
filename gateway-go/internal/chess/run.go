package chess

import (
	"context"
	"encoding/json"
	"log"
	"time"

	"github.com/redis/go-redis/v9"

	"nexo/gateway/internal/mask"
)

// run is one chess action as the system window sees it: run.start kind
// "chess", the trace.hop of each step and run.done / run.error, all on the
// actor's channel. Gateway and agent both publish into it, so seq comes from
// the shared Redis counter run:{run_id}:seq (same as the agent's
// EventPublisher), never from a local variable.
type run struct {
	rdb       *redis.Client
	visitorID string
	id        string
	started   time.Time
}

func startRun(ctx context.Context, rdb *redis.Client, visitorID, runID string) *run {
	r := &run{rdb: rdb, visitorID: visitorID, id: runID, started: time.Now()}
	if err := rdb.Set(ctx, "run:"+runID+":seq", 0, time.Hour).Err(); err != nil {
		log.Printf("chess: run counter visitor=%s: %v", mask.ID(visitorID), err)
	}
	r.publish(ctx, "run.start", map[string]any{"kind": "chess", "content_version": 2})
	return r
}

func (r *run) publish(ctx context.Context, eventType string, data map[string]any) {
	seq, err := r.rdb.Incr(ctx, "run:"+r.id+":seq").Result()
	if err != nil {
		log.Printf("chess: run seq visitor=%s: %v", mask.ID(r.visitorID), err)
		return
	}
	b, _ := json.Marshal(map[string]any{
		"v":      2,
		"type":   eventType,
		"run_id": r.id,
		"seq":    seq,
		"ts":     time.Now().UTC().Format("2006-01-02T15:04:05.000Z"),
		"data":   data,
	})
	if err := r.rdb.Publish(ctx, "events:"+r.visitorID, b).Err(); err != nil {
		log.Printf("chess: publish %s visitor=%s: %v", eventType, mask.ID(r.visitorID), err)
	}
}

func (r *run) hopStart(ctx context.Context, hopID, from, to, label string) {
	r.publish(ctx, "trace.hop", map[string]any{"hop_id": hopID, "from": from, "to": to, "phase": "start", "label": label})
}

func (r *run) hopEnd(ctx context.Context, hopID, from, to string, since time.Time) {
	r.publish(ctx, "trace.hop", map[string]any{"hop_id": hopID, "from": from, "to": to, "phase": "end",
		"duration_ms": time.Since(since).Milliseconds()})
}

func (r *run) hopError(ctx context.Context, hopID, from, to, detail string) {
	r.publish(ctx, "trace.hop", map[string]any{"hop_id": hopID, "from": from, "to": to, "phase": "error", "detail": detail})
}

func (r *run) done(ctx context.Context, outcome string) {
	r.publish(ctx, "run.done", map[string]any{"outcome": outcome, "duration_ms": time.Since(r.started).Milliseconds()})
}

func (r *run) fail(ctx context.Context, code, message string) {
	r.publish(ctx, "run.error", map[string]any{"code": code, "message": message, "retryable": code == "rate_limited" || code == "internal"})
}
