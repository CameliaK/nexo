/**
 * Contrato v2 entre el frontend y el backend (Gateway Go + Agente FastAPI + n8n).
 *
 * Idea: el frontend depende SOLO de este archivo. Hay dos implementaciones de
 * `PortfolioBackend`: una simulada (MockBackend, solo para desarrollo) y una real
 * (RealBackend). Cambiar de una a otra es cambiar una variable de entorno.
 *
 * Descripción completa y ejemplos: contrato-backend.md
 */

export const CONTRACT_VERSION = 2 as const;

/** Límites que el backend garantiza y el frontend debe respetar al mostrar. */
export const LIMITS = {
  messageMaxChars: 500,
  liveMessageMaxChars: 500,
  liveNameMaxChars: 30,
  generatedNodesPerSession: 12,
  childrenPerNode: 4,
  labelMaxChars: 40,
  summaryMaxChars: 160,
  bodyMaxChars: 600,
  listMaxItems: 8,
  timelineMaxEntries: 8,
  tagsMaxItems: 12,
  metricsMaxItems: 6,
} as const;

/* ───────────────────────── Nodos generados ───────────────────────── */

/** Lista CERRADA de formas de mostrar el contenido. El agente solo puede elegir entre estas. */
export type GeneratedLayout = "text" | "list" | "timeline" | "tags" | "metrics";

export interface GeneratedSource {
  /** Nombre legible de la fuente (por ejemplo "CV" o "Infosys"). */
  title: string;
  /** Referencia opcional: id de un nodo del portafolio o una URL https. */
  ref?: string;
}

interface GeneratedNodeBase {
  /** Siempre empieza con "gen_". Nunca choca con los ids del portafolio. */
  id: string;
  label: string;
  tagline?: string;
  summary: string;
  sources: GeneratedSource[];
  /** Máximo LIMITS.childrenPerNode, sin nietos (los hijos no traen `children`). */
  children?: GeneratedNode[];
  generated: true;
  /** ISO 8601. */
  created_at: string;
}

export type GeneratedNode = GeneratedNodeBase &
  (
    | { layout: "text"; content: { body: string } }
    | { layout: "list"; content: { items: string[] } }
    | { layout: "timeline"; content: { entries: { when: string; what: string }[] } }
    | { layout: "tags"; content: { tags: string[] } }
    | { layout: "metrics"; content: { items: { label: string; value: string }[] } }
  );

/* ───────────────────────── Arquitectura del backend (backend-architecture.json) ───────────────────────── */

/** Id de un componente de backend-architecture.json. Es un string abierto para poder añadir más. */
export type ComponentId = string;

export type ComponentKind =
  | "client"
  | "edge"
  | "api"
  | "bus"
  | "service"
  | "orchestrator"
  | "ml"
  | "data"
  | "external";

export interface ArchComponent {
  id: ComponentId;
  label: string;
  tech: string;
  kind: ComponentKind;
  /** Columna sugerida al dibujar, de izquierda a derecha. */
  layer: number;
  /** "Qué es", para el diálogo al pasar el mouse. */
  what: string;
  /** "Mi aportación": opcional; se omite mientras sea null. */
  contribution: string | null;
}

export interface ArchEdge {
  id: string;
  from: ComponentId;
  to: ComponentId;
  kind: "request" | "event";
  label: string;
}

export interface ArchFlow {
  id: string;
  label: string;
  description: string;
  hops: [ComponentId, ComponentId][];
}

export interface BackendArchitecture {
  meta: { contract_version: number; notes: string[] };
  components: ArchComponent[];
  edges: ArchEdge[];
  flows: ArchFlow[];
}

/* ───────────────────────── Chat en vivo con el dueño ───────────────────────── */

export type LiveDeliveryStatus = "sent" | "delivered_to_owner" | "failed";

export interface LiveMessage {
  id: string;
  from: "visitor" | "owner";
  text: string;
  /** ISO 8601. */
  ts: string;
}

/* ───────────────────────── Eventos (WebSocket) ───────────────────────── */

export type ProcessStepId =
  | "understand" //   Entender la pregunta
  | "search_nodes" // Buscar en los nodos del portafolio
  | "search_base" //  Buscar en la base de conocimiento (RAG)
  | "design_node" //  Diseñar el nodo nuevo
  | "create_node" //  Crear el nodo
  | "answer"; //      Redactar la respuesta

export type ProcessStatus = "active" | "done" | "skipped";

/**
 * Qué originó la ejecución:
 *  - chat:     pregunta al agente.
 *  - live_out: el visitante escribe un mensaje al dueño.
 *  - live_in:  el dueño responde (llega al visitante sin que haga nada).
 *  - chess:    una acción de ajedrez; no requiere registrar run_id desde HTTP.
 */
export type RunKind = "chat" | "live_out" | "live_in" | "chess";

/** Cómo terminó la ejecución. */
export type RunOutcome = "route" | "generated" | "unknown" | "delivered" | "received";

