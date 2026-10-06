package auth

import (
	"context"
	"errors"
	"fmt"
	"log"
	"time"

	paseto "aidanwoods.dev/go-paseto"
	"github.com/redis/go-redis/v9"

	"nexo/gateway/internal/accounts"
)

type Mode string

const (
	ModeGuest Mode = "guest"
	ModeUser  Mode = "user"
	ModeOwner Mode = "owner"
)

// Claims of a validated session token. Mode comes ONLY from here — never from
// the body, headers or query string.
type Claims struct {
	VisitorID string
	Mode      Mode
	AccountID string // "" for guests
	Provider  string // provider of the login that issued the token
	JTI       string
	Expires   time.Time
}

func (c *Claims) IsAccount() bool { return c.Mode == ModeUser || c.Mode == ModeOwner }

// Unsubscribe tokens are encrypted with an implicit assertion, so a session
// token never decrypts as an unsubscribe token and vice versa.
var unsubscribeImplicit = []byte("nexo:unsubscribe")

const unsubscribeTTL = 365 * 24 * time.Hour

var ErrRevoked = errors.New("token revoked")

// TokenService issues and verifies PASETO v4 local tokens.
// The symmetric key is loaded from PASETO_LOCAL_KEY (hex). If empty, an
// ephemeral key is generated — tokens then die with the process (dev only).
type TokenService struct {
	key      paseto.V4SymmetricKey
	guestTTL time.Duration
	userTTL  time.Duration
	ownerTTL time.Duration
	rdb      *redis.Client
}

func NewTokenService(hexKey string, guestTTL, userTTL, ownerTTL time.Duration, rdb *redis.Client) (*TokenService, error) {
	var key paseto.V4SymmetricKey
	if hexKey == "" {
		key = paseto.NewV4SymmetricKey()
		log.Printf("WARNING: PASETO_LOCAL_KEY not set — ephemeral key in use, tokens will not survive restarts (generate one with `make gen-key`)")
	} else {
		var err error
		key, err = paseto.V4SymmetricKeyFromHex(hexKey)
		if err != nil {
			return nil, fmt.Errorf("invalid PASETO_LOCAL_KEY: %w", err)
		}
	}
	return &TokenService{key: key, guestTTL: guestTTL, userTTL: userTTL, ownerTTL: ownerTTL, rdb: rdb}, nil
}

// Issue returns a guest token for visitorID (GET /auth/guest).
func (s *TokenService) Issue(visitorID string) string {
	tok, _ := s.issue(visitorID, ModeGuest, "", "")
	return tok
}

// IssueAccount returns a user or owner token. Owner tokens last OWNER_TOKEN_TTL.
func (s *TokenService) IssueAccount(visitorID, accountID, provider string, mode Mode) string {
	tok, _ := s.issue(visitorID, mode, accountID, provider)
	return tok
}

func (s *TokenService) issue(visitorID string, mode Mode, accountID, provider string) (string, *Claims) {
	ttl := s.guestTTL
	switch mode {
	case ModeUser:
		ttl = s.userTTL
	case ModeOwner:
		ttl = s.ownerTTL
	}
	now := time.Now()
	c := &Claims{
		VisitorID: visitorID, Mode: mode, AccountID: accountID, Provider: provider,
		JTI: accounts.NewUUID(), Expires: now.Add(ttl),
	}
	t := paseto.NewToken()
	t.SetString("visitor_id", visitorID)
	t.SetString("mode", string(mode))
	if accountID != "" {
		t.SetString("account_id", accountID)
		t.SetString("provider", provider)
	}
	t.SetJti(c.JTI)
	t.SetIssuedAt(now)
	t.SetNotBefore(now)
	t.SetExpiration(c.Expires)
	return t.V4Encrypt(s.key, nil), c
}

// Verify decrypts a session token and returns its visitor_id. Kept for the
// handlers that only need the visitor (chat, live, session nodes).
func (s *TokenService) Verify(tokenStr string) (string, error) {
	c, err := s.VerifyClaims(context.Background(), tokenStr)
	if err != nil {
		return "", err
	}
	return c.VisitorID, nil
}

