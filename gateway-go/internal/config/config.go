package config

import (
	"log"
	"os"
	"strconv"
	"strings"
	"time"
)

type Config struct {
	Port        string
	RedisURL    string
	PostgresURL string
	PasetoKey   string
	TokenExpiry time.Duration // guest tokens
	AgentURL    string

	PublicBaseURL string

	// Accounts
	UserTokenTTL       time.Duration
	OwnerTokenTTL      time.Duration
	OwnerEmail         string   // normalized; empty → nobody is owner
	OwnerProviders     []string // providers allowed to grant owner mode
	AuthEmailPerHour   int
	AuthEmailPerIPHour int
	AuthGuestPerIPHour int

	// Agent chat limits (contract §12)
	ChatRatePerHour   int           // questions per visitor per hour
	ChatRatePerIPHour int           // questions per IP per hour
	ChatActiveTTL     time.Duration // safety TTL of the "one active query" mark
	TrustedProxies    string        // hosts/CIDRs whose X-Forwarded-For is trusted

	// Hidden chess
	ChessMovesPerHour  int           // player moves per account per hour
	ChessEmailCooldown time.Duration // at most one "owner moved" email per game per window

	// Mail
	SMTPHost string
	SMTPPort int
	SMTPUser string
	SMTPPass string
	SMTPTLS  string // starttls | ssl | none
	MailFrom string

	// Google
	GoogleClientID     string
	GoogleClientSecret string
	GoogleRedirectURL  string
}

func Load() *Config {
	return &Config{
		Port:        getenv("GATEWAY_PORT", "8080"),
		RedisURL:    getenv("REDIS_URL", "redis://localhost:6379"),
		PostgresURL: getenv("POSTGRES_URL", "postgresql://nexo:nexo@localhost:5432/nexo"),
		PasetoKey:   os.Getenv("PASETO_LOCAL_KEY"),
		TokenExpiry: duration("TOKEN_EXPIRY", 24*time.Hour),
		AgentURL:    getenv("AGENT_URL", "http://localhost:8000"),

		PublicBaseURL: strings.TrimRight(getenv("PUBLIC_BASE_URL", "http://localhost"), "/"),

		UserTokenTTL:       duration("USER_TOKEN_TTL", 168*time.Hour),
		OwnerTokenTTL:      duration("OWNER_TOKEN_TTL", 8*time.Hour),
		OwnerEmail:         strings.ToLower(strings.TrimSpace(os.Getenv("OWNER_EMAIL"))),
		OwnerProviders:     list(getenv("OWNER_PROVIDERS", "google")),
		AuthEmailPerHour:   integer("AUTH_EMAIL_PER_HOUR", 5),
		AuthEmailPerIPHour: integer("AUTH_EMAIL_PER_IP_HOUR", 20),
		AuthGuestPerIPHour: integer("AUTH_GUEST_PER_IP_HOUR", 60),

		ChatRatePerHour:   integer("CHAT_RATE_PER_HOUR", 20),
		ChatRatePerIPHour: integer("CHAT_RATE_PER_IP_HOUR", 60),
		ChatActiveTTL:     duration("CHAT_ACTIVE_TTL", 120*time.Second),
		TrustedProxies:    getenv("TRUSTED_PROXIES", "traefik"),

		ChessMovesPerHour:  integer("CHESS_MOVES_PER_HOUR", 30),
		ChessEmailCooldown: time.Duration(integer("CHESS_EMAIL_COOLDOWN_HOURS", 6)) * time.Hour,

		SMTPHost: os.Getenv("SMTP_HOST"),
		SMTPPort: integer("SMTP_PORT", 587),
		SMTPUser: os.Getenv("SMTP_USER"),
		SMTPPass: os.Getenv("SMTP_PASS"),
		SMTPTLS:  strings.ToLower(getenv("SMTP_TLS", "starttls")),
		MailFrom: os.Getenv("MAIL_FROM"),

		GoogleClientID:     os.Getenv("GOOGLE_CLIENT_ID"),
		GoogleClientSecret: os.Getenv("GOOGLE_CLIENT_SECRET"),
		GoogleRedirectURL:  os.Getenv("GOOGLE_REDIRECT_URL"),
	}
}

func getenv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func duration(key string, fallback time.Duration) time.Duration {
	v := os.Getenv(key)
	if v == "" {
		return fallback
	}
	d, err := time.ParseDuration(v)
	if err != nil || d <= 0 {
		log.Fatalf("config: invalid %s=%q", key, v)
	}
	return d
}

func integer(key string, fallback int) int {
	v := os.Getenv(key)
	if v == "" {
		return fallback
	}
	n, err := strconv.Atoi(v)
	if err != nil || n <= 0 {
		log.Fatalf("config: invalid %s=%q", key, v)
	}
	return n
}

func list(v string) []string {
	var out []string
	for _, p := range strings.Split(v, ",") {
		if p = strings.ToLower(strings.TrimSpace(p)); p != "" {
			out = append(out, p)
		}
	}
	return out
}
