package live

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/redis/go-redis/v9"
	"nexo/gateway/internal/auth"
)

var agentClient = &http.Client{Timeout: 10 * time.Second}

const (
	maxTextChars = 500
	maxNameChars = 30
	hourlyLimit  = 10
	dailyLimit   = 200
)

type Handler struct {
	tokens   *auth.TokenService
	rdb      *redis.Client
	agentURL string
}

func NewHandler(tokens *auth.TokenService, rdb *redis.Client, agentURL string) *Handler {
	return &Handler{tokens: tokens, rdb: rdb, agentURL: agentURL}
}

func (h *Handler) Post(w http.ResponseWriter, r *http.Request) {
	visitorID, ok := verifyBearer(w, r, h.tokens)
	if !ok {
		return
	}

	var body struct {
		Text string `json:"text"`
		Name string `json:"name"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid_request", "invalid JSON body")
		return
	}
	if body.Text == "" {
		writeErr(w, http.StatusBadRequest, "invalid_request", "text is required")
		return
	}
	if len([]rune(body.Text)) > maxTextChars {
		writeErr(w, http.StatusBadRequest, "invalid_request", fmt.Sprintf("text too long (max %d characters)", maxTextChars))
		return
	}
	if len([]rune(body.Name)) > maxNameChars {
		writeErr(w, http.StatusBadRequest, "invalid_request", fmt.Sprintf("name too long (max %d characters)", maxNameChars))
		return
	}
	if containsLink(body.Text) {
		writeErr(w, http.StatusBadRequest, "invalid_request", "links are not allowed in messages")
		return
	}

	ctx := r.Context()
	allowed, retryAfter := h.antispam(ctx, visitorID)
	if !allowed {
		w.Header().Set("Retry-After", fmt.Sprintf("%d", retryAfter))
		writeErr(w, http.StatusTooManyRequests, "rate_limited", "too many messages, please try again later")
		return
	}

	messageID := newUUID()
	runID := newUUID()
	seq := 1

	if err := pub(ctx, h.rdb, visitorID, "run.start", runID, &seq, map[string]any{
		"kind":            "live_out",
		"content_version": 2,
	}); err != nil {
		log.Printf("live/post: publish run.start visitor=%s: %v", visitorID, err)
		writeErr(w, http.StatusInternalServerError, "internal", "failed to publish event")
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusAccepted)
	_ = json.NewEncoder(w).Encode(map[string]string{
		"message_id": messageID,
		"run_id":     runID,
	})

	go h.callAgent(visitorID, runID, messageID, body.Text, body.Name, seq)
}

func (h *Handler) Get(w http.ResponseWriter, r *http.Request) {
	visitorID, ok := verifyBearer(w, r, h.tokens)
	if !ok {
		return
	}

	resp, err := agentClient.Get(h.agentURL + "/internal/live/messages?visitor_id=" + visitorID)
	if err != nil {
		log.Printf("live/get: agent unavailable: %v", err)
		writeErr(w, http.StatusServiceUnavailable, "internal", "agent unavailable")
		return
	}
	defer resp.Body.Close()
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(resp.StatusCode)
	_, _ = io.Copy(w, resp.Body)
}

func (h *Handler) callAgent(visitorID, runID, messageID, text, name string, seqStart int) {
	ctx := context.Background()
	payload, _ := json.Marshal(map[string]any{
		"run_id":     runID,
		"visitor_id": visitorID,
		"message_id": messageID,
		"text":       text,
		"name":       name,
		"seq_start":  seqStart,
	})
	resp, err := agentClient.Post(h.agentURL+"/internal/live/messages", "application/json", bytes.NewReader(payload))
	if err != nil {
		log.Printf("live: agent call failed visitor=%s run=%s: %v", visitorID, runID, err)
		seq := seqStart
		_ = pub(ctx, h.rdb, visitorID, "run.error", runID, &seq, map[string]any{
			"code": "internal", "message": "No se pudo procesar el mensaje.", "retryable": true,
		})
		return
	}
	resp.Body.Close()
}

// ── helpers ──────────────────────────────────────────────────────────────────

func (h *Handler) antispam(ctx context.Context, visitorID string) (allowed bool, retryAfter int) {
	hourlyKey := "antispam:hourly:" + visitorID
	count, _ := h.rdb.Incr(ctx, hourlyKey).Result()
	if count == 1 {
		h.rdb.Expire(ctx, hourlyKey, time.Hour)
	}
	if count > hourlyLimit {
		ttl, _ := h.rdb.TTL(ctx, hourlyKey).Result()
		return false, int(ttl.Seconds())
	}

	dailyKey := "antispam:daily:total"
	dcount, _ := h.rdb.Incr(ctx, dailyKey).Result()
	if dcount == 1 {
		h.rdb.Expire(ctx, dailyKey, 24*time.Hour)
	}
	if dcount > dailyLimit {
		ttl, _ := h.rdb.TTL(ctx, dailyKey).Result()
		return false, int(ttl.Seconds())
	}

	return true, 0
}

func containsLink(text string) bool {
	return strings.Contains(text, "http://") ||
		strings.Contains(text, "https://") ||
		strings.Contains(text, "www.")
}

func verifyBearer(w http.ResponseWriter, r *http.Request, tokens *auth.TokenService) (string, bool) {
	header := r.Header.Get("Authorization")
	if !strings.HasPrefix(header, "Bearer ") {
		writeErr(w, http.StatusUnauthorized, "unauthorized", "missing Authorization header")
		return "", false
	}
	visitorID, err := tokens.Verify(header[7:])
	if err != nil {
		writeErr(w, http.StatusUnauthorized, "unauthorized", "invalid token")
		return "", false
	}
	return visitorID, true
}

func pub(ctx context.Context, rdb *redis.Client, visitorID, eventType, runID string, seq *int, data map[string]any) error {
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
	return rdb.Publish(ctx, "events:"+visitorID, string(b)).Err()
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
