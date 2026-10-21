import { ApiError } from './validation.mjs';

// SMTP credentials belong only to GoTrue. Public transactional delivery must be
// explicitly enabled; staging keeps its captured/exact-allowlist behavior.
// General business enquiries never trigger outgoing email.
export function assertMailRecipient(config, email) {
  if (config.mailDeliveryMode === 'captured') return;
  if (config.mailDeliveryMode === 'allowlist' && Array.isArray(config.testEmailAllowlist) && config.testEmailAllowlist.includes(email.toLowerCase())) return;
  if (config.mailDeliveryMode === 'smtp' && config.appEnv === 'production' && config.transactionalMailEnabled === true) return;
  throw new ApiError(503, 'MAIL_NOT_ENABLED', 'Email delivery is not enabled for this recipient. Contact ShadowBridge. No message has been requested.');
}
