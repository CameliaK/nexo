// Package mail sends transactional email. Handlers depend on the Mailer
// interface; SMTP is the only implementation (mailpit in dev).
package mail

import "context"

type Message struct {
	To      string
	Subject string
	Text    string
	HTML    string
}

type Mailer interface {
	Send(ctx context.Context, m Message) error
}
