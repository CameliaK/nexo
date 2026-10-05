package auth

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
	"net/mail"
	"slices"
	"time"

	"github.com/redis/go-redis/v9"

	"nexo/gateway/internal/accounts"
	"nexo/gateway/internal/clientip"
	"nexo/gateway/internal/httpx"
	nexomail "nexo/gateway/internal/mail"
	"nexo/gateway/internal/mask"
	"nexo/gateway/internal/ratelimit"
	"nexo/gateway/internal/session"
)

const (
	emailLinkTTL = 15 * time.Minute
	loginCodeTTL = 60 * time.Second
	mailTimeout  = 30 * time.Second
)

// Service implements the account login endpoints: email link, Google code
// exchange, logout, me and unsubscribe.
type Service struct {
	Tokens   *TokenService
	Redis    *redis.Client
	Accounts *accounts.Store
	Sessions *session.Store
	Mailer   nexomail.Mailer // nil → email login unavailable (503)
	Google   *Google         // nil → Google login unavailable (503)
	Limiter  *ratelimit.Limiter
	IPs      *clientip.Resolver

	PublicBaseURL      string
	OwnerEmail         string
	OwnerProviders     []string
	AuthEmailPerHour   int
	AuthEmailPerIPHour int
}

// isOwner fails closed: empty OWNER_EMAIL, another email or a provider not in
// OWNER_PROVIDERS all mean "not the owner".
func (s *Service) isOwner(l accounts.Login) bool {
	return s.OwnerEmail != "" && l.Email == s.OwnerEmail && slices.Contains(s.OwnerProviders, l.Provider)
}

// ── POST /auth/email/request ─────────────────────────────────────────────────

func (s *Service) EmailRequest(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Email string `json:"email"`
		Lang  string `json:"lang"`
	}
	if err := httpx.DecodeJSON(w, r, &body); err != nil {
		httpx.WriteErr(w, http.StatusBadRequest, "invalid_request", "invalid JSON body")
		return
	}
	email := accounts.NormalizeEmail(body.Email)
	if !validEmail(email) {
		httpx.WriteErr(w, http.StatusBadRequest, "invalid_request", "invalid email address")
		return
	}
	lang := body.Lang
	if lang != "en" {
		lang = "es"
	}
	if s.Mailer == nil {
		httpx.WriteErr(w, http.StatusServiceUnavailable, "internal", "email sign-in is not available")
		return
	}

	ctx := r.Context()
	for _, lim := range []struct {
		key   string
		limit int
	}{
		{"rl:auth-email:ip:" + s.IPs.Key(r), s.AuthEmailPerIPHour},
		{"rl:auth-email:addr:" + hashHex(email), s.AuthEmailPerHour},
	} {
		res, err := s.Limiter.Hit(ctx, lim.key, lim.limit, time.Hour)
		if err != nil {
			log.Printf("auth/email: rate limit: %v", err)
			httpx.WriteErr(w, http.StatusInternalServerError, "internal", "unexpected error")
			return
		}
		if !res.Allowed {
			ratelimit.Reject(w, res, "too many sign-in emails, try again later")
			return
		}
	}

	// The link is issued the same way whether or not an account exists: the
	// account is resolved only when the link is verified, so the response
	// cannot reveal anything.
	token := randomToken()
	payload, _ := json.Marshal(accounts.Login{Provider: "email", Subject: email, Email: email, Lang: lang})
	if err := s.Redis.Set(ctx, emailLinkKey(token), payload, emailLinkTTL).Err(); err != nil {
		log.Printf("auth/email: store link: %v", err)
		httpx.WriteErr(w, http.StatusInternalServerError, "internal", "unexpected error")
		return
	}

	link := s.PublicBaseURL + "/#/login/confirm?t=" + token
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), mailTimeout)
		defer cancel()
		if err := s.Mailer.Send(ctx, nexomail.LoginEmail(email, lang, link)); err != nil {
			log.Printf("auth/email: send to=%s failed: %v", mask.Email(email), err)
			return
		}
		log.Printf("auth/email: link sent to=%s lang=%s", mask.Email(email), lang)
	}()

	w.WriteHeader(http.StatusAccepted)
}

