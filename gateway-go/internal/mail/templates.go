package mail

import (
	"bytes"
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
