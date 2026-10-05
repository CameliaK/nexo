package main

import (
	"context"
	"log"
	"net/http"

	"github.com/redis/go-redis/v9"

	"nexo/gateway/internal/account"
	"nexo/gateway/internal/accounts"
	"nexo/gateway/internal/auth"
	"nexo/gateway/internal/chat"
	"nexo/gateway/internal/clientip"
	"nexo/gateway/internal/config"
	"nexo/gateway/internal/db"
	"nexo/gateway/internal/health"
	"nexo/gateway/internal/live"
	"nexo/gateway/internal/mail"
	"nexo/gateway/internal/mask"
	"nexo/gateway/internal/owner"
	"nexo/gateway/internal/ratelimit"
	"nexo/gateway/internal/session"
	"nexo/gateway/internal/ws"
)

func main() {
	cfg := config.Load()
	ctx := context.Background()

	opt, err := redis.ParseURL(cfg.RedisURL)
	if err != nil {
		log.Fatalf("invalid REDIS_URL: %v", err)
	}
	rdb := redis.NewClient(opt)

	pool, err := db.Open(ctx, cfg.PostgresURL)
	if err != nil {
		log.Fatalf("db: %v", err)
	}
	if err := db.Migrate(ctx, pool); err != nil {
		log.Fatalf("db migrate: %v", err)
	}

	tokens, err := auth.NewTokenService(cfg.PasetoKey, cfg.TokenExpiry, cfg.UserTokenTTL, cfg.OwnerTokenTTL, rdb)
	if err != nil {
		log.Fatalf("token service: %v", err)
	}

	sessions := session.NewStore(rdb)
	accountStore := accounts.NewStore(pool)
	limiter := ratelimit.New(rdb)
	ips, err := clientip.New(cfg.TrustedProxies)
	if err != nil {
		log.Fatalf("config: %v", err)
	}

	authSvc := &auth.Service{
		Tokens:             tokens,
		Redis:              rdb,
		Accounts:           accountStore,
		Sessions:           sessions,
		Limiter:            limiter,
		IPs:                ips,
		PublicBaseURL:      cfg.PublicBaseURL,
		OwnerEmail:         cfg.OwnerEmail,
		OwnerProviders:     cfg.OwnerProviders,
		AuthEmailPerHour:   cfg.AuthEmailPerHour,
		AuthEmailPerIPHour: cfg.AuthEmailPerIPHour,
	}
	if cfg.SMTPHost != "" {
		m, err := mail.NewSMTP(cfg.SMTPHost, cfg.SMTPPort, cfg.SMTPUser, cfg.SMTPPass, cfg.SMTPTLS, cfg.MailFrom)
		if err != nil {
			log.Fatalf("mail: %v", err)
		}
		authSvc.Mailer = m
		log.Printf("mail: smtp port=%d tls=%s auth=%t", cfg.SMTPPort, cfg.SMTPTLS, cfg.SMTPUser != "")
	} else {
		log.Printf("mail: SMTP_HOST not set — email sign-in disabled")
	}
	if cfg.GoogleClientID != "" && cfg.GoogleClientSecret != "" && cfg.GoogleRedirectURL != "" {
		authSvc.Google = auth.NewGoogle(cfg.GoogleClientID, cfg.GoogleClientSecret, cfg.GoogleRedirectURL, cfg.PublicBaseURL)
		log.Printf("auth: Google sign-in enabled")
	} else {
		log.Printf("auth: GOOGLE_* not set — Google sign-in disabled")
	}
	if cfg.OwnerEmail == "" {
		log.Printf("auth: OWNER_EMAIL not set — nobody can be owner")
	} else {
		log.Printf("auth: owner=%s via %v", mask.Email(cfg.OwnerEmail), cfg.OwnerProviders)
	}

	accountH := &account.Handler{Tokens: tokens, Accounts: accountStore, Redis: rdb}

	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", health.Handler)
	mux.HandleFunc("GET /auth/guest", auth.NewHandler(tokens, sessions, limiter, ips, cfg.AuthGuestPerIPHour))
	mux.HandleFunc("GET /ws", ws.NewHandler(tokens, rdb))
	mux.HandleFunc("POST /api/v1/chat", chat.NewHandler(tokens, rdb, cfg.AgentURL, chat.Limits{
		Limiter: limiter, IPs: ips,
		PerHour: cfg.ChatRatePerHour, PerIPHour: cfg.ChatRatePerIPHour, ActiveTTL: cfg.ChatActiveTTL,
	}))
	mux.HandleFunc("GET /api/v1/session/nodes", session.NewListNodesHandler(tokens.Verify, cfg.AgentURL))
	mux.HandleFunc("DELETE /api/v1/session/nodes/{id}", session.NewDeleteNodeHandler(tokens.Verify, cfg.AgentURL))

	liveH := live.NewHandler(tokens, rdb, cfg.AgentURL)
	mux.HandleFunc("POST /api/v1/live/messages", liveH.Post)
	mux.HandleFunc("GET /api/v1/live/messages", liveH.Get)

	// Accounts
	mux.HandleFunc("POST /auth/email/request", authSvc.EmailRequest)
	mux.HandleFunc("POST /auth/email/verify", authSvc.EmailVerify)
	mux.HandleFunc("GET /auth/google/login", authSvc.GoogleLogin)
	mux.HandleFunc("GET /auth/google/callback", authSvc.GoogleCallback)
	mux.HandleFunc("POST /auth/exchange", authSvc.Exchange)
	mux.HandleFunc("POST /auth/logout", tokens.RequireAuth(authSvc.Logout))
	mux.HandleFunc("POST /auth/unsubscribe", authSvc.Unsubscribe)
	mux.HandleFunc("GET /api/v1/auth/me", tokens.RequireAuth(authSvc.Me))
	mux.HandleFunc("GET /api/v1/account/notifications", tokens.RequireUser(accountH.GetNotifications))
	mux.HandleFunc("PUT /api/v1/account/notifications", tokens.RequireUser(accountH.PutNotifications))
	mux.HandleFunc("DELETE /api/v1/account", tokens.RequireUser(accountH.Delete))

	// Owner
	mux.HandleFunc("GET /api/v1/owner/ping", tokens.RequireOwner(owner.Ping))

	log.Printf("limits: chat %d/h per visitor, %d/h per IP, active TTL %s; guest %d/h per IP; trusted proxies %q",
		cfg.ChatRatePerHour, cfg.ChatRatePerIPHour, cfg.ChatActiveTTL, cfg.AuthGuestPerIPHour, cfg.TrustedProxies)
	log.Printf("gateway listening on :%s", cfg.Port)
	if err := http.ListenAndServe(":"+cfg.Port, mux); err != nil {
		log.Fatalf("server: %v", err)
	}
}
