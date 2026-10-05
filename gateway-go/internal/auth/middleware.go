package auth

import (
	"context"
	"net/http"

	"nexo/gateway/internal/httpx"
)

type claimsKey struct{}

// ClaimsFrom returns the claims stored by RequireAuth/RequireUser/RequireOwner.
func ClaimsFrom(ctx context.Context) *Claims {
	c, _ := ctx.Value(claimsKey{}).(*Claims)
	return c
}

// RequireAuth accepts any valid session token (guest, user or owner).
func (s *TokenService) RequireAuth(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tok := httpx.BearerToken(r)
		if tok == "" {
			httpx.WriteErr(w, http.StatusUnauthorized, "unauthorized", "missing Authorization header")
			return
		}
		c, err := s.VerifyClaims(r.Context(), tok)
		if err != nil {
			httpx.WriteErr(w, http.StatusUnauthorized, "unauthorized", "invalid token")
			return
		}
		next(w, r.WithContext(context.WithValue(r.Context(), claimsKey{}, c)))
	}
}

// RequireUser needs a signed-in account (user or owner). Guests get
// 401 login_required.
func (s *TokenService) RequireUser(next http.HandlerFunc) http.HandlerFunc {
	return s.RequireAuth(func(w http.ResponseWriter, r *http.Request) {
		if !ClaimsFrom(r.Context()).IsAccount() {
			httpx.WriteErr(w, http.StatusUnauthorized, "login_required", "sign in to continue")
			return
		}
		next(w, r)
	})
}

// RequireOwner needs mode "owner" in the validated token. Anyone else with a
// valid token gets 403 forbidden.
func (s *TokenService) RequireOwner(next http.HandlerFunc) http.HandlerFunc {
	return s.RequireAuth(func(w http.ResponseWriter, r *http.Request) {
		if ClaimsFrom(r.Context()).Mode != ModeOwner {
			httpx.WriteErr(w, http.StatusForbidden, "forbidden", "owner only")
			return
		}
		next(w, r)
	})
}
