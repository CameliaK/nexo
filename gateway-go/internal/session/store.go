package session

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/redis/go-redis/v9"
)

const sessionTTL = 30 * 24 * time.Hour

type Store struct {
	rdb *redis.Client
}

func NewStore(rdb *redis.Client) *Store {
	return &Store{rdb: rdb}
}

type sessionData struct {
	VisitorID string    `json:"visitor_id"`
	CreatedAt time.Time `json:"created_at"`
	LastSeen  time.Time `json:"last_seen"`
}

// Touch creates a new session or updates last_seen on an existing one.
func (s *Store) Touch(ctx context.Context, visitorID string) error {
	key := "session:" + visitorID

	raw, err := s.rdb.Get(ctx, key).Bytes()
	var d sessionData
	switch {
	case err == redis.Nil:
		d = sessionData{VisitorID: visitorID, CreatedAt: time.Now(), LastSeen: time.Now()}
	case err != nil:
		return fmt.Errorf("redis get session: %w", err)
	default:
		if err := json.Unmarshal(raw, &d); err != nil {
			return fmt.Errorf("unmarshal session: %w", err)
		}
		d.LastSeen = time.Now()
	}

	b, _ := json.Marshal(d)
	return s.rdb.Set(ctx, key, b, sessionTTL).Err()
}