export type ErrorCode =
  | "login_required"
  | "forbidden"
  | "not_your_turn"
  | "illegal_move"
  | "rate_limited"
  | "unauthorized"
  | "invalid_request"
  | "busy"
  | "llm_unavailable"
  | "internal";

export type TracePhase = "start" | "end" | "error";

export interface RagHit {
  title: string;
  /** Similitud entre 0 y 1. */
  score: number;
  source: string;
}

interface Envelope<T extends string, D> {
  v: typeof CONTRACT_VERSION;
  type: T;
  /** Identifica la ejecución; todos los eventos de una ejecución comparten run_id. */
  run_id: string;
  /** Contador que empieza en 1 dentro de cada run_id. Sirve para ordenar y descartar duplicados. */
  seq: number;
  /** ISO 8601. */
  ts: string;
  data: D;
}

export type RunStartEvent = Envelope<
  "run.start",
  {
    kind: RunKind;
    /** Pregunta o mensaje del visitante. No viene en las ejecuciones live_in. */
    input?: string;
    content_version: number;
  }
>;
export type ProcessStepEvent = Envelope<
  "process.step",
  { step: ProcessStepId; status: ProcessStatus; label?: string }
>;
/**
 * Un tramo del recorrido por la arquitectura del backend.
 * Cada tramo empieza con phase "start" y termina con "end" o "error" (mismo hop_id).
 * Se dibuja sobre la arista entre `from` y `to`, sin importar el sentido.
 */
export type TraceHopEvent = Envelope<
  "trace.hop",
  {
    hop_id: string;
    from: ComponentId;
    to: ComponentId;
    phase: TracePhase;
    /** Qué está haciendo este tramo, en lenguaje llano (en "start"). */
    label?: string;
    /** Resultado en pocas palabras (en "end" o "error"). */
    detail?: string;
    /** Solo en "end" o "error". */
    duration_ms?: number;
  }
>;
export type RoutePlanEvent = Envelope<
  "route.plan",
  { path: string[]; confidence: number; reason?: string }
>;
export type RouteStepEvent = Envelope<"route.step", { node_id: string; index: number }>;
export type RagSearchEvent = Envelope<"rag.search", { query: string }>;
export type RagResultEvent = Envelope<"rag.result", { hits: RagHit[]; used: boolean }>;
export type NodeFormingEvent = Envelope<"node.forming", { sources: string[] }>;
/** Local sequence marker; never emitted on the public wire contract. */
export type IgnoredEvent = Envelope<"event.ignored", Record<string, never>>;
export type NodeSpawnEvent = Envelope<
  "node.spawn",
  { anchor: string | null; node: GeneratedNode }
>;
export type AnswerChunkEvent = Envelope<"answer.chunk", { text: string }>;
export type LiveMessageEvent = Envelope<
  "live.message",
  { conversation_id: string; message: LiveMessage }
>;
export type LiveDeliveryEvent = Envelope<
  "live.delivery",
  { message_id: string; status: LiveDeliveryStatus }
>;
export type RunDoneEvent = Envelope<
  "run.done",
  { outcome: RunOutcome; duration_ms: number }
>;
export type RunErrorEvent = Envelope<
  "run.error",
  { code: ErrorCode; message: string; retryable: boolean }
>;

export type BackendEvent =
  | RunStartEvent
  | ProcessStepEvent
  | TraceHopEvent
  | RoutePlanEvent
  | RouteStepEvent
  | RagSearchEvent
  | RagResultEvent
  | NodeFormingEvent
  | IgnoredEvent
  | NodeSpawnEvent
  | AnswerChunkEvent
  | LiveMessageEvent
  | LiveDeliveryEvent
  | RunDoneEvent
  | RunErrorEvent
  | ChessMoveEvent
  | OwnerChessEvent;

export type ChessMoveEvent = Envelope<"chess.move", { game: ChessGame }>;
export type OwnerChessEvent = Envelope<"owner.chess", { game: OwnerChessGame; reason: "new" | "move" | "resign" }>;

export const EVENT_TYPES = [
  "node.forming",
  "chess.move",
  "owner.chess",
  "run.start",
  "process.step",
  "trace.hop",
  "route.plan",
  "route.step",
  "rag.search",
  "rag.result",
  "node.spawn",
  "answer.chunk",
  "live.message",
  "live.delivery",
  "run.done",
  "run.error",
] as const;

/** Validación mínima del sobre; el contenido de `data` se confía según `type`. */
export function isBackendEvent(x: unknown): x is BackendEvent {
  if (typeof x !== "object" || x === null) return false;
  const e = x as Record<string, unknown>;
  if (e.type === 'chess.move' || e.type === 'owner.chess') {
    const data = e.data as { game?: ChessGame; reason?: string } | undefined;
    return !!data?.game && typeof data.game.id === 'string' && typeof data.game.fen === 'string' &&
      Array.isArray(data.game.moves) && (data.game.color === 'w' || data.game.color === 'b') &&
      ['player', 'owner'].includes(data.game.turn) && ['active', 'checkmate', 'stalemate', 'draw', 'resigned'].includes(data.game.status) &&
      (e.type !== 'owner.chess' || typeof (data.game as OwnerChessGame).tag === 'string' && typeof (data.game as OwnerChessGame).player_hint === 'string' && ['new', 'move', 'resign'].includes(data.reason || ''));
  }
  if (e.type === 'node.forming') {
    const sources = (e.data as { sources?: unknown } | null)?.sources;
    if (!Array.isArray(sources) || !sources.every(id => typeof id === 'string')) return false;
  }
  return (
    e.v === CONTRACT_VERSION &&
    typeof e.type === "string" &&
    (EVENT_TYPES as readonly string[]).includes(e.type) &&
    typeof e.run_id === "string" &&
    typeof e.seq === "number" &&
    typeof e.data === "object" &&
    e.data !== null
  );
}

