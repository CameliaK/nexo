package auth

import (
	"encoding/json"
	"log"
	"net/http"
	"regexp"
	"time"

	"nexo/gateway/internal/clientip"
	"nexo/gateway/internal/mask"
	"nexo/gateway/internal/ratelimit"
	"nexo/gateway/internal/session"
)

var uuidRE = regexp.MustCompile(`(?i)^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)

type guestHandler struct {
	tokens    *TokenService
	sessions  *session.Store
	limiter   *ratelimit.Limiter
	ips       *clientip.Resolver
	perIPHour int
}

// NewHandler serves GET /auth/guest. The visitor id is chosen by the client,
// so the per-visitor limits can be dodged by inventing ids; every guest
// session also occupies Redis. Hence a per-IP cap (AUTH_GUEST_PER_IP_HOUR).
func NewHandler(t *TokenService, s *session.Store, l *ratelimit.Limiter, ips *clientip.Resolver, perIPHour int) http.HandlerFunc {
	h := &guestHandler{tokens: t, sessions: s, limiter: l, ips: ips, perIPHour: perIPHour}
	return h.serveHTTP
}

func (h *guestHandler) serveHTTP(w http.ResponseWriter, r *http.Request) {
	visitorID := r.Header.Get("X-Visitor-Id")
	if !uuidRE.MatchString(visitorID) {
		writeErr(w, http.StatusBadRequest, "invalid_request", "X-Visitor-Id must be a valid UUID")
		return
	}

	res, err := h.limiter.Hit(r.Context(), "rl:guest:ip:"+h.ips.Key(r), h.perIPHour, time.Hour)
	if err != nil {
		log.Printf("auth/guest: rate limit: %v", err)
		writeErr(w, http.StatusInternalServerError, "internal", "unexpected error")
		return
	}
	if !res.Allowed {
		ratelimit.Reject(w, res, "too many sessions from this network, try again later")
		return
	}

	if err := h.sessions.Touch(r.Context(), visitorID); err != nil {
		log.Printf("auth/guest: session touch visitor=%s: %v", mask.ID(visitorID), err)
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