// ── POST /auth/email/verify ──────────────────────────────────────────────────
// Only this call consumes the link (GETDEL): opening the confirmation page,
// or a mail scanner following the URL, never reaches the gateway.

func (s *Service) EmailVerify(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Token string `json:"token"`
	}
	if err := httpx.DecodeJSON(w, r, &body); err != nil || body.Token == "" {
		httpx.WriteErr(w, http.StatusBadRequest, "invalid_request", "token is required")
		return
	}
	l, ok := s.consumeLogin(w, r, emailLinkKey(body.Token))
	if !ok {
		return
	}
	s.finishLogin(w, r, l)
}

// ── POST /auth/exchange ──────────────────────────────────────────────────────
// Trades the one-time code from the Google callback redirect for a token, so
// the token never travels in a URL.

func (s *Service) Exchange(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Code string `json:"code"`
	}
	if err := httpx.DecodeJSON(w, r, &body); err != nil || body.Code == "" {
		httpx.WriteErr(w, http.StatusBadRequest, "invalid_request", "code is required")
		return
	}
	l, ok := s.consumeLogin(w, r, loginCodeKey(body.Code))
	if !ok {
		return
	}
	s.finishLogin(w, r, l)
}

func (s *Service) consumeLogin(w http.ResponseWriter, r *http.Request, key string) (accounts.Login, bool) {
	var l accounts.Login
	raw, err := s.Redis.GetDel(r.Context(), key).Bytes()
	if errors.Is(err, redis.Nil) {
		httpx.WriteErr(w, http.StatusUnauthorized, "unauthorized", "invalid or expired link")
		return l, false
	}
	if err != nil {
		log.Printf("auth: consume login: %v", err)
		httpx.WriteErr(w, http.StatusInternalServerError, "internal", "unexpected error")
		return l, false
	}
	if err := json.Unmarshal(raw, &l); err != nil || l.Email == "" || l.Provider == "" || l.Subject == "" {
		httpx.WriteErr(w, http.StatusUnauthorized, "unauthorized", "invalid or expired link")
		return l, false
	}
	return l, true
}

// finishLogin links the verified login to an account and answers
// { token, visitor_id } (POST /auth/email/verify and POST /auth/exchange).
// The current anonymous id comes only from a valid guest Bearer token.
func (s *Service) finishLogin(w http.ResponseWriter, r *http.Request, l accounts.Login) {
	ctx := r.Context()
	anon := ""
	if tok := httpx.BearerToken(r); tok != "" {
		if c, err := s.Tokens.VerifyClaims(ctx, tok); err == nil && c.Mode == ModeGuest {
			anon = c.VisitorID
		}
	}

	acc, created, err := s.Accounts.Link(ctx, l, anon)
	if err != nil {
		log.Printf("auth: link provider=%s email=%s: %v", l.Provider, mask.Email(l.Email), err)
		httpx.WriteErr(w, http.StatusInternalServerError, "internal", "unexpected error")
		return
	}
	mode := ModeUser
	if s.isOwner(l) {
		mode = ModeOwner
	}
	if err := s.Sessions.Touch(ctx, acc.VisitorID); err != nil {
		log.Printf("auth: session touch visitor=%s: %v", mask.ID(acc.VisitorID), err)
	}
	log.Printf("auth: login provider=%s account=%s visitor=%s email=%s mode=%s new=%t adopted_anon=%t",
		l.Provider, mask.ID(acc.ID), mask.ID(acc.VisitorID), mask.Email(acc.Email), mode, created,
		created && anon != "" && acc.VisitorID == anon)

	// visitor_id is the account's canonical id: the token is opaque
	// (v4.local), so the browser adopts the id from here. Body only — it
	// never goes in a URL.
	httpx.WriteJSON(w, http.StatusOK, map[string]string{
		"token":      s.Tokens.IssueAccount(acc.VisitorID, acc.ID, l.Provider, mode),
		"visitor_id": acc.VisitorID,
	})
}

