// Package mask produces log-safe forms of personal data and credentials.
// Nothing that identifies a person or authenticates a request is ever logged
// in full: correos → "k***@gmail.com", ids → first 8 chars + "…".
package mask

import (
	"errors"
	"fmt"
	"net/url"
	"strings"
)

// Email returns "k***@gmail.com" for "kirbith@gmail.com". It is also the
// email_hint shown to the account owner.
func Email(email string) string {
	at := strings.LastIndexByte(email, '@')
	if at < 1 || at == len(email)-1 {
		return "***"
	}
	return email[:1] + "***" + email[at:]
}

// ID returns the first 8 characters of a visitor/account id. The canonical
// visitor_id works as the guest credential, so it is never logged whole.
func ID(id string) string {
	if len(id) <= 8 {
		return id
	}
	return id[:8] + "…"
}

// URLErr drops the request URL from an *url.Error: proxied agent URLs carry
// ?visitor_id=… in full.
func URLErr(err error) error {
	var ue *url.Error
	if errors.As(err, &ue) {
		return fmt.Errorf("%s: %w", ue.Op, ue.Err)
	}
	return err
}
