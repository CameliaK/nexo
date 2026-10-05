// Package httpx holds the small HTTP helpers shared by the auth, account and
// owner handlers: the contract's error body, JSON responses and request
// metadata (bearer token). The client IP lives in package clientip.
package httpx

import (
	"encoding/json"
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
