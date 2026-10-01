package session

import (
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"strings"
	"time"
)

var nodeProxyClient = &http.Client{Timeout: 10 * time.Second}

// VerifyFunc extracts a visitor_id from a raw PASETO token.
type VerifyFunc func(token string) (visitorID string, err error)

type nodesListHandler struct {
	verify   VerifyFunc
	agentURL string
}

type nodesDeleteHandler struct {
	verify   VerifyFunc
	agentURL string
}

func NewListNodesHandler(verify VerifyFunc, agentURL string) http.HandlerFunc {
	h := &nodesListHandler{verify: verify, agentURL: agentURL}
	return h.serveHTTP
}

func NewDeleteNodeHandler(verify VerifyFunc, agentURL string) http.HandlerFunc {
	h := &nodesDeleteHandler{verify: verify, agentURL: agentURL}
	return h.serveHTTP
}

func (h *nodesListHandler) serveHTTP(w http.ResponseWriter, r *http.Request) {
	visitorID, ok := verifyBearer(w, r, h.verify)
	if !ok {
		return
	}

	url := fmt.Sprintf("%s/internal/session/nodes?visitor_id=%s", h.agentURL, visitorID)
	resp, err := nodeProxyClient.Get(url)
	if err != nil {
		log.Printf("session/nodes list: agent unavailable: %v", err)
		writeNodeErr(w, http.StatusServiceUnavailable, "internal", "agent unavailable")
		return
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(resp.StatusCode)
	w.Write(body)
}

func (h *nodesDeleteHandler) serveHTTP(w http.ResponseWriter, r *http.Request) {
	visitorID, ok := verifyBearer(w, r, h.verify)
	if !ok {
		return
	}

	nodeID := r.PathValue("id")
	if nodeID == "" {
		writeNodeErr(w, http.StatusBadRequest, "invalid_request", "missing node id")
		return
	}

	url := fmt.Sprintf("%s/internal/session/nodes/%s?visitor_id=%s", h.agentURL, nodeID, visitorID)
	req, _ := http.NewRequestWithContext(r.Context(), http.MethodDelete, url, nil)
	resp, err := nodeProxyClient.Do(req)
	if err != nil {
		log.Printf("session/nodes delete: agent unavailable: %v", err)
		writeNodeErr(w, http.StatusServiceUnavailable, "internal", "agent unavailable")
		return
	}
	defer resp.Body.Close()
	w.WriteHeader(resp.StatusCode)
}

// ── helpers ───────────────────────────────────────────────────────────────────

func verifyBearer(w http.ResponseWriter, r *http.Request, verify VerifyFunc) (string, bool) {
	header := r.Header.Get("Authorization")
	if !strings.HasPrefix(header, "Bearer ") {
		writeNodeErr(w, http.StatusUnauthorized, "unauthorized", "missing Authorization header")
		return "", false
	}
	visitorID, err := verify(header[7:])
	if err != nil {
		writeNodeErr(w, http.StatusUnauthorized, "unauthorized", "invalid token")
		return "", false
	}
	return visitorID, true
}

func writeNodeErr(w http.ResponseWriter, status int, code, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(map[string]any{
		"error": map[string]string{"code": code, "message": msg},
	})
}
