package main

import (
	"context"
	"fmt"
	"os"
	"time"

	"nexo/gateway/internal/config"
	"nexo/gateway/internal/mail"
	"nexo/gateway/internal/mask"
)

// mailTest sends one test email with the gateway's own SMTP settings
// (`gateway mail-test [to]`, run by `make mail-test` inside the running
// container). The recipient defaults to MAIL_TEST_TO, then OWNER_EMAIL.
// Nothing secret is printed: no password, recipient masked.
func mailTest(args []string) int {
	cfg := config.Load()
	to := os.Getenv("MAIL_TEST_TO")
	if len(args) > 0 && args[0] != "" {
		to = args[0]
	}
	if to == "" {
		to = cfg.OwnerEmail
	}
	if cfg.SMTPHost == "" {
		fmt.Fprintln(os.Stderr, "mail-test: SMTP_HOST is not set")
		return 1
	}
	if to == "" {
		fmt.Fprintln(os.Stderr, "mail-test: no recipient (make mail-test TO=you@example.com, or set OWNER_EMAIL)")
		return 1
	}
	fmt.Printf("mail-test: host=%s port=%d tls=%s auth=%t from=%q to=%s\n",
		cfg.SMTPHost, cfg.SMTPPort, cfg.SMTPTLS, cfg.SMTPUser != "", cfg.MailFrom, mask.Email(to))
	m, err := mail.NewSMTP(cfg.SMTPHost, cfg.SMTPPort, cfg.SMTPUser, cfg.SMTPPass, cfg.SMTPTLS, cfg.MailFrom)
	if err != nil {
		fmt.Fprintf(os.Stderr, "mail-test: %v\n", err)
		return 1
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	now := time.Now().UTC().Format(time.RFC3339)
	err = m.Send(ctx, mail.Message{
		To:      to,
		Subject: "Nexo · correo de prueba",
		Text: "Correo de prueba del gateway de Nexo (make mail-test), enviado " + now + ".\n" +
			"Si lo lees, el SMTP de producción funciona.\n",
	})
	if err != nil {
		fmt.Fprintf(os.Stderr, "mail-test: send failed: %v\n", err)
		return 1
	}
	fmt.Println("mail-test: sent OK — check the inbox (and spam)")
	return 0
}
