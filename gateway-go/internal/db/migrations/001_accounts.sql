-- Cuentas con correo verificado. Un proveedor nuevo (GitHub, etc.) solo
-- agrega filas en identities con otro valor de provider: no hay enum que migrar.
CREATE TABLE accounts (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email       TEXT NOT NULL UNIQUE CHECK (email = lower(btrim(email))),
  lang        TEXT NOT NULL DEFAULT 'es' CHECK (lang IN ('es', 'en')),
  chess_email BOOLEAN NOT NULL DEFAULT true,
  visitor_id  TEXT NOT NULL UNIQUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE identities (
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  provider   TEXT NOT NULL,
  subject    TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (provider, subject)
);
CREATE INDEX identities_account_idx ON identities (account_id);

-- Partidas del ajedrez oculto (ChessGame del contrato). Vacía hasta la fase
-- de ajedrez; existe ya para que DELETE /api/v1/account la cubra en cascada.
-- color es el lado del jugador en notación FEN ('w' | 'b').
CREATE TABLE chess_games (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  tag        TEXT NOT NULL,
  color      TEXT NOT NULL CHECK (color IN ('w', 'b')),
  fen        TEXT NOT NULL,
  moves      JSONB NOT NULL DEFAULT '[]',
  turn       TEXT NOT NULL CHECK (turn IN ('player', 'owner')),
  status     TEXT NOT NULL CHECK (status IN ('active', 'checkmate', 'stalemate', 'draw', 'resigned')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX chess_games_account_idx ON chess_games (account_id);
CREATE UNIQUE INDEX chess_games_one_active ON chess_games (account_id) WHERE status = 'active';
