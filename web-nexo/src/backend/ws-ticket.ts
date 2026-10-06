import { BackendError } from './types';
import { t } from '../i18n';
/** Mock transport models the same 30-second, single-use contract; tickets are never persisted. */
export class MockWsTickets {
  private issued = new Map<string, number>();
  constructor(private now = () => Date.now()) {}
  async request() {
    const ticket = crypto.randomUUID(); this.issued.set(ticket, this.now() + 30000);
    return { ticket, expires_in: 30 };
  }
  consume(ticket: string) {
    const expires = this.issued.get(ticket); this.issued.delete(ticket);
    if (!expires || expires <= this.now()) throw new BackendError('unauthorized', t('error.connection'), 401);
  }
  clear() { this.issued.clear(); }
}
