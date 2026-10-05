// Package account serves the signed-in visitor's own account: notification
// preferences and deletion. Every route sits behind auth.RequireUser.
package account

import (
	"errors"
	"log"
	"net/http"

	"github.com/redis/go-redis/v9"

	"nexo/gateway/internal/accounts"
	"nexo/gateway/internal/auth"
	"nexo/gateway/internal/httpx"
	"nexo/gateway/internal/mask"
)

type Handler struct {
	Tokens   *auth.TokenService
	Accounts *accounts.Store
	Redis    *redis.Client
}

// GET /api/v1/account/notifications
func (h *Handler) GetNotifications(w http.ResponseWriter, r *http.Request) {
	c := auth.ClaimsFrom(r.Context())
	acc, err := h.Accounts.Get(r.Context(), c.AccountID)
	if !h.ok(w, c, err) {
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]bool{"chess_email": acc.ChessEmail})
}

// PUT /api/v1/account/notifications { chess_email }
func (h *Handler) PutNotifications(w http.ResponseWriter, r *http.Request) {
	c := auth.ClaimsFrom(r.Context())
	var body struct {
		ChessEmail *bool `json:"chess_email"`
	}
	if err := httpx.DecodeJSON(w, r, &body); err != nil || body.ChessEmail == nil {
		httpx.WriteErr(w, http.StatusBadRequest, "invalid_request", "chess_email (boolean) is required")
		return
	}
	acc, err := h.Accounts.SetChessEmail(r.Context(), c.AccountID, *body.ChessEmail)
	if !h.ok(w, c, err) {
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]bool{"chess_email": acc.ChessEmail})
}

// DELETE /api/v1/account — the account and all its data, in cascade:
// identities, chess games, generated nodes and live-chat messages. Every
// token of the account stops working, on every device.
func (h *Handler) Delete(w http.ResponseWriter, r *http.Request) {
	c := auth.ClaimsFrom(r.Context())
	ctx := r.Context()
	visitorID, err := h.Accounts.Delete(ctx, c.AccountID)
	if !h.ok(w, c, err) {
		return
	}
	if err := h.Tokens.RevokeAccount(ctx, c.AccountID); err != nil {
		log.Printf("account/delete: revoke account=%s: %v", mask.ID(c.AccountID), err)
	}
	if err := h.Tokens.Revoke(ctx, c); err != nil {
		log.Printf("account/delete: revoke token account=%s: %v", mask.ID(c.AccountID), err)
	}
	if err := h.Redis.Del(ctx, "session:"+visitorID).Err(); err != nil {
		log.Printf("account/delete: session visitor=%s: %v", mask.ID(visitorID), err)
	}
	log.Printf("account/delete: account=%s visitor=%s deleted", mask.ID(c.AccountID), mask.ID(visitorID))
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handler) ok(w http.ResponseWriter, c *auth.Claims, err error) bool {
	if errors.Is(err, accounts.ErrNotFound) {
		httpx.WriteErr(w, http.StatusUnauthorized, "unauthorized", "account no longer exists")
		return false
	}
	if err != nil {
		log.Printf("account: account=%s: %v", mask.ID(c.AccountID), err)
		httpx.WriteErr(w, http.StatusInternalServerError, "internal", "unexpected error")
		return false
	}
	return true
}