// ── POST /auth/logout ────────────────────────────────────────────────────────

func (s *Service) Logout(w http.ResponseWriter, r *http.Request) {
	c := ClaimsFrom(r.Context())
	if err := s.Tokens.Revoke(r.Context(), c); err != nil {
		log.Printf("auth/logout: revoke: %v", err)
		httpx.WriteErr(w, http.StatusInternalServerError, "internal", "unexpected error")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// ── GET /api/v1/auth/me ──────────────────────────────────────────────────────

func (s *Service) Me(w http.ResponseWriter, r *http.Request) {
	c := ClaimsFrom(r.Context())
	if !c.IsAccount() {
		httpx.WriteJSON(w, http.StatusOK, map[string]string{"mode": string(ModeGuest)})
		return
	}
	acc, err := s.Accounts.Touch(r.Context(), c.AccountID)
	if errors.Is(err, accounts.ErrNotFound) {
		httpx.WriteErr(w, http.StatusUnauthorized, "unauthorized", "account no longer exists")
		return
	}
	if err != nil {
		log.Printf("auth/me: account=%s: %v", mask.ID(c.AccountID), err)
		httpx.WriteErr(w, http.StatusInternalServerError, "internal", "unexpected error")
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]string{
		"mode": string(c.Mode), "email_hint": mask.Email(acc.Email),
	})
}

// ── POST /auth/unsubscribe ───────────────────────────────────────────────────
// No session: the signed token from the email is the authorization.

func (s *Service) Unsubscribe(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Token string `json:"token"`
	}
	if err := httpx.DecodeJSON(w, r, &body); err != nil || body.Token == "" {
		httpx.WriteErr(w, http.StatusBadRequest, "invalid_request", "token is required")
		return
	}
	accountID, err := s.Tokens.VerifyUnsubscribe(body.Token)
	if err != nil {
		httpx.WriteErr(w, http.StatusBadRequest, "invalid_request", "invalid unsubscribe link")
		return
	}
	_, err = s.Accounts.SetChessEmail(r.Context(), accountID, false)
	if err != nil && !errors.Is(err, accounts.ErrNotFound) {
		log.Printf("auth/unsubscribe: account=%s: %v", mask.ID(accountID), err)
		httpx.WriteErr(w, http.StatusInternalServerError, "internal", "unexpected error")
		return
	}
	// A deleted account has nothing left to unsubscribe from: still 204.
	log.Printf("auth/unsubscribe: account=%s chess_email=false", mask.ID(accountID))
	w.WriteHeader(http.StatusNoContent)
}

// UnsubscribeURL is the link every notification email must carry.
func (s *Service) UnsubscribeURL(accountID string) string {
	return s.PublicBaseURL + "/#/unsubscribe?t=" + s.Tokens.IssueUnsubscribe(accountID)
}

// ── helpers ──────────────────────────────────────────────────────────────────

func validEmail(email string) bool {
	if len(email) < 3 || len(email) > 254 {
		return false
	}
	addr, err := mail.ParseAddress(email)
	return err == nil && addr.Address == email && addr.Name == ""
}

// randomToken returns 32 random bytes, base64url without padding.
func randomToken() string {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		panic(err) // crypto/rand never fails on supported platforms
	}
	return base64.RawURLEncoding.EncodeToString(b)
}

func hashHex(s string) string {
	sum := sha256.Sum256([]byte(s))
	return hex.EncodeToString(sum[:])
}

// Secrets are stored only as hashes: a Redis dump never yields a usable link.
func emailLinkKey(token string) string { return "auth:email-link:" + hashHex(token) }
func loginCodeKey(code string) string  { return "auth:login-code:" + hashHex(code) }
