package auth

import (
	"encoding/json"
	"net/http"
	"regexp"

	"nexo/gateway/internal/session"
)

var uuidRE = regexp.MustCompile(`(?i)^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)

type guestHandler struct {
	tokens   *TokenService
	sessions *session.Store
}

func NewHandler(t *TokenService, s *session.Store) http.HandlerFunc {
	h := &guestHandler{tokens: t, sessions: s}
	return h.serveHTTP
}

func (h *guestHandler) serveHTTP(w http.ResponseWriter, r *http.Request) {
	visitorID := r.Header.Get("X-Visitor-Id")
	if !uuidRE.MatchString(visitorID) {
		writeErr(w, http.StatusBadRequest, "invalid_request", "X-Visitor-Id must be a valid UUID")
		return
	}

	if err := h.sessions.Touch(r.Context(), visitorID); err != nil {
		writeErr(w, http.StatusInternalServerError, "internal", "session unavailable")
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"token": h.tokens.Issue(visitorID)})
}

func writeErr(w http.ResponseWriter, status int, code, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(map[string]any{
		"error": map[string]string{"code": code, "message": msg},
	})
}
