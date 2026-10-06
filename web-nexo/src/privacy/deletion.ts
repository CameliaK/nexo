import { BackendError, type PortfolioBackend } from '../backend/types';
import { t } from '../i18n';
/** Separate cooldown: deletion limits never affect either chat or session acquisition. */
export class DataDeletion {
  busy = false;
  retryAt = 0;
  failed = false;
  constructor(private backend: Pick<PortfolioBackend, 'deleteSessionData'>, private now = () => Date.now()) {}
  get seconds() { return Math.max(0, Math.ceil((this.retryAt - this.now()) / 1000)); }
  get message() { return this.busy ? t('privacy.deleting') : this.seconds ? t('privacy.wait', { seconds: this.seconds }) : this.failed ? t('privacy.error') : ''; }
  async run() {
    if (this.busy || this.seconds) return false;
    this.busy = true; this.failed = false;
    try { await this.backend.deleteSessionData(); return true; }
    catch (error) {
      this.failed = true;
      if (error instanceof BackendError && error.status === 429) this.retryAt = this.now() + (error.retryAfterSec ?? 30) * 1000;
      return false;
    } finally { this.busy = false; }
  }
}
