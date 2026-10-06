package ws

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"time"

	"github.com/redis/go-redis/v9"

	"nexo/gateway/internal/auth"
	"nexo/gateway/internal/httpx"
	"nexo/gateway/internal/mask"
)

// TicketTTL is how long a WebSocket ticket can wait before being redeemed.
const TicketTTL = 30 * time.Second

var errBadTicket = errors.New("invalid, used or expired ticket")

// Tickets issues and redeems one-time WebSocket tickets, so the session token
// never travels in the /ws query string (where proxies and access logs see
// it). A ticket is 32 random bytes; Redis keeps only its SHA-256, bound to the
// claims of the token that asked for it (visitor, mode, account, jti).
// Redeeming is GETDEL: a ticket works exactly once, within TicketTTL.
type Tickets struct {
	rdb    *redis.Client
	tokens *auth.TokenService
}

func NewTickets(rdb *redis.Client, tokens *auth.TokenService) *Tickets {
	return &Tickets{rdb: rdb, tokens: tokens}
}

type ticketClaims struct {
	VisitorID string    `json:"visitor_id"`
	Mode      auth.Mode `json:"mode"`
	AccountID string    `json:"account_id,omitempty"`
	Provider  string    `json:"provider,omitempty"`
	JTI       string    `json:"jti,omitempty"`
	Expires   time.Time `json:"expires"`
}

func ticketKey(ticket string) string {
	sum := sha256.Sum256([]byte(ticket))
	return "ws:ticket:" + hex.EncodeToString(sum[:])
}

func (t *Tickets) issue(ctx context.Context, c *auth.Claims) (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	ticket := base64.RawURLEncoding.EncodeToString(b)
	v, _ := json.Marshal(ticketClaims{c.VisitorID, c.Mode, c.AccountID, c.Provider, c.JTI, c.Expires})
	if err := t.rdb.Set(ctx, ticketKey(ticket), v, TicketTTL).Err(); err != nil {
		return "", err
	}
	return ticket, nil
}

// redeem consumes the ticket and returns the claims it was issued for, after
// re-checking that the token behind it was not revoked in the meantime.
func (t *Tickets) redeem(ctx context.Context, ticket string) (*auth.Claims, error) {
	if len(ticket) != 43 { // base64url of 32 bytes
		return nil, errBadTicket
	}
	raw, err := t.rdb.GetDel(ctx, ticketKey(ticket)).Bytes()
	if errors.Is(err, redis.Nil) {
		return nil, errBadTicket
	}
	if err != nil {
		return nil, err
	}
	var tc ticketClaims
	if err := json.Unmarshal(raw, &tc); err != nil {
		return nil, err
	}
	c := &auth.Claims{VisitorID: tc.VisitorID, Mode: tc.Mode, AccountID: tc.AccountID,
		Provider: tc.Provider, JTI: tc.JTI, Expires: tc.Expires}
	if err := t.tokens.Recheck(ctx, c); err != nil {
		return nil, err
	}
	return c, nil
}

// Issue — POST /api/v1/ws-ticket (behind auth.RequireAuth).
func (t *Tickets) Issue(w http.ResponseWriter, r *http.Request) {
	c := auth.ClaimsFrom(r.Context())
	ticket, err := t.issue(r.Context(), c)
	if err != nil {
		log.Printf("ws-ticket: visitor=%s: %v", mask.ID(c.VisitorID), err)
		httpx.WriteErr(w, http.StatusInternalServerError, "internal", "unexpected error")
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"ticket": ticket, "expires_in": int(TicketTTL.Seconds())})
}