/* ───────────────────────── HTTP ───────────────────────── */

/** GET /auth/guest (con el header X-Visitor-Id) */
export interface GuestTokenResponse {
  token: string;
  /** Optional explicit expiry; tokens stay opaque. */
  expires_at?: string | number;
}

/** POST /api/v1/chat */
export interface ChatRequest {
  lang?: 'es' | 'en';
  message: string;
}
export interface ChatAccepted {
  run_id: string;
}

/** GET /api/v1/session/nodes */
export interface SessionNodesResponse {
  nodes: GeneratedNode[];
}

/** POST /api/v1/live/messages */
export interface LiveSendRequest {
  text: string;
  /** Nombre opcional del visitante, hasta LIMITS.liveNameMaxChars. */
  name?: string;
}
export interface LiveSendAccepted {
  message_id: string;
  run_id: string;
}

/** GET /api/v1/live/messages */
export interface LiveHistoryResponse {
  conversation_id: string | null;
  messages: LiveMessage[];
}

/** Cuerpo de cualquier respuesta de error (4xx / 5xx). */
export interface ApiErrorBody {
  error: { code: ErrorCode; message: string };
}

export class BackendError extends Error {
  constructor(
    public code: ErrorCode,
    message: string,
    public status?: number,
    /** Segundos a esperar (header Retry-After) cuando code === "rate_limited". */
    public retryAfterSec?: number,
  ) {
    super(message);
    this.name = "BackendError";
  }
}

/* ───────────────────────── Interfaz que implementan Mock y Real ───────────────────────── */

export type ConnectionState = "connecting" | "open" | "reconnecting" | "closed";

export interface AuthMe { mode: 'guest' | 'user' | 'owner'; email_hint?: string }
export interface Notifications { chess_email: boolean }
export interface AuthToken { token: string; visitor_id?: string }
/** color is the player's side, using the same w/b notation as FEN. */
export interface ChessGame {
  id: string; color: 'w' | 'b'; fen: string;
  moves: { san: string; uci: string; by: 'player' | 'owner'; ts: string }[];
  turn: 'player' | 'owner'; status: 'active' | 'checkmate' | 'stalemate' | 'draw' | 'resigned'; updated_at: string;
}
export interface OwnerChessGame extends ChessGame { tag: string; player_hint: string }

export interface PortfolioBackend {
  authMe(): Promise<AuthMe>;
  requestEmailLogin(email: string, lang: 'es' | 'en'): Promise<void>;
  verifyEmailLogin(token: string): Promise<AuthToken>;
  startGoogleLogin(): Promise<void>;
  exchangeCode(code: string): Promise<AuthToken>;
  logout(): Promise<void>;
  unsubscribe(token: string): Promise<void>;
  getNotifications(): Promise<Notifications>;
  setNotifications(settings: Notifications): Promise<Notifications>;
  deleteAccount(): Promise<void>;
  deleteSessionData(): Promise<void>;
  chessGetGame(): Promise<ChessGame | null>;
  chessNewGame(color: ChessGame['color']): Promise<ChessGame>;
  chessMove(uci: string): Promise<ChessGame>;
  chessResign(): Promise<ChessGame>;
  ownerChessGames(): Promise<OwnerChessGame[]>;
  ownerChessMove(id: string, uci: string): Promise<OwnerChessGame>;
  ownerChessResign(id: string): Promise<OwnerChessGame>;

  /** Obtiene un ticket de un solo uso y abre el WebSocket. Idempotente. */
  connect(): Promise<void>;
  disconnect(): void;

  /** Envía una pregunta al agente. Los eventos llegan por `onEvent`, no en la respuesta. */
  sendMessage(message: string, lang?: ChatRequest['lang']): Promise<ChatAccepted>;

  /** Envía un mensaje al dueño (chat en vivo). Las respuestas llegan por `onEvent` (live.message). */
  sendLiveMessage(text: string, name?: string): Promise<LiveSendAccepted>;
  listLiveMessages(): Promise<LiveHistoryResponse>;

  /** Devuelve la función para cancelar la suscripción. */
  onEvent(handler: (event: BackendEvent) => void): () => void;
  onConnectionChange(handler: (state: ConnectionState) => void): () => void;

  /** Nodos generados guardados para este visitante. */
  listGeneratedNodes(): Promise<GeneratedNode[]>;
  deleteGeneratedNode(id: string): Promise<void>;
}
