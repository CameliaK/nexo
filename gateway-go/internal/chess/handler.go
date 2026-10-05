// Package chess serves the hidden-chess API. The rules live in the agent
// (python-chess); the gateway authenticates (mode read only from the
// validated token), applies the per-account move limit, proxies to
// agent:/internal/chess and opens one run (kind "chess") per action so the
// system window shows it.
//
// Player routes sit behind auth.RequireUser (guest → 401 login_required),
// owner routes behind auth.RequireOwner (anyone else → 403 forbidden).
package chess

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"log"
	"net/http"
	"net/url"
	"time"

	"github.com/redis/go-redis/v9"

	"nexo/gateway/internal/accounts"
	"nexo/gateway/internal/auth"
	"nexo/gateway/internal/httpx"
	"nexo/gateway/internal/mask"
	"nexo/gateway/internal/ratelimit"
)

var agentClient = &http.Client{Timeout: 15 * time.Second}

type Handler struct {
	Redis        *redis.Client
	Limiter      *ratelimit.Limiter
	AgentURL     string
	MovesPerHour int
}

// agentReply is the agent's answer: the status and the raw JSON body, which
// is either {game, player?} or the contract's {error: {code, message}}.
type agentReply struct {
	status int
	body   []byte
}

func (a agentReply) errorBody() (code, message string) {
	var e struct {
		Error struct{ Code, Message string } `json:"error"`
	}
	if json.Unmarshal(a.body, &e) != nil || e.Error.Code == "" {
		return "internal", "unexpected error"
	}
	return e.Error.Code, e.Error.Message
}

