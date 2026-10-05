// Package accounts persists verified-email accounts and their login
// identities (one row per provider+subject), and links logins to accounts.
package accounts

import (
	"context"
	"crypto/rand"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

var ErrNotFound = errors.New("account not found")

type Account struct {
	ID         string
	Email      string
	Lang       string
	ChessEmail bool
	VisitorID  string
	CreatedAt  time.Time
	LastSeen   time.Time
}

type Store struct {
	db *pgxpool.Pool
}

func NewStore(db *pgxpool.Pool) *Store {
	return &Store{db: db}
}

// NormalizeEmail is the only normalization applied: trim + lowercase.
// Gmail dots are kept, so two distinct mailboxes never merge.
func NormalizeEmail(email string) string {
	return strings.ToLower(strings.TrimSpace(email))
}

const accountCols = `a.id::text, a.email, a.lang, a.chess_email, a.visitor_id, a.created_at, a.last_seen`

func scan(row pgx.Row) (*Account, error) {
	var a Account
	err := row.Scan(&a.ID, &a.Email, &a.Lang, &a.ChessEmail, &a.VisitorID, &a.CreatedAt, &a.LastSeen)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return &a, err
}

// Login describes a verified login: the provider vouched for email.
type Login struct {
	Provider string // "email" | "google" | …
	Subject  string // normalized email for "email", sub for OIDC providers
	Email    string // normalized, verified
	Lang     string // "" keeps the stored preference
}

// Link resolves a verified login to an account, creating it on first login.
//
//  1. Known (provider, subject) → its account.
//  2. Account with the same verified email → add this identity to it, so
//     Google and the email link land on the same account.
//  3. New account. Its canonical visitor_id is anonVisitorID (the current
//     anonymous id, whose data then follows it), unless that id is empty or
//     already canonical for another account — then a fresh UUID, so data
//     from two ids is never mixed.
//
// created reports whether the account was created by this call.
func (s *Store) Link(ctx context.Context, l Login, anonVisitorID string) (acc *Account, created bool, err error) {
	// A concurrent first login for the same email/visitor_id hits a unique
	// violation; the retry then finds the row the other request created.
	for attempt := 0; attempt < 2; attempt++ {
		acc, created, err = s.link(ctx, l, anonVisitorID)
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23505" {
			continue
		}
		return acc, created, err
	}
	return acc, created, err
}

func (s *Store) link(ctx context.Context, l Login, anonVisitorID string) (*Account, bool, error) {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, false, err
	}
	defer tx.Rollback(ctx)

	acc, err := scan(tx.QueryRow(ctx, `
		SELECT `+accountCols+` FROM identities i JOIN accounts a ON a.id = i.account_id
		WHERE i.provider = $1 AND i.subject = $2 FOR UPDATE OF a`, l.Provider, l.Subject))
	if err != nil && !errors.Is(err, ErrNotFound) {
		return nil, false, err
	}

	if acc == nil {
		acc, err = scan(tx.QueryRow(ctx,
			`SELECT `+accountCols+` FROM accounts a WHERE a.email = $1 FOR UPDATE`, l.Email))
		if err != nil && !errors.Is(err, ErrNotFound) {
			return nil, false, err
		}
	}

	created := false
	if acc == nil {
		visitorID := anonVisitorID
		if visitorID != "" {
			var taken bool
			if err := tx.QueryRow(ctx,
				`SELECT EXISTS (SELECT 1 FROM accounts WHERE visitor_id = $1)`, visitorID,
			).Scan(&taken); err != nil {
				return nil, false, err
			}
			if taken {
				visitorID = ""
			}
		}
		if visitorID == "" {
			visitorID = NewUUID()
		}
		lang := l.Lang
		if lang == "" {
			lang = "es"
		}
		acc, err = scan(tx.QueryRow(ctx, `
			INSERT INTO accounts AS a (email, lang, visitor_id) VALUES ($1, $2, $3)
			RETURNING `+accountCols, l.Email, lang, visitorID))
		if err != nil {
			return nil, false, err
		}
		created = true
	}

	if _, err := tx.Exec(ctx, `
		INSERT INTO identities (account_id, provider, subject) VALUES ($1, $2, $3)
		ON CONFLICT (provider, subject) DO NOTHING`, acc.ID, l.Provider, l.Subject); err != nil {
		return nil, false, err
	}
	if !created && l.Lang != "" && l.Lang != acc.Lang {
		if _, err := tx.Exec(ctx, `UPDATE accounts SET lang = $2 WHERE id = $1`, acc.ID, l.Lang); err != nil {
			return nil, false, err
		}
		acc.Lang = l.Lang
	}
	if _, err := tx.Exec(ctx, `UPDATE accounts SET last_seen = now() WHERE id = $1`, acc.ID); err != nil {
		return nil, false, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, false, err
	}
	return acc, created, nil
}

func (s *Store) Get(ctx context.Context, id string) (*Account, error) {
	return scan(s.db.QueryRow(ctx, `SELECT `+accountCols+` FROM accounts a WHERE a.id = $1`, id))
}

// Touch records activity and returns the fresh account.
func (s *Store) Touch(ctx context.Context, id string) (*Account, error) {
	return scan(s.db.QueryRow(ctx,
		`UPDATE accounts AS a SET last_seen = now() WHERE a.id = $1 RETURNING `+accountCols, id))
}

func (s *Store) SetChessEmail(ctx context.Context, id string, on bool) (*Account, error) {
	return scan(s.db.QueryRow(ctx,
		`UPDATE accounts AS a SET chess_email = $2 WHERE a.id = $1 RETURNING `+accountCols, id, on))
}

// Delete removes the account and every row tied to it, in one transaction.
// identities and chess_games go by ON DELETE CASCADE; generated_nodes and
// live_messages (owned by the agent, keyed by visitor_id) are deleted
// explicitly. Returns the canonical visitor_id that was erased.
func (s *Store) Delete(ctx context.Context, id string) (string, error) {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return "", err
	}
	defer tx.Rollback(ctx)

	var visitorID string
	err = tx.QueryRow(ctx, `SELECT visitor_id FROM accounts WHERE id = $1 FOR UPDATE`, id).Scan(&visitorID)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", ErrNotFound
	}
	if err != nil {
		return "", err
	}

	for _, table := range []string{"generated_nodes", "live_messages"} {
		var exists bool
		if err := tx.QueryRow(ctx, `SELECT to_regclass($1) IS NOT NULL`, "public."+table).Scan(&exists); err != nil {
			return "", err
		}
		if !exists {
			continue // the agent has not created it yet: nothing to delete
		}
		if _, err := tx.Exec(ctx, fmt.Sprintf(`DELETE FROM %s WHERE visitor_id = $1`, table), visitorID); err != nil {
			return "", fmt.Errorf("delete %s: %w", table, err)
		}
	}
	if _, err := tx.Exec(ctx, `DELETE FROM accounts WHERE id = $1`, id); err != nil {
		return "", err
	}
	return visitorID, tx.Commit(ctx)
}

func NewUUID() string {
	b := make([]byte, 16)
	_, _ = rand.Read(b)
	b[6] = (b[6] & 0x0f) | 0x40
	b[8] = (b[8] & 0x3f) | 0x80
	return fmt.Sprintf("%08x-%04x-%04x-%04x-%012x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:16])
}
