// Package owner holds the owner-only API. Every route sits behind
// auth.RequireOwner, which reads the mode from the validated token claims.
package owner

import (
	"net/http"

	"nexo/gateway/internal/httpx"
)

// Ping — GET /api/v1/owner/ping
func Ping(w http.ResponseWriter, _ *http.Request) {
	httpx.WriteJSON(w, http.StatusOK, map[string]bool{"ok": true})
}
