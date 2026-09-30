package auth

import (
	"fmt"
	"log"
	"time"

	paseto "aidanwoods.dev/go-paseto"
)

// TokenService issues and verifies PASETO v4 local tokens.
// The symmetric key is loaded from PASETO_LOCAL_KEY (hex). If empty,
// an ephemeral key is generated and logged — restart-safe only in dev.
type TokenService struct {
	key    paseto.V4SymmetricKey
	expiry time.Duration
}

func NewTokenService(hexKey string, expiry time.Duration) (*TokenService, error) {
	var key paseto.V4SymmetricKey
	if hexKey == "" {
		key = paseto.NewV4SymmetricKey()
		log.Printf("WARNING: PASETO_LOCAL_KEY not set — ephemeral key in use")
		log.Printf("Set PASETO_LOCAL_KEY=%s to survive restarts", key.ExportHex())
	} else {
		var err error
		key, err = paseto.V4SymmetricKeyFromHex(hexKey)
		if err != nil {
			return nil, fmt.Errorf("invalid PASETO_LOCAL_KEY: %w", err)
		}
	}
	return &TokenService{key: key, expiry: expiry}, nil
}

func (s *TokenService) Issue(visitorID string) string {
	now := time.Now()
	t := paseto.NewToken()
	t.SetString("visitor_id", visitorID)
	t.SetIssuedAt(now)
	t.SetNotBefore(now)
	t.SetExpiration(now.Add(s.expiry))
	return t.V4Encrypt(s.key, nil)
}

// Verify decrypts the token and returns the visitor_id.
// NewParser() validates expiration by default; NewParserWithoutExpiryCheck() skips it.
func (s *TokenService) Verify(tokenStr string) (string, error) {
	parser := paseto.NewParser()
	t, err := parser.ParseV4Local(s.key, tokenStr, nil)
	if err != nil {
		return "", fmt.Errorf("invalid token: %w", err)
	}
	visitorID, err := t.GetString("visitor_id")
	if err != nil {
		return "", fmt.Errorf("token missing visitor_id: %w", err)
	}
	return visitorID, nil
}
