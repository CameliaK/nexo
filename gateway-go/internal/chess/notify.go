package chess

import (
	"context"
	"encoding/json"
	"log"
	"time"

	"github.com/redis/go-redis/v9"

	"nexo/gateway/internal/accounts"
	"nexo/gateway/internal/mail"
	"nexo/gateway/internal/mask"
	"nexo/gateway/internal/presence"
)

// Notifier emails the player when the owner moves or resigns, but only if
// the player has no socket open (they will see chess.move live otherwise),
// chess_email is on, and the game is out of its cooldown. The cooldown is set
// only after a successful send, so a failed send does not silence the next.
type Notifier struct {
	Redis          *redis.Client
	Accounts       *accounts.Store
	Presence       *presence.Store
	Mailer         mail.Mailer // nil → no email (SMTP not configured)
	Cooldown       time.Duration
	PublicBaseURL  string
	UnsubscribeURL func(accountID string) string
}

// ownerReply is the agent's answer to an owner action: the game plus, for
// the gateway only, who plays it.
type ownerReply struct {
	Game struct {
		ID     string `json:"id"`
		Status string `json:"status"`
		Moves  []struct {
			SAN string `json:"san"`
			By  string `json:"by"`
		} `json:"moves"`
	} `json:"game"`
	Player struct {
		AccountID string `json:"account_id"`
		VisitorID string `json:"visitor_id"`
	} `json:"player"`
}

func cooldownKey(gameID string) string { return "chess:email:" + gameID }
func sendingKey(gameID string) string  { return "chess:email-sending:" + gameID }

// ownerActed returns the after-hook for an owner move (resigned=false) or
// resignation (resigned=true).
func (h *Handler) ownerActed(resigned bool) func(context.Context, *run, agentReply) {
	return func(ctx context.Context, rn *run, rep agentReply) {
		if h.Notifier == nil {
			return
		}
		var out ownerReply
		if err := json.Unmarshal(rep.body, &out); err != nil || out.Player.AccountID == "" {
			log.Printf("chess: owner reply without player (%v)", err)
			return
		}
		h.Notifier.ownerActed(ctx, rn, out, resigned)
	}
}

func (n *Notifier) ownerActed(ctx context.Context, rn *run, out ownerReply, resigned bool) {
	game, player := out.Game, out.Player

	t0 := time.Now()
	rn.hopStart(ctx, "g2", "gateway", "redis", "Presencia del jugador")
	online, err := n.Presence.Online(ctx, player.VisitorID)
	if err != nil {
		log.Printf("chess: %v", err)
		rn.hopError(ctx, "g2", "gateway", "redis", "presence unavailable")
		return
	}
	rn.hopEnd(ctx, "g2", "gateway", "redis", t0)
	if online {
		log.Printf("chess: email skipped game=%s: player online", mask.ID(game.ID))
		return
	}
	if n.Mailer == nil {
		return
	}

	t0 = time.Now()
	rn.hopStart(ctx, "g3", "gateway", "postgres", "Preferencias del jugador")
	acc, err := n.Accounts.Get(ctx, player.AccountID)
	if err != nil {
		log.Printf("chess: account=%s: %v", mask.ID(player.AccountID), err)
		rn.hopError(ctx, "g3", "gateway", "postgres", "account unavailable")
		return
	}
	rn.hopEnd(ctx, "g3", "gateway", "postgres", t0)
	if !acc.ChessEmail {
		log.Printf("chess: email skipped game=%s: chess_email off", mask.ID(game.ID))
		return
	}
	if n.Redis.Exists(ctx, cooldownKey(game.ID)).Val() > 0 {
		log.Printf("chess: email skipped game=%s: cooldown", mask.ID(game.ID))
		return
	}
	// Two owner moves in a row must not both send: one sender at a time.
	if ok, err := n.Redis.SetNX(ctx, sendingKey(game.ID), 1, time.Minute).Result(); err != nil || !ok {
		log.Printf("chess: email skipped game=%s: already sending", mask.ID(game.ID))
		return
	}

	notice := mail.ChessNotice{Status: game.Status, Link: n.PublicBaseURL + "/", Unsubscribe: n.UnsubscribeURL(acc.ID)}
	if !resigned && len(game.Moves) > 0 {
		notice.SAN = game.Moves[len(game.Moves)-1].SAN
	}
	msg := mail.ChessEmail(acc.Email, acc.Lang, notice)
	go n.send(game.ID, acc, msg)
}

func (n *Notifier) send(gameID string, acc *accounts.Account, msg mail.Message) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	defer n.Redis.Del(ctx, sendingKey(gameID))
	if err := n.Mailer.Send(ctx, msg); err != nil {
		log.Printf("chess: email to %s game=%s failed: %v", mask.Email(acc.Email), mask.ID(gameID), err)
		return
	}
	if err := n.Redis.Set(ctx, cooldownKey(gameID), 1, n.Cooldown).Err(); err != nil {
		log.Printf("chess: cooldown game=%s: %v", mask.ID(gameID), err)
	}
	log.Printf("chess: email sent to %s game=%s lang=%s", mask.Email(acc.Email), mask.ID(gameID), acc.Lang)
}
