package auth

import (
	"context"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/coreos/go-oidc/v3/oidc"
	"github.com/redis/go-redis/v9"
	"golang.org/x/oauth2"

	"nexo/gateway/internal/accounts"
	"nexo/gateway/internal/mask"
)

const (
	googleIssuer    = "https://accounts.google.com"
	oauthStateTTL   = 10 * time.Minute
	oauthCookie     = "nexo_oauth_state"
	oauthCookiePath = "/auth/google"
)

// Google implements Authorization Code + PKCE against Google's OIDC provider.
// Scopes are only openid and email. Google's tokens are discarded right after
// the id_token is verified; nothing from Google is stored.
type Google struct {
	clientID     string
	clientSecret string
	redirectURL  string
	secureCookie bool

	mu       sync.Mutex
	oauth    *oauth2.Config
	verifier *oidc.IDTokenVerifier
}

func NewGoogle(clientID, clientSecret, redirectURL, publicBaseURL string) *Google {
	return &Google{
		clientID: clientID, clientSecret: clientSecret, redirectURL: redirectURL,
		secureCookie: strings.HasPrefix(publicBaseURL, "https://"),
	}
}

// provider runs OIDC discovery lazily and caches it, so a network hiccup at
// startup does not disable Google login until the next restart.
func (g *Google) provider(ctx context.Context) (*oauth2.Config, *oidc.IDTokenVerifier, error) {
	g.mu.Lock()
	defer g.mu.Unlock()
	if g.oauth != nil {
		return g.oauth, g.verifier, nil
	}
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	p, err := oidc.NewProvider(ctx, googleIssuer)
	if err != nil {
		return nil, nil, err
	}
	g.oauth = &oauth2.Config{
		ClientID:     g.clientID,
		ClientSecret: g.clientSecret,
		RedirectURL:  g.redirectURL,
		Endpoint:     p.Endpoint(),
		Scopes:       []string{oidc.ScopeOpenID, "email"},
	}
	// Checks signature (Google JWKS), iss, aud == client id and exp.
	g.verifier = p.Verifier(&oidc.Config{ClientID: g.clientID})
	return g.oauth, g.verifier, nil
}

type oauthState struct {
	Verifier string `json:"verifier"`
	Nonce    string `json:"nonce"`
	Lang     string `json:"lang"`
}

func oauthStateKey(state string) string { return "auth:oauth-state:" + hashHex(state) }

// ── GET /auth/google/login ───────────────────────────────────────────────────

func (s *Service) GoogleLogin(w http.ResponseWriter, r *http.Request) {
	if s.Google == nil {
		http.Error(w, "Google sign-in is not available", http.StatusServiceUnavailable)
		return
	}
	cfg, _, err := s.Google.provider(r.Context())
	if err != nil {
		log.Printf("auth/google: discovery: %v", err)
		http.Error(w, "Google sign-in is not available", http.StatusServiceUnavailable)
		return
	}

	state, nonce, verifier := randomToken(), randomToken(), oauth2.GenerateVerifier()
	lang := r.URL.Query().Get("lang")
	if lang != "en" && lang != "es" {
		lang = ""
	}
	payload, _ := json.Marshal(oauthState{Verifier: verifier, Nonce: nonce, Lang: lang})
	if err := s.Redis.Set(r.Context(), oauthStateKey(state), payload, oauthStateTTL).Err(); err != nil {
		log.Printf("auth/google: store state: %v", err)
		http.Error(w, "unexpected error", http.StatusInternalServerError)
		return
	}
	// Binds the flow to this browser: a callback carrying a state that was
	// started elsewhere (login CSRF) has no matching cookie.
	http.SetCookie(w, &http.Cookie{
		Name: oauthCookie, Value: state, Path: oauthCookiePath,
		MaxAge: int(oauthStateTTL.Seconds()), HttpOnly: true,
		Secure: s.Google.secureCookie, SameSite: http.SameSiteLaxMode,
	})

	url := cfg.AuthCodeURL(state,
		oauth2.S256ChallengeOption(verifier),
		oidc.Nonce(nonce),
		oauth2.SetAuthURLParam("prompt", "select_account"),
	)
	http.Redirect(w, r, url, http.StatusFound)
}