// VerifyClaims decrypts and validates a session token (expiry included) and
// rejects revoked tokens and tokens of deleted accounts. A Redis failure
// rejects the token too: revocation fails closed.
func (s *TokenService) VerifyClaims(ctx context.Context, tokenStr string) (*Claims, error) {
	t, err := paseto.NewParser().ParseV4Local(s.key, tokenStr, nil)
	if err != nil {
		return nil, fmt.Errorf("invalid token: %w", err)
	}
	c := &Claims{}
	if c.VisitorID, err = t.GetString("visitor_id"); err != nil || c.VisitorID == "" {
		return nil, errors.New("token missing visitor_id")
	}
	c.Expires, _ = t.GetExpiration()
	c.JTI, _ = t.GetJti()

	mode, err := t.GetString("mode")
	switch {
	case err != nil:
		c.Mode = ModeGuest // guest tokens issued before accounts existed
	case Mode(mode) == ModeGuest || Mode(mode) == ModeUser || Mode(mode) == ModeOwner:
		c.Mode = Mode(mode)
	default:
		return nil, errors.New("token has unknown mode")
	}
	if c.IsAccount() {
		c.AccountID, _ = t.GetString("account_id")
		c.Provider, _ = t.GetString("provider")
		if c.AccountID == "" || c.JTI == "" {
			return nil, errors.New("account token missing account_id or jti")
		}
	}

	if err := s.Recheck(ctx, c); err != nil {
		return nil, err
	}
	return c, nil
}

// Recheck re-applies expiry and revocation (token revoked, account deleted)
// to claims validated earlier — e.g. when a WebSocket ticket issued from
// them is redeemed. A Redis failure fails closed.
func (s *TokenService) Recheck(ctx context.Context, c *Claims) error {
	if !c.Expires.IsZero() && time.Now().After(c.Expires) {
		return errors.New("token expired")
	}
	var keys []string
	if c.JTI != "" {
		keys = append(keys, revokedKey(c.JTI))
	}
	if c.AccountID != "" {
		keys = append(keys, deletedAccountKey(c.AccountID))
	}
	if len(keys) > 0 {
		n, err := s.rdb.Exists(ctx, keys...).Result()
		if err != nil {
			return fmt.Errorf("revocation check: %w", err)
		}
		if n > 0 {
			return ErrRevoked
		}
	}
	return nil
}

// Revoke blocks the token until it would have expired anyway.
func (s *TokenService) Revoke(ctx context.Context, c *Claims) error {
	if c.JTI == "" {
		return nil // legacy guest token: nothing to key on, it just expires
	}
	ttl := time.Until(c.Expires)
	if ttl <= 0 {
		return nil
	}
	return s.rdb.Set(ctx, revokedKey(c.JTI), 1, ttl).Err()
}

// RevokeAccount blocks every token of a deleted account, on every device,
// for as long as any of them could still be valid.
func (s *TokenService) RevokeAccount(ctx context.Context, accountID string) error {
	ttl := max(s.userTTL, s.ownerTTL)
	return s.rdb.Set(ctx, deletedAccountKey(accountID), 1, ttl).Err()
}

// IssueUnsubscribe returns a signed token for POST /auth/unsubscribe, sent in
// notification emails. It needs no session and cannot be used as one.
func (s *TokenService) IssueUnsubscribe(accountID string) string {
	now := time.Now()
	t := paseto.NewToken()
	t.SetString("account_id", accountID)
	t.SetString("purpose", "unsubscribe")
	t.SetIssuedAt(now)
	t.SetNotBefore(now)
	t.SetExpiration(now.Add(unsubscribeTTL))
	return t.V4Encrypt(s.key, unsubscribeImplicit)
}

func (s *TokenService) VerifyUnsubscribe(tokenStr string) (string, error) {
	t, err := paseto.NewParser().ParseV4Local(s.key, tokenStr, unsubscribeImplicit)
	if err != nil {
		return "", fmt.Errorf("invalid unsubscribe token: %w", err)
	}
	if p, _ := t.GetString("purpose"); p != "unsubscribe" {
		return "", errors.New("wrong token purpose")
	}
	id, err := t.GetString("account_id")
	if err != nil || id == "" {
		return "", errors.New("unsubscribe token missing account_id")
	}
	return id, nil
}

func revokedKey(jti string) string       { return "auth:revoked:" + jti }
func deletedAccountKey(id string) string { return "auth:deleted-account:" + id }
