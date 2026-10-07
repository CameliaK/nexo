package clientip

import (
	"context"
	"net"
	"net/http/httptest"
	"strings"
	"testing"
)

func resolver(t *testing.T, spec string) *Resolver {
	t.Helper()
	r, err := New(spec)
	if err != nil {
		t.Fatal(err)
	}
	r.lookup = func(context.Context, string) ([]net.IP, error) { return []net.IP{net.ParseIP("172.18.0.3")}, nil }
	return r
}

func TestIP(t *testing.T) {
	cases := []struct {
		name, spec, remote, xff, want string
	}{
		{"direct request ignores forged header", "traefik", "10.0.0.9:5000", "1.2.3.4", "10.0.0.9"},
		{"from traefik uses the address it saw", "traefik", "172.18.0.3:4000", "203.0.113.7", "203.0.113.7"},
		{"from traefik, walk right skipping trusted CDN hops", "traefik,198.51.100.0/24", "172.18.0.3:4000", "1.2.3.4, 203.0.113.7, 198.51.100.20", "203.0.113.7"},
		{"from traefik without header falls back to peer", "traefik", "172.18.0.3:4000", "", "172.18.0.3"},
		{"malformed hop stops the walk", "traefik", "172.18.0.3:4000", "203.0.113.7, garbage", "172.18.0.3"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			req := httptest.NewRequest("GET", "/", nil)
			req.RemoteAddr = c.remote
			if c.xff != "" {
				req.Header.Set("X-Forwarded-For", c.xff)
			}
			if got := resolver(t, c.spec).IP(req).String(); got != c.want {
				t.Fatalf("got %s, want %s", got, c.want)
			}
		})
	}
}

func TestNormalize(t *testing.T) {
	cases := map[string]string{
		"203.0.113.7":            "203.0.113.7",
		"::ffff:203.0.113.7":     "203.0.113.7",
		"2001:db8:aa:bb:1:2:3:4": "2001:db8:aa:bb::/64",
		"2001:db8:aa:bb:ffff::9": "2001:db8:aa:bb::/64",
	}
	for in, want := range cases {
		if got := Normalize(net.ParseIP(in)); got != want {
			t.Errorf("Normalize(%s) = %s, want %s", in, got, want)
		}
	}
}

func TestKeyHidesIP(t *testing.T) {
	r := resolver(t, "")
	key := func(remote string) string {
		req := httptest.NewRequest("GET", "/", nil)
		req.RemoteAddr = remote
		return r.Key(req)
	}
	a := key("203.0.113.7:1000")
	if strings.Contains(a, "203.0.113") || len(a) != 32 {
		t.Fatalf("key %q leaks the IP or has the wrong length", a)
	}
	if a != key("203.0.113.7:2000") {
		t.Error("same IP, different port: keys differ")
	}
	if a == key("203.0.113.8:1000") {
		t.Error("different IPs share a key")
	}
	if key("[2001:db8:aa:bb::1]:1") != key("[2001:db8:aa:bb::2]:1") {
		t.Error("same IPv6 /64: keys differ")
	}
	if other := resolver(t, ""); func() string {
		req := httptest.NewRequest("GET", "/", nil)
		req.RemoteAddr = "203.0.113.7:1000"
		return other.Key(req)
	}() == a {
		t.Error("two processes share the pepper")
	}
}
