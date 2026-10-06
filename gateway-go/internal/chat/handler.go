package chat

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/redis/go-redis/v9"
	"nexo/gateway/internal/auth"
	"nexo/gateway/internal/clientip"
	"nexo/gateway/internal/mask"
	"nexo/gateway/internal/ratelimit"
)

var agentClient = &http.Client{Timeout: 10 * time.Second}

// Limits of contract §12: questions per visitor and per IP per hour, and one
// active query per visitor.
type Limits struct {
	Limiter   *ratelimit.Limiter
	IPs       *clientip.Resolver
	PerHour   int
	PerIPHour int
	ActiveTTL time.Duration // safety net if the agent never releases the mark
}

type handler struct {
	tokens   *auth.TokenService
	rdb      *redis.Client
	agentURL string
	limits   Limits
}

func NewHandler(tokens *auth.TokenService, rdb *redis.Client, agentURL string, limits Limits) http.HandlerFunc {
	h := &handler{tokens: tokens, rdb: rdb, agentURL: agentURL, limits: limits}
	return h.serveHTTP
}

// ActiveKey marks the visitor's query in flight; its value is the run_id.
// The agent deletes it (compare-and-delete) on run.done / run.error.
func ActiveKey(visitorID string) string { return "chat:active:" + visitorID }

// releaseScript deletes the mark only if it still belongs to runID, so a late
// release can never free a newer query's mark.
var releaseScript = redis.NewScript(`if redis.call("GET", KEYS[1]) == ARGV[1] then return redis.call("DEL", KEYS[1]) end return 0`)

func (h *handler) release(visitorID, runID string) {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	if err := releaseScript.Run(ctx, h.rdb, []string{ActiveKey(visitorID)}, runID).Err(); err != nil {
		log.Printf("chat: release active visitor=%s run=%s: %v", mask.ID(visitorID), runID, err)
	}
}