func (h *Handler) call(ctx context.Context, method, path string, body any) (agentReply, error) {
	var rdr io.Reader
	if body != nil {
		b, _ := json.Marshal(body)
		rdr = bytes.NewReader(b)
	}
	req, err := http.NewRequestWithContext(ctx, method, h.AgentURL+"/internal/chess"+path, rdr)
	if err != nil {
		return agentReply{}, err
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	resp, err := agentClient.Do(req)
	if err != nil {
		return agentReply{}, mask.URLErr(err)
	}
	defer resp.Body.Close()
	b, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	return agentReply{status: resp.StatusCode, body: b}, err
}

// proxyRead forwards a read (no run, nothing changes).
func (h *Handler) proxyRead(w http.ResponseWriter, r *http.Request, path string) {
	rep, err := h.call(r.Context(), http.MethodGet, path, nil)
	if err != nil {
		log.Printf("chess: agent unavailable: %v", err)
		httpx.WriteErr(w, http.StatusServiceUnavailable, "internal", "agent unavailable")
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(rep.status)
	_, _ = w.Write(rep.body)
}

// action runs one mutating request inside its own run. label names the
// gateway→agent hop; outcome is "delivered" (player acts) or "received"
// (owner acts). after, if set, runs on success before run.done.
func (h *Handler) action(w http.ResponseWriter, r *http.Request, rn *run, path, label, outcome string,
	body map[string]any, after func(ctx context.Context, rn *run, rep agentReply)) {
	ctx := r.Context()
	c := auth.ClaimsFrom(ctx)
	body["run_id"], body["visitor_id"] = rn.id, c.VisitorID

	t0 := time.Now()
	rn.hopStart(ctx, "g1", "gateway", "agent", label)
	rep, err := h.call(ctx, http.MethodPost, path, body)
	if err != nil {
		log.Printf("chess: agent unavailable: %v", err)
		rn.hopError(ctx, "g1", "gateway", "agent", "agent unavailable")
		rn.fail(ctx, "internal", "agent unavailable")
		httpx.WriteErr(w, http.StatusServiceUnavailable, "internal", "agent unavailable")
		return
	}
	if rep.status >= 300 {
		code, msg := rep.errorBody()
		rn.hopError(ctx, "g1", "gateway", "agent", msg)
		rn.fail(ctx, code, msg)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(rep.status)
		_, _ = w.Write(rep.body)
		return
	}
	rn.hopEnd(ctx, "g1", "gateway", "agent", t0)

	// The agent may add internal fields (player); the client only gets {game}.
	var out struct {
		Game json.RawMessage `json:"game"`
	}
	if err := json.Unmarshal(rep.body, &out); err != nil || len(out.Game) == 0 {
		log.Printf("chess: bad agent reply for %s: %v", path, err)
		rn.fail(ctx, "internal", "unexpected error")
		httpx.WriteErr(w, http.StatusBadGateway, "internal", "unexpected error")
		return
	}
	if after != nil {
		after(ctx, rn, rep)
	}
	rn.done(ctx, outcome)
	httpx.WriteJSON(w, http.StatusOK, map[string]json.RawMessage{"game": out.Game})
}

func (h *Handler) newRun(r *http.Request) *run {
	return startRun(r.Context(), h.Redis, auth.ClaimsFrom(r.Context()).VisitorID, accounts.NewUUID())
}

func decode(w http.ResponseWriter, r *http.Request, v any) bool {
	if err := httpx.DecodeJSON(w, r, v); err != nil {
		httpx.WriteErr(w, http.StatusBadRequest, "invalid_request", "invalid JSON body")
		return false
	}
	return true
}

// ── Player (RequireUser) ─────────────────────────────────────────────────────

// GET /api/v1/chess/game — the active game or, if none, the last finished one.
func (h *Handler) GetGame(w http.ResponseWriter, r *http.Request) {
	c := auth.ClaimsFrom(r.Context())
	h.proxyRead(w, r, "/game?account_id="+url.QueryEscape(c.AccountID))
}

// POST /api/v1/chess/game { color }
func (h *Handler) NewGame(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Color string `json:"color"`
	}
	if !decode(w, r, &body) {
		return
	}
	c := auth.ClaimsFrom(r.Context())
	h.action(w, r, h.newRun(r), "/game", "Nueva partida", "delivered",
		map[string]any{"account_id": c.AccountID, "color": body.Color}, nil)
}

// POST /api/v1/chess/game/move { uci }
func (h *Handler) Move(w http.ResponseWriter, r *http.Request) {
	var body struct {
		UCI string `json:"uci"`
	}
	if !decode(w, r, &body) {
		return
	}
	ctx := r.Context()
	c := auth.ClaimsFrom(ctx)
	rn := h.newRun(r)

	t0 := time.Now()
	rn.hopStart(ctx, "g0", "gateway", "redis", "Límite de jugadas")
	res, err := h.Limiter.Hit(ctx, "ratelimit:chess:moves:"+c.AccountID, h.MovesPerHour, time.Hour)
	if err != nil {
		log.Printf("chess: move limit account=%s: %v", mask.ID(c.AccountID), err)
		rn.hopError(ctx, "g0", "gateway", "redis", "limit unavailable")
		rn.fail(ctx, "internal", "unexpected error")
		httpx.WriteErr(w, http.StatusInternalServerError, "internal", "unexpected error")
		return
	}
	if !res.Allowed {
		rn.hopError(ctx, "g0", "gateway", "redis", "too many moves")
		rn.fail(ctx, "rate_limited", "too many moves, try again later")
		ratelimit.Reject(w, res, "too many moves, try again later")
		return
	}
	rn.hopEnd(ctx, "g0", "gateway", "redis", t0)

	h.action(w, r, rn, "/game/move", "Validando jugada", "delivered",
		map[string]any{"account_id": c.AccountID, "uci": body.UCI}, nil)
}

// POST /api/v1/chess/game/resign
func (h *Handler) Resign(w http.ResponseWriter, r *http.Request) {
	c := auth.ClaimsFrom(r.Context())
	h.action(w, r, h.newRun(r), "/game/resign", "Abandono", "delivered",
		map[string]any{"account_id": c.AccountID}, nil)
}

// ── Owner (RequireOwner) ─────────────────────────────────────────────────────

// GET /api/v1/owner/chess/games
func (h *Handler) OwnerGames(w http.ResponseWriter, r *http.Request) {
	h.proxyRead(w, r, "/owner/games")
}

// GET /api/v1/owner/chess/games/{id}
func (h *Handler) OwnerGame(w http.ResponseWriter, r *http.Request) {
	h.proxyRead(w, r, "/owner/games/"+url.PathEscape(r.PathValue("id")))
}

// POST /api/v1/owner/chess/games/{id}/move { uci }
func (h *Handler) OwnerMove(w http.ResponseWriter, r *http.Request) {
	var body struct {
		UCI string `json:"uci"`
	}
	if !decode(w, r, &body) {
		return
	}
	h.action(w, r, h.newRun(r), "/owner/games/"+url.PathEscape(r.PathValue("id"))+"/move",
		"Validando jugada", "received", map[string]any{"uci": body.UCI}, nil)
}

// POST /api/v1/owner/chess/games/{id}/resign
func (h *Handler) OwnerResign(w http.ResponseWriter, r *http.Request) {
	h.action(w, r, h.newRun(r), "/owner/games/"+url.PathEscape(r.PathValue("id"))+"/resign",
		"Abandono", "received", map[string]any{}, nil)
}
