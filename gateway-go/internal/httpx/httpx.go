// Package httpx holds the small HTTP helpers shared by the auth, account and
// owner handlers: the contract's error body, JSON responses and request
// metadata (bearer token, client IP).
package httpx

import (
	"encoding/json"
	"net"
	"net/http"
	"strings"
)

func WriteErr(w http.ResponseWriter, status int, code, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]any{
		"error": map[string]string{"code": code, "message": msg},
	})
}

func WriteJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

// DecodeJSON reads a small JSON body (max 8 KiB).
func DecodeJSON(w http.ResponseWriter, r *http.Request, v any) error {
	r.Body = http.MaxBytesReader(w, r.Body, 8<<10)
	return json.NewDecoder(r.Body).Decode(v)
}

// BearerToken returns the token from "Authorization: Bearer <token>", or "".
func BearerToken(r *http.Request) string {
	h := r.Header.Get("Authorization")
	if !strings.HasPrefix(h, "Bearer ") {
		return ""
	}
	return strings.TrimSpace(h[7:])
}

// ClientIP returns the last X-Forwarded-For entry — the one Traefik appends,
// so earlier entries forged by the client are ignored — or the peer address.
func ClientIP(r *http.Request) string {
	if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
		parts := strings.Split(xff, ",")
		if ip := strings.TrimSpace(parts[len(parts)-1]); ip != "" {
			return ip
		}
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}
