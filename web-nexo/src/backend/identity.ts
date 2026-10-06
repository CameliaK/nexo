export const AUTH_TOKEN_KEY = 'nexo.auth.token';
/** Keep UI preferences and IP-wide rate limits, remove identity and personal local data. */
export function clearLocalSession(storage?: Pick<Storage, 'removeItem'>) {
  try {
    const target = storage ?? localStorage;
    for (const key of ['nexo.visitor_id', AUTH_TOKEN_KEY, 'nexo.guest.session', 'nexo.login.continue', 'nexo.live.name', 'nexo.live.named', 'nexo.live.readAt']) target.removeItem(key);
  } catch { /* Ephemeral browser session. */ }
}
