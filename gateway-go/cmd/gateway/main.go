package main

import (
	"log"
	"net/http"

	"github.com/redis/go-redis/v9"

	"nexo/gateway/internal/auth"
	"nexo/gateway/internal/chat"
	"nexo/gateway/internal/config"
	"nexo/gateway/internal/health"
	"nexo/gateway/internal/live"
	"nexo/gateway/internal/session"
	"nexo/gateway/internal/ws"
)

func main() {
	cfg := config.Load()

	opt, err := redis.ParseURL(cfg.RedisURL)
	if err != nil {
		log.Fatalf("invalid REDIS_URL %q: %v", cfg.RedisURL, err)
	}
	rdb := redis.NewClient(opt)

	tokens, err := auth.NewTokenService(cfg.PasetoKey, cfg.TokenExpiry)
	if err != nil {
		log.Fatalf("token service: %v", err)
	}

	sessions := session.NewStore(rdb)

	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", health.Handler)
	mux.HandleFunc("GET /auth/guest", auth.NewHandler(tokens, sessions))
	mux.HandleFunc("GET /ws", ws.NewHandler(tokens, rdb))
	mux.HandleFunc("POST /api/v1/chat", chat.NewHandler(tokens, rdb, cfg.AgentURL))
	mux.HandleFunc("GET /api/v1/session/nodes", session.NewListNodesHandler(tokens.Verify, cfg.AgentURL))
	mux.HandleFunc("DELETE /api/v1/session/nodes/{id}", session.NewDeleteNodeHandler(tokens.Verify, cfg.AgentURL))

	liveH := live.NewHandler(tokens, rdb, cfg.AgentURL)
	mux.HandleFunc("POST /api/v1/live/messages", liveH.Post)
	mux.HandleFunc("GET /api/v1/live/messages", liveH.Get)

	log.Printf("gateway listening on :%s", cfg.Port)
	if err := http.ListenAndServe(":"+cfg.Port, mux); err != nil {
		log.Fatalf("server: %v", err)
	}
}