// ── GET /auth/google/callback ────────────────────────────────────────────────

func (s *Service) GoogleCallback(w http.ResponseWriter, r *http.Request) {
	// Always clear the binding cookie: state is single-use either way.
	http.SetCookie(w, &http.Cookie{
		Name: oauthCookie, Value: "", Path: oauthCookiePath, MaxAge: -1,
		HttpOnly: true, Secure: s.Google != nil && s.Google.secureCookie, SameSite: http.SameSiteLaxMode,
	})
	fail := func(reason string, err error) {
		if err != nil {
			log.Printf("auth/google: callback rejected (%s): %v", reason, err)
		} else {
			log.Printf("auth/google: callback rejected (%s)", reason)
		}
		http.Redirect(w, r, s.PublicBaseURL+"/#/login/done?error=google", http.StatusFound)
	}
	if s.Google == nil {
		fail("not configured", nil)
		return
	}
	q := r.URL.Query()
	if e := q.Get("error"); e != "" {
		fail("provider error "+e, nil)
		return
	}
	state, code := q.Get("state"), q.Get("code")
	if state == "" || code == "" {
		fail("missing state or code", nil)
		return
	}
	cookie, err := r.Cookie(oauthCookie)
	if err != nil || subtle.ConstantTimeCompare([]byte(cookie.Value), []byte(state)) != 1 {
		fail("state not bound to this browser", nil)
		return
	}

	ctx := r.Context()
	raw, err := s.Redis.GetDel(ctx, oauthStateKey(state)).Bytes()
	if errors.Is(err, redis.Nil) {
		fail("unknown or reused state", nil)
		return
	}
	if err != nil {
		fail("state lookup", err)
		return
	}
	var st oauthState
	if err := json.Unmarshal(raw, &st); err != nil {
		fail("state decode", err)
		return
	}

	cfg, verifier, err := s.Google.provider(ctx)
	if err != nil {
		fail("discovery", err)
		return
	}
	tok, err := cfg.Exchange(ctx, code, oauth2.VerifierOption(st.Verifier))
	if err != nil {
		fail("code exchange", err)
		return
	}
	rawID, ok := tok.Extra("id_token").(string)
	if !ok || rawID == "" {
		fail("no id_token", nil)
		return
	}
	idt, err := verifier.Verify(ctx, rawID)
	if err != nil {
		// The error text can quote the expected audience (the client id), so
		// only its category is logged.
		var expired *oidc.TokenExpiredError
		if errors.As(err, &expired) {
			fail("id_token expired", nil)
		} else {
			fail("id_token signature/iss/aud invalid", nil)
		}
		return
	}
	if subtle.ConstantTimeCompare([]byte(idt.Nonce), []byte(st.Nonce)) != 1 {
		fail("nonce mismatch", nil)
		return
	}
	var claims struct {
		Email         string `json:"email"`
		EmailVerified bool   `json:"email_verified"`
	}
	if err := idt.Claims(&claims); err != nil {
		fail("claims decode", err)
		return
	}
	email := accounts.NormalizeEmail(claims.Email)
	if !claims.EmailVerified || !validEmail(email) {
		fail("email not verified", nil)
		return
	}
	// tok (Google's access/id tokens) goes out of scope here: never stored.

	login := accounts.Login{Provider: "google", Subject: idt.Subject, Email: email, Lang: st.Lang}
	payload, _ := json.Marshal(login)
	loginCode := randomToken()
	if err := s.Redis.Set(ctx, loginCodeKey(loginCode), payload, loginCodeTTL).Err(); err != nil {
		fail("store login code", err)
		return
	}
	log.Printf("auth/google: verified email=%s, code issued", mask.Email(email))
	http.Redirect(w, r, s.PublicBaseURL+"/#/login/done?code="+loginCode, http.StatusFound)
}
