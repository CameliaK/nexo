package mail

import (
	"context"
	"fmt"
	"time"

	gomail "github.com/wneessen/go-mail"
)

// SMTP fails closed: "starttls" requires STARTTLS (TLSMandatory, never falls
// back to plaintext), "ssl" uses implicit TLS, and "none" — meant only for
// mailpit in docker-compose.override.yml — is refused when credentials are
// configured, so they can never travel in clear text.
type SMTP struct {
	host string
	from string
	opts []gomail.Option
}

func NewSMTP(host string, port int, user, pass, tlsMode, from string) (*SMTP, error) {
	if from == "" {
		return nil, fmt.Errorf("MAIL_FROM is required when SMTP_HOST is set")
	}
	opts := []gomail.Option{gomail.WithPort(port), gomail.WithTimeout(15 * time.Second)}
	switch tlsMode {
	case "starttls":
		opts = append(opts, gomail.WithTLSPolicy(gomail.TLSMandatory))
	case "ssl":
		opts = append(opts, gomail.WithSSL())
	case "none":
		if user != "" || pass != "" {
			return nil, fmt.Errorf("SMTP_TLS=none refused: SMTP credentials would travel in plain text")
		}
		opts = append(opts, gomail.WithTLSPolicy(gomail.NoTLS))
	default:
		return nil, fmt.Errorf("SMTP_TLS must be starttls, ssl or none (got %q)", tlsMode)
	}
	if user != "" {
		opts = append(opts,
			gomail.WithSMTPAuth(gomail.SMTPAuthAutoDiscover),
			gomail.WithUsername(user),
			gomail.WithPassword(pass))
	}
	// Validate the options once at startup.
	if _, err := gomail.NewClient(host, opts...); err != nil {
		return nil, fmt.Errorf("smtp client: %w", err)
	}
	return &SMTP{host: host, from: from, opts: opts}, nil
}

// Send dials a fresh client per message: go-mail clients hold one connection
// and are not meant to be shared between goroutines.
func (s *SMTP) Send(ctx context.Context, m Message) error {
	msg := gomail.NewMsg()
	if err := msg.From(s.from); err != nil {
		return fmt.Errorf("from: %w", err)
	}
	if err := msg.To(m.To); err != nil {
		return fmt.Errorf("to: %w", err)
	}
	msg.Subject(m.Subject)
	msg.SetBodyString(gomail.TypeTextPlain, m.Text)
	if m.HTML != "" {
		msg.AddAlternativeString(gomail.TypeTextHTML, m.HTML)
	}
	client, err := gomail.NewClient(s.host, s.opts...)
	if err != nil {
		return err
	}
	return client.DialAndSendWithContext(ctx, msg)
}
