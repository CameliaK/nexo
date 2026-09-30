package main

import (
	"log"
	"net/http"

	"github.com/redis/go-redis/v9"

	"nexo/gateway/internal/auth"
	"nexo/gateway/internal/config"
	"nexo/gateway/internal/health"
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

	log.Printf("gateway listening on :%s", cfg.Port)
	if err := http.ListenAndServe(":"+cfg.Port, mux); err != nil {
		log.Fatalf("server: %v", err)
	}
}
