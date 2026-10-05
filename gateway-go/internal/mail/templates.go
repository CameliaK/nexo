package mail

import (
	"bytes"
	"fmt"
	"html/template"
)

var loginHTML = template.Must(template.New("login").Parse(`<!doctype html>
<html lang="{{.Lang}}"><body style="font-family:system-ui,sans-serif;background:#0b0d12;color:#e8eaf0;padding:32px">
<div style="max-width:480px;margin:auto">
<h1 style="font-size:20px;font-weight:600">{{.Title}}</h1>
<p>{{.Intro}}</p>
<p><a href="{{.Link}}" style="display:inline-block;padding:12px 20px;background:#7aa2ff;color:#0b0d12;border-radius:8px;text-decoration:none;font-weight:600">{{.Button}}</a></p>
<p style="color:#9aa3b5;font-size:13px">{{.Expiry}}</p>
<p style="color:#9aa3b5;font-size:13px">{{.Ignore}}</p>
</div></body></html>`))

type loginCopy struct {
	Lang, Subject, Title, Intro, Button, Expiry, Ignore, Link string
}

var loginText = map[string]loginCopy{
	"es": {
		Subject: "Tu enlace para entrar a Nexo",
		Title:   "Entrar a Nexo",
		Intro:   "Usa este enlace para iniciar sesión en el portafolio de Kirbith.",
		Button:  "Entrar",
		Expiry:  "El enlace caduca en 15 minutos y solo funciona una vez.",
		Ignore:  "Si no lo pediste, ignora este correo: nadie puede entrar sin él.",
	},
	"en": {
		Subject: "Your Nexo sign-in link",
		Title:   "Sign in to Nexo",
		Intro:   "Use this link to sign in to Kirbith's portfolio.",
		Button:  "Sign in",
		Expiry:  "The link expires in 15 minutes and works only once.",
		Ignore:  "If you didn't request it, ignore this email: nobody can sign in without it.",
	},
}

// LoginEmail builds the magic-link email in Spanish or English.
func LoginEmail(to, lang, link string) Message {
	c, ok := loginText[lang]
	if !ok {
		lang, c = "es", loginText["es"]
	}
	c.Lang, c.Link = lang, link
	var html bytes.Buffer
	_ = loginHTML.Execute(&html, c)
	text := c.Title + "\n\n" + c.Intro + "\n\n" + link + "\n\n" + c.Expiry + "\n" + c.Ignore + "\n"
	return Message{To: to, Subject: c.Subject, Text: text, HTML: html.String()}
}

var chessHTML = template.Must(template.New("chess").Parse(`<!doctype html>
<html lang="{{.Lang}}"><body style="font-family:system-ui,sans-serif;background:#0b0d12;color:#e8eaf0;padding:32px">
<div style="max-width:480px;margin:auto">
<h1 style="font-size:20px;font-weight:600">{{.Title}}</h1>
<p style="font-size:18px">{{.Action}}</p>
<p>{{.State}}</p>
<p><a href="{{.Link}}" style="display:inline-block;padding:12px 20px;background:#7aa2ff;color:#0b0d12;border-radius:8px;text-decoration:none;font-weight:600">{{.Button}}</a></p>
<p style="color:#9aa3b5;font-size:13px">{{.Why}} <a href="{{.Unsubscribe}}" style="color:#9aa3b5">{{.Stop}}</a></p>
</div></body></html>`))

type chessCopy struct {
	Subject, Title, Moved, Resigned, Button, Why, Stop string
	States                                             map[string]string
}

var chessText = map[string]chessCopy{
	"es": {
		Subject:  "Kirbith respondió en tu partida de ajedrez",
		Title:    "Tu partida en Nexo",
		Moved:    "Kirbith jugó %s.",
		Resigned: "Kirbith abandonó la partida.",
		Button:   "Abrir la partida",
		Why:      "Te llega porque tienes activados los avisos de ajedrez.",
		Stop:     "Dejar de recibirlos",
		States: map[string]string{
			"active":    "Te toca mover.",
			"checkmate": "Jaque mate: la partida terminó.",
			"stalemate": "Rey ahogado: la partida terminó en tablas.",
			"draw":      "La partida terminó en tablas.",
			"resigned":  "Ganaste la partida.",
		},
	},
	"en": {
		Subject:  "Kirbith replied in your chess game",
		Title:    "Your game on Nexo",
		Moved:    "Kirbith played %s.",
		Resigned: "Kirbith resigned the game.",
		Button:   "Open the game",
		Why:      "You get this because chess notifications are on.",
		Stop:     "Stop receiving them",
		States: map[string]string{
			"active":    "It's your move.",
			"checkmate": "Checkmate: the game is over.",
			"stalemate": "Stalemate: the game ended in a draw.",
			"draw":      "The game ended in a draw.",
			"resigned":  "You won the game.",
		},
	},
}

// ChessNotice is what the owner just did in a player's game.
type ChessNotice struct {
	SAN         string // the owner's move; "" when the owner resigned
	Status      string // ChessGame.status after the owner acted
	Link        string // PUBLIC_BASE_URL
	Unsubscribe string // signed unsubscribe link
}

// ChessEmail builds the "owner moved" notice in Spanish or English.
func ChessEmail(to, lang string, n ChessNotice) Message {
	c, ok := chessText[lang]
	if !ok {
		lang, c = "es", chessText["es"]
	}
	action := c.Resigned
	if n.SAN != "" {
		action = fmt.Sprintf(c.Moved, n.SAN)
	}
	data := struct {
		Lang, Title, Action, State, Link, Button, Why, Stop, Unsubscribe string
	}{lang, c.Title, action, c.States[n.Status], n.Link, c.Button, c.Why, c.Stop, n.Unsubscribe}
	var html bytes.Buffer
	_ = chessHTML.Execute(&html, data)
	text := c.Title + "\n\n" + action + "\n" + data.State + "\n\n" + c.Button + ": " + n.Link +
		"\n\n" + c.Why + "\n" + c.Stop + ": " + n.Unsubscribe + "\n"
	return Message{To: to, Subject: c.Subject, Text: text, HTML: html.String()}
}
