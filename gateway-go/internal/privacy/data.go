// Package privacy serves the visitor's right to erase their data.
package privacy

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"net/url"
	"time"

	"github.com/redis/go-redis/v9"

	"nexo/gateway/internal/auth"
	"nexo/gateway/internal/clientip"
	"nexo/gateway/internal/httpx"
	"nexo/gateway/internal/mask"
	"nexo/gateway/internal/ratelimit"
)

var agentClient = &http.Client{Timeout: 10 * time.Second}

// DataHandler serves DELETE /api/v1/session/data: it erases what the backend
// keeps for the caller's visitor_id — generated nodes and live-chat messages
// (in the agent) and the Redis session. Behind auth.RequireAuth, so guests
// and accounts can both use it; the visitor comes only from the validated
// token. Rate-limit counters are kept on purpose: erasing them would let a
// caller reset its own limits.
type DataHandler struct {
	Redis     *redis.Client
	Limiter   *ratelimit.Limiter
	IPs       *clientip.Resolver
	AgentURL  string
	PerHour   int // per visitor
	PerIPHour int
}

func (h *DataHandler) Delete(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	visitorID := auth.ClaimsFrom(ctx).VisitorID

	for _, lim := range []struct {
		key string
		max int
	}{
		{"rl:session-data:visitor:" + visitorID, h.PerHour},
		{"rl:session-data:ip:" + h.IPs.Key(r), h.PerIPHour},
	} {
		res, err := h.Limiter.Hit(ctx, lim.key, lim.max, time.Hour)
		if err != nil {
			log.Printf("session/data: rate limit visitor=%s: %v", mask.ID(visitorID), err)
			httpx.WriteErr(w, http.StatusInternalServerError, "internal", "unexpected error")
			return
		}
		if !res.Allowed {
			ratelimit.Reject(w, res, "too many requests, try again later")
			return
		}
	}

	counts, err := h.deleteInAgent(ctx, visitorID)
	if err != nil {
		log.Printf("session/data: visitor=%s: %v", mask.ID(visitorID), mask.URLErr(err))
		httpx.WriteErr(w, http.StatusServiceUnavailable, "internal", "agent unavailable")
		return
	}
	if err := h.Redis.Del(ctx, "session:"+visitorID).Err(); err != nil {
		log.Printf("session/data: session visitor=%s: %v", mask.ID(visitorID), err)
		httpx.WriteErr(w, http.StatusInternalServerError, "internal", "unexpected error")
		return
	}
	log.Printf("session/data: visitor=%s erased (%d nodes, %d live messages)",
		mask.ID(visitorID), counts.Nodes, counts.Messages)
	w.WriteHeader(http.StatusNoContent)
}

type erased struct {
	Nodes    int `json:"nodes"`
	Messages int `json:"messages"`
}

func (h *DataHandler) deleteInAgent(ctx context.Context, visitorID string) (erased, error) {
	var out erased
	req, err := http.NewRequestWithContext(ctx, http.MethodDelete,
		h.AgentURL+"/internal/session/data?visitor_id="+url.QueryEscape(visitorID), nil)
	if err != nil {
		return out, err
	}
	resp, err := agentClient.Do(req)
	if err != nil {
		return out, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return out, fmt.Errorf("agent returned %d", resp.StatusCode)
	}
	return out, json.NewDecoder(resp.Body).Decode(&out)
}
