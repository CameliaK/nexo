package ws

import (
	"context"
	"log"
	"net/http"
	"time"

	"github.com/gorilla/websocket"
	"github.com/redis/go-redis/v9"

	"nexo/gateway/internal/accounts"
	"nexo/gateway/internal/auth"
	"nexo/gateway/internal/mask"
	"nexo/gateway/internal/presence"
)

const (
	pingInterval  = 30 * time.Second
	writeDeadline = 10 * time.Second
	readDeadline  = pingInterval + 10*time.Second
	ownerChannel  = "events:owner"
	// A presence entry outlives one missed ping, never a dead connection
	// for long: it is refreshed on every ping and purged once expired.
	PresenceTTL = 2*pingInterval + 15*time.Second
)

var upgrader = websocket.Upgrader{
	// Dev: accept all origins. Phase 6 will restrict to the prod domain.
	CheckOrigin: func(*http.Request) bool { return true },
}

type handler struct {
	tokens   *auth.TokenService
	rdb      *redis.Client
	presence *presence.Store
}

func NewHandler(tokens *auth.TokenService, rdb *redis.Client, presence *presence.Store) http.HandlerFunc {
	h := &handler{tokens: tokens, rdb: rdb, presence: presence}
	return h.serveHTTP
}

func (h *handler) serveHTTP(w http.ResponseWriter, r *http.Request) {
	tokenStr := r.URL.Query().Get("token")
	if tokenStr == "" {
		http.Error(w, "missing token", http.StatusUnauthorized)
		return
	}

	claims, err := h.tokens.VerifyClaims(r.Context(), tokenStr)
	if err != nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	visitorID := claims.VisitorID

	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("ws upgrade visitor=%s: %v", mask.ID(visitorID), err)
		return
	}
	defer conn.Close()

	// Pong resets the read deadline; if no pong arrives within readDeadline
	// after a ping, conn.ReadMessage returns an error and we clean up.
	conn.SetReadDeadline(time.Now().Add(readDeadline))
	conn.SetPongHandler(func(string) error {
		conn.SetReadDeadline(time.Now().Add(readDeadline))
		return nil
	})

	// Each connection subscribes ONLY to its visitor's channel.
	// Publishing to events:{other_visitor_id} never reaches this connection.
	// Owner connections — mode read from the validated token, nothing else —
	// also get events:owner; a player's socket never subscribes to it.
	channels := []string{"events:" + visitorID}
	if claims.Mode == auth.ModeOwner {
		channels = append(channels, ownerChannel)
	}
	pubsub := h.rdb.Subscribe(context.Background(), channels...)
	defer pubsub.Close()

	redisCh := pubsub.Channel()
	pingTicker := time.NewTicker(pingInterval)
	defer pingTicker.Stop()

	// Read pump: keeps the read path drained so gorilla detects close frames
	// and pong responses. Signals connClosed when the client disconnects.
	connClosed := make(chan struct{})
	go func() {
		defer close(connClosed)
		for {
			if _, _, err := conn.ReadMessage(); err != nil {
				return
			}
		}
	}()

	log.Printf("ws open visitor=%s mode=%s", mask.ID(visitorID), claims.Mode)
	defer log.Printf("ws close visitor=%s", mask.ID(visitorID))

	// Presence: the chess email notice is only sent to players with no
	// socket open.
	connID := accounts.NewUUID()
	h.touch(visitorID, connID)
	defer func() {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if err := h.presence.Leave(ctx, visitorID, connID); err != nil {
			log.Printf("ws presence leave visitor=%s: %v", mask.ID(visitorID), err)
		}
	}()

	for {
		select {
		case msg, ok := <-redisCh:
			if !ok {
				return
			}
			conn.SetWriteDeadline(time.Now().Add(writeDeadline))
			if err := conn.WriteMessage(websocket.TextMessage, []byte(msg.Payload)); err != nil {
				return
			}

		case <-pingTicker.C:
			conn.SetWriteDeadline(time.Now().Add(writeDeadline))
			if err := conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
			h.touch(visitorID, connID)

		case <-connClosed:
			return
		}
	}
}

func (h *handler) touch(visitorID, connID string) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := h.presence.Touch(ctx, visitorID, connID); err != nil {
		log.Printf("ws presence visitor=%s: %v", mask.ID(visitorID), err)
	}
}
