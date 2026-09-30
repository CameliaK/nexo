package config

import (
	"os"
	"time"
)

type Config struct {
	Port        string
	RedisURL    string
	PasetoKey   string
	TokenExpiry time.Duration
}

func Load() *Config {
	expiry := 24 * time.Hour
	if v := os.Getenv("TOKEN_EXPIRY"); v != "" {
		if d, err := time.ParseDuration(v); err == nil {
			expiry = d
		}
	}
	return &Config{
		Port:        getenv("GATEWAY_PORT", "8080"),
		RedisURL:    getenv("REDIS_URL", "redis://localhost:6379"),
		PasetoKey:   os.Getenv("PASETO_LOCAL_KEY"),
		TokenExpiry: expiry,
	}
}

func getenv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
