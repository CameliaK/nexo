// Package presence records which visitors have a WebSocket open. One sorted
// set per visitor (presence:{visitor_id}): one member per connection, scored
// with the time (unix ms) at which that entry expires. The WS handler
// refreshes its entry on every ping and removes it on close; a connection
// that dies without closing (gateway crash, lost network) simply expires,
// because Online purges expired members before counting.
package presence

import (
	"context"
	"fmt"
	"strconv"
	"time"

	"github.com/redis/go-redis/v9"

	"nexo/gateway/internal/mask"
)

type Store struct {
	rdb *redis.Client
	ttl time.Duration
}

// New: ttl is how long one refresh keeps a connection present; it must
// exceed the WS ping interval.
func New(rdb *redis.Client, ttl time.Duration) *Store {
	return &Store{rdb: rdb, ttl: ttl}
}

func key(visitorID string) string { return "presence:" + visitorID }

// Touch marks connID present until now+ttl.
func (s *Store) Touch(ctx context.Context, visitorID, connID string) error {
	k := key(visitorID)
	_, err := s.rdb.TxPipelined(ctx, func(p redis.Pipeliner) error {
		p.ZAdd(ctx, k, redis.Z{Score: float64(time.Now().Add(s.ttl).UnixMilli()), Member: connID})
		p.Expire(ctx, k, s.ttl) // the whole set goes once every member is stale
		return nil
	})
	return err
}

// Leave removes connID (socket closed).
func (s *Store) Leave(ctx context.Context, visitorID, connID string) error {
	return s.rdb.ZRem(ctx, key(visitorID), connID).Err()
}

// Online purges expired connections, then reports whether any is left.
func (s *Store) Online(ctx context.Context, visitorID string) (bool, error) {
	k := key(visitorID)
	var card *redis.IntCmd
	_, err := s.rdb.TxPipelined(ctx, func(p redis.Pipeliner) error {
		p.ZRemRangeByScore(ctx, k, "-inf", "("+strconv.FormatInt(time.Now().UnixMilli(), 10))
		card = p.ZCard(ctx, k)
		return nil
	})
	if err != nil {
		return false, fmt.Errorf("presence %s: %w", mask.ID(visitorID), err)
	}
	return card.Val() > 0, nil
}
