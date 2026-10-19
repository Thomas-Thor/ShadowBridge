import { ApiError } from './validation.mjs';

// SMTP credentials belong only to GoTrue. Staging sends to explicitly approved
// test recipients; general business enquiries never trigger outgoing email.
export function assertMailRecipient(config, email) {
  if (config.mailDeliveryMode === 'captured') return;
  if (config.mailDeliveryMode === 'allowlist' && Array.isArray(config.testEmailAllowlist) && config.testEmailAllowlist.includes(email.toLowerCase())) return;
  throw new ApiError(503, 'MAIL_NOT_ENABLED', 'Email delivery is not enabled for this recipient. Contact the staging owner. No message has been requested.');
}
