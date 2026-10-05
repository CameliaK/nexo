import { BackendError } from './backend/types';
import { t, type UIKey } from './i18n';
const errors: Partial<Record<BackendError['code'], UIKey>> = {
  busy: 'error.busy', rate_limited: 'chat.errorRate', llm_unavailable: 'chat.errorLLM', internal: 'chat.errorInternal',
  login_required: 'auth.required', forbidden: 'auth.forbidden', unauthorized: 'auth.required', invalid_request: 'chat.queryFailed',
};
export function chatErrorText(error: unknown) {
  if(error instanceof BackendError){if(error.status===429)return t('chat.errorRate');if(error.code==='busy'||error.status===409)return t('error.busy');const key=errors[error.code];if(key)return t(key)}
  return t('chat.errorInternal');
}
