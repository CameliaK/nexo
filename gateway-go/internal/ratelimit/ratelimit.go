// Package ratelimit is a fixed-window limiter on Redis: at most max hits per
// key per window. Shared by chat, sign-in and (later) chess.
package ratelimit

import (
	"context"
	"fmt"
	"net/http"
	"time"

	"github.com/redis/go-redis/v9"

	"nexo/gateway/internal/httpx"
)

type Limiter struct {
	rdb *redis.Client
}

func New(rdb *redis.Client) *Limiter {
	return &Limiter{rdb: rdb}
}

// Result of one hit. RetryAfter (seconds, ≥ 1) is the key's remaining TTL,
// i.e. when the window resets; it is only set when Allowed is false.
type Result struct {
	Allowed    bool
	RetryAfter int
}

// Hit counts one attempt for key. INCR, EXPIRE NX (window starts on the first
// hit) and TTL run in one MULTI, so a key can never be left without expiry.
// Attempts over the limit still count: hammering does not shorten the wait.
func (l *Limiter) Hit(ctx context.Context, key string, max int, window time.Duration) (Result, error) {
	var incr *redis.IntCmd
	var ttl *redis.DurationCmd
	_, err := l.rdb.TxPipelined(ctx, func(p redis.Pipeliner) error {
		incr = p.Incr(ctx, key)
		p.ExpireNX(ctx, key, window)
		ttl = p.TTL(ctx, key)
		return nil
	})
	if err != nil {
		return Result{}, fmt.Errorf("ratelimit %s: %w", key, err)
	}
	if incr.Val() <= int64(max) {
		return Result{Allowed: true}, nil
	}
	secs := int(ttl.Val().Seconds())
	if secs < 1 {
		secs = 1
	}
	return Result{RetryAfter: secs}, nil
}

// Reject writes the contract's 429: Retry-After header + rate_limited body.
func Reject(w http.ResponseWriter, res Result, message string) {
	w.Header().Set("Retry-After", fmt.Sprint(res.RetryAfter))
	httpx.WriteErr(w, http.StatusTooManyRequests, "rate_limited", message)
}
