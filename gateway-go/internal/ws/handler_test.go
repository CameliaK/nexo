package ws

import (
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
	"time"

	"github.com/redis/go-redis/v9"

	"nexo/gateway/internal/auth"
)

// testRedis needs a real Redis (TEST_REDIS_URL, e.g. redis://redis:6379/15);
// the test is skipped without one.
func testRedis(t *testing.T) *redis.Client {
	t.Helper()
	url := os.Getenv("TEST_REDIS_URL")
	if url == "" {
		t.Skip("TEST_REDIS_URL not set")
	}
	opt, err := redis.ParseURL(url)
	if err != nil {
		t.Fatal(err)
	}
	rdb := redis.NewClient(opt)
	if err := rdb.Ping(context.Background()).Err(); err != nil {
		t.Skipf("redis unreachable: %v", err)
	}
	t.Cleanup(func() { rdb.Close() })
	return rdb
}

func TestAuthenticate(t *testing.T) {
	rdb := testRedis(t)
	tokens, err := auth.NewTokenService("", time.Hour, time.Hour, time.Hour, rdb)
	if err != nil {
		t.Fatal(err)
	}
	h := &handler{tickets: NewTickets(rdb, tokens), rdb: rdb}
	token := tokens.Issue("11111111-2222-4333-8444-555555555555")
	claims, err := tokens.VerifyClaims(context.Background(), token)
	if err != nil {
		t.Fatal(err)
	}
	ticket, err := h.tickets.issue(context.Background(), claims)
	if err != nil {
		t.Fatal(err)
	}

	call := func(query string) (int, *auth.Claims) {
		w := httptest.NewRecorder()
		c, _ := h.authenticate(w, httptest.NewRequest(http.MethodGet, "/ws"+query, nil))
		return w.Code, c
	}

	// A valid session token in the URL is no longer accepted.
	if code, c := call("?token=" + token); code != http.StatusUnauthorized || c != nil {
		t.Fatalf("?token=: got %d, want 401", code)
	}
	if code, _ := call(""); code != http.StatusUnauthorized {
		t.Fatalf("no ticket: got %d, want 401", code)
	}
	if code, _ := call("?ticket=invented"); code != http.StatusUnauthorized {
		t.Fatalf("invented ticket: got %d, want 401", code)
	}
	// A ticket works once, and carries the visitor of the token behind it.
	if code, c := call("?ticket=" + ticket); code != http.StatusOK || c == nil || c.VisitorID != claims.VisitorID || c.Mode != auth.ModeGuest {
		t.Fatalf("ticket: got %d %+v", code, c)
	}
	if code, _ := call("?ticket=" + ticket); code != http.StatusUnauthorized {
		t.Fatalf("reused ticket: got %d, want 401", code)
	}
	// Even next to a valid ticket, ?token= plays no part.
	ticket2, _ := h.tickets.issue(context.Background(), claims)
	if code, c := call("?ticket=" + ticket2 + "&token=garbage"); code != http.StatusOK || c == nil {
		t.Fatalf("ticket+token: got %d", code)
	}
}
