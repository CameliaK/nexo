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
	"nexo/gateway/internal/mask"
)

var agentClient = &http.Client{Timeout: 10 * time.Second}

type handler struct {
	tokens   *auth.TokenService
	rdb      *redis.Client
	agentURL string
}

func NewHandler(tokens *auth.TokenService, rdb *redis.Client, agentURL string) http.HandlerFunc {
	h := &handler{tokens: tokens, rdb: rdb, agentURL: agentURL}
	return h.serveHTTP
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
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid_request", "invalid JSON body")
		return
	}
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

	// Publish run.start
	if err := h.pub(ctx, visitorID, "run.start", runID, &seq, map[string]any{
		"kind":            "chat",
		"input":           body.Message,
		"content_version": 3,
	}); err != nil {
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
	go h.callAgent(visitorID, runID, body.Message, seq)
}

func (h *handler) callAgent(visitorID, runID, message string, seqStart int) {
	ctx := context.Background()

	payload, _ := json.Marshal(map[string]any{
		"run_id":     runID,
		"visitor_id": visitorID,
		"input":      message,
		"seq_start":  seqStart,
	})

	resp, err := agentClient.Post(h.agentURL+"/internal/chat", "application/json", bytes.NewReader(payload))
	if err != nil {
		log.Printf("chat: agent call failed visitor=%s run=%s: %v", mask.ID(visitorID), runID, err)
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
