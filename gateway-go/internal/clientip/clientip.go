// Package clientip finds the visitor's real IP for rate limiting.
//
// X-Forwarded-For is trusted only when the request comes from a trusted proxy
// (TRUSTED_PROXIES, default "traefik"). A request that reaches the gateway
// directly is keyed on its peer address and its forwarding headers are
// ignored. Traefik v2.11 without forwardedHeaders.trustedIPs replaces any
// client-sent X-Forwarded-For with the address it saw (verified with
// traefik/whoami); if a CDN is put in front and its ranges are trusted in
// both Traefik and TRUSTED_PROXIES, the header is walked from the right,
// skipping trusted hops, so the first untrusted address is the client.
package clientip

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"log"
	"net"
	"net/http"
	"strings"
	"sync"
	"time"
)

const refreshEvery = 60 * time.Second

type Resolver struct {
	hosts []string
	nets  []*net.IPNet

	mu        sync.Mutex
	hostIPs   []net.IP
	refreshed time.Time
	lookup    func(ctx context.Context, host string) ([]net.IP, error)

	// pepper keys the HMAC in Key. Random per process: the IP never reaches
	// Redis (nor its snapshots on disk); a restart only resets the windows.
	pepper []byte
}

// New parses a comma-separated list of hostnames (resolved through Docker's
// DNS and refreshed every minute, so a recreated Traefik container is
// followed) and CIDRs or single IPs.
func New(spec string) (*Resolver, error) {
	r := &Resolver{lookup: func(ctx context.Context, host string) ([]net.IP, error) {
		return net.DefaultResolver.LookupIP(ctx, "ip", host)
	}, pepper: make([]byte, 32)}
	if _, err := rand.Read(r.pepper); err != nil {
		return nil, err
	}
	for _, item := range strings.Split(spec, ",") {
		item = strings.TrimSpace(item)
		switch {
		case item == "":
		case strings.Contains(item, "/"):
			_, n, err := net.ParseCIDR(item)
			if err != nil {
				return nil, fmt.Errorf("TRUSTED_PROXIES: invalid CIDR %q", item)
			}
			r.nets = append(r.nets, n)
		case net.ParseIP(item) != nil:
			ip := net.ParseIP(item)
			bits := 128
			if ip.To4() != nil {
				ip, bits = ip.To4(), 32
			}
			r.nets = append(r.nets, &net.IPNet{IP: ip, Mask: net.CIDRMask(bits, bits)})
		default:
			r.hosts = append(r.hosts, item)
		}
	}
	return r, nil
}

// IP returns the client's address (see the package comment).
func (r *Resolver) IP(req *http.Request) net.IP {
	peer := parse(req.RemoteAddr)
	if peer == nil || !r.trusted(peer) {
		return peer
	}
	parts := strings.Split(req.Header.Get("X-Forwarded-For"), ",")
	for i := len(parts) - 1; i >= 0; i-- {
		ip := net.ParseIP(strings.TrimSpace(parts[i]))
		if ip == nil {
			break // malformed hop: keep the last address we can vouch for
		}
		if !r.trusted(ip) {
			return ip
		}
		peer = ip
	}
	return peer
}

// Key identifies the client in rate-limit keys: an HMAC of the normalized IP
// (IPv6 cut to its /64 prefix: one subscriber usually owns a whole /64 and
// could rotate addresses inside it), so Redis never stores the address.
func (r *Resolver) Key(req *http.Request) string {
	m := hmac.New(sha256.New, r.pepper)
	m.Write([]byte(Normalize(r.IP(req))))
	return hex.EncodeToString(m.Sum(nil)[:16])
}

func Normalize(ip net.IP) string {
	if ip == nil {
		return "unknown"
	}
	if v4 := ip.To4(); v4 != nil {
		return v4.String()
	}
	return ip.Mask(net.CIDRMask(64, 128)).String() + "/64"
}

func (r *Resolver) trusted(ip net.IP) bool {
	for _, n := range r.nets {
		if n.Contains(ip) {
			return true
		}
	}
	for _, h := range r.resolvedHosts() {
		if h.Equal(ip) {
			return true
		}
	}
	return false
}

func (r *Resolver) resolvedHosts() []net.IP {
	if len(r.hosts) == 0 {
		return nil
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if time.Since(r.refreshed) < refreshEvery {
		return r.hostIPs
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	var ips []net.IP
	for _, h := range r.hosts {
		found, err := r.lookup(ctx, h)
		if err != nil {
			log.Printf("clientip: resolve trusted proxy %q: %v", h, err)
			continue
		}
		ips = append(ips, found...)
	}
	// On a failed lookup keep the previous answer rather than distrusting
	// Traefik (which would key every visitor on Traefik's own IP).
	if len(ips) > 0 || r.hostIPs == nil {
		r.hostIPs = ips
	}
	r.refreshed = time.Now()
	return r.hostIPs
}

func parse(remoteAddr string) net.IP {
	host, _, err := net.SplitHostPort(remoteAddr)
	if err != nil {
		host = remoteAddr
	}
	return net.ParseIP(host)
}