func (h *handler) serveHTTP(w http.ResponseWriter, r *http.Request) {
	// Auth: Authorization: Bearer <token>
	authHeader := r.Header.Get("Authorization")
	if !strings.HasPrefix(authHeader, "Bearer ") {
		writeErr(w, http.StatusUnauthorized, "unauthorized", "missing Authorization header")
		return
	}
	visitorID, err := h.tokens.Verify(authHeader[7:])
	if err != nil {
		writeErr(w, http.StatusUnauthorized, "unauthorized", "invalid token")
		return
	}

	// Parse body: {"message": "..."}
	var body struct {
		Message string `json:"message"`
		// Optional answer-language preference ("es" | "en"); anything else
		// is ignored and the agent uses the language of the question.
		Lang string `json:"lang"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid_request", "invalid JSON body")
		return
	}
	body.Message = strings.TrimSpace(body.Message)
	if body.Message == "" {
		writeErr(w, http.StatusBadRequest, "invalid_request", "message is required")
		return
	}
	if len([]rune(body.Message)) > 500 {
		writeErr(w, http.StatusBadRequest, "invalid_request", "message too long (max 500 characters)")
		return
	}

	runID := newUUID()
	ctx := r.Context()
	seq := 1
	t0 := time.Now()

	// One active query per visitor. Taken before the hourly counters, so a
	// rejected duplicate (409) does not spend quota.
	active, err := h.rdb.SetNX(ctx, ActiveKey(visitorID), runID, h.limits.ActiveTTL).Result()
	if err != nil {
		log.Printf("chat: active mark visitor=%s: %v", mask.ID(visitorID), err)
		writeErr(w, http.StatusInternalServerError, "internal", "unexpected error")
		return
	}
	if !active {
		writeErr(w, http.StatusConflict, "busy", "a question is already in progress")
		return
	}
	for _, lim := range []struct {
		key string
		max int
	}{
		{"rl:chat:visitor:" + visitorID, h.limits.PerHour},
		{"rl:chat:ip:" + h.limits.IPs.Key(r), h.limits.PerIPHour},
	} {
		res, err := h.limits.Limiter.Hit(ctx, lim.key, lim.max, time.Hour)
		if err != nil {
			h.release(visitorID, runID)
			log.Printf("chat: rate limit visitor=%s: %v", mask.ID(visitorID), err)
			writeErr(w, http.StatusInternalServerError, "internal", "unexpected error")
			return
		}
		if !res.Allowed {
			h.release(visitorID, runID)
			ratelimit.Reject(w, res, "too many questions, try again later")
			return
		}
	}

	// Publish run.start
	if err := h.pub(ctx, visitorID, "run.start", runID, &seq, map[string]any{
		"kind":            "chat",
		"input":           body.Message,
		"content_version": 3,
	}); err != nil {
		h.release(visitorID, runID)
		log.Printf("chat: publish run.start visitor=%s: %v", mask.ID(visitorID), err)
		writeErr(w, http.StatusInternalServerError, "internal", "failed to publish event")
		return
	}

	// trace.hop h1 start (traefik→gateway, reported by gateway on behalf of traefik)
	_ = h.pub(ctx, visitorID, "trace.hop", runID, &seq, map[string]any{
		"hop_id": "h1", "from": "traefik", "to": "gateway",
		"phase": "start", "label": "Recibe la petición",
	})
	h1Ms := time.Since(t0).Milliseconds()
	_ = h.pub(ctx, visitorID, "trace.hop", runID, &seq, map[string]any{
		"hop_id": "h1", "from": "traefik", "to": "gateway",
		"phase": "end", "duration_ms": h1Ms,
	})

	// Return 202 immediately
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusAccepted)
	_ = json.NewEncoder(w).Encode(map[string]string{"run_id": runID})

	// Fire and forget: call agent in goroutine
	lang := ""
	if body.Lang == "es" || body.Lang == "en" {
		lang = body.Lang
	}
	go h.callAgent(visitorID, runID, body.Message, lang, seq)
}

func (h *handler) callAgent(visitorID, runID, message, lang string, seqStart int) {
	ctx := context.Background()

	payload, _ := json.Marshal(map[string]any{
		"run_id":     runID,
		"visitor_id": visitorID,
		"input":      message,
		"lang":       lang,
		"seq_start":  seqStart,
	})

	resp, err := agentClient.Post(h.agentURL+"/internal/chat", "application/json", bytes.NewReader(payload))
	if err != nil {
		log.Printf("chat: agent call failed visitor=%s run=%s: %v", mask.ID(visitorID), runID, mask.URLErr(err))
		h.release(visitorID, runID)
		seq := seqStart
		_ = h.pub(ctx, visitorID, "trace.hop", runID, &seq, map[string]any{
			"hop_id": "h2", "from": "gateway", "to": "agent",
			"phase": "error", "detail": "El agente no está disponible",
		})
		_ = h.pub(ctx, visitorID, "run.error", runID, &seq, map[string]any{
			"code": "internal", "message": "El agente no está disponible. Intenta de nuevo.", "retryable": true,
		})
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusAccepted {
		log.Printf("chat: agent returned %d visitor=%s run=%s", resp.StatusCode, mask.ID(visitorID), runID)
		h.release(visitorID, runID)
		seq := seqStart
		_ = h.pub(ctx, visitorID, "trace.hop", runID, &seq, map[string]any{
			"hop_id": "h2", "from": "gateway", "to": "agent",
			"phase": "error", "detail": "Error al contactar al agente",
		})
		_ = h.pub(ctx, visitorID, "run.error", runID, &seq, map[string]any{
			"code": "internal", "message": "Error al contactar al agente.", "retryable": true,
		})
	}
}

// ── helpers ──────────────────────────────────────────────────────────────────

func (h *handler) pub(ctx context.Context, visitorID, eventType, runID string, seq *int, data map[string]any) error {
	envelope := map[string]any{
		"v":      2,
		"type":   eventType,
		"run_id": runID,
		"seq":    *seq,
		"ts":     time.Now().UTC().Format(time.RFC3339),
		"data":   data,
	}
	*seq++
	b, err := json.Marshal(envelope)
	if err != nil {
		return err
	}
	return h.rdb.Publish(ctx, "events:"+visitorID, string(b)).Err()
}

func writeErr(w http.ResponseWriter, status int, code, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]any{
		"error": map[string]string{"code": code, "message": msg},
	})
}

func newUUID() string {
	b := make([]byte, 16)
	_, _ = rand.Read(b)
	b[6] = (b[6] & 0x0f) | 0x40
	b[8] = (b[8] & 0x3f) | 0x80
	return fmt.Sprintf("%08x-%04x-%04x-%04x-%012x",
		b[0:4], b[4:6], b[6:8], b[8:10], b[10:16])
}
