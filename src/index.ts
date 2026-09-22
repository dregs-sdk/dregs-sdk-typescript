/**
 * Dregs: fraud and abuse scoring for the users of your application.
 *
 * Send events from your backend, read back the scores and the observations behind them.
 *
 * ```ts
 * import { Dregs } from 'dregs';
 *
 * const client = new Dregs();
 *
 * await client.track('user.signup', {
 *   identity: 'user_12345',
 *   data: { plan: 'pro' },
 *   identityData: { email: 'ada@example.com' },
 * });
 *
 * const scores = await client.identities.scores('user_12345');
 *
 * if (scores.authenticity !== null && scores.authenticity < 40) {
 *   await holdForReview('user_12345');
 * }
 * ```
 *
 * Scoring is asynchronous, so scores appear moments after the events that move them rather than
 * in the same breath. See https://dregs.com/manual/api/ for the API this wraps.
 *
 * @module
 */

export { VERSION } from './version.js';

export {
  BASE_URL_ENV,
  DEFAULT_BASE_URL,
  DEFAULT_MAX_RETRIES,
  DEFAULT_SOURCE,
  DEFAULT_TIMEOUT_MS,
  Dregs,
  SECRET_KEY_ENV,
} from './client.js';
export type { DregsOptions, FetchLike, TrackOptions } from './client.js';

export { Identities } from './resources.js';

export {
  AuthenticationError,
  BadRequestError,
  DregsAPIError,
  DregsConnectionError,
  DregsError,
  DregsTimeoutError,
  NotFoundError,
  PermissionDeniedError,
  QuotaExceededError,
  RateLimitError,
  ServerError,
  WebhookVerificationError,
  errorForStatus,
} from './errors.js';
export type { DregsAPIErrorOptions, RateLimitErrorOptions } from './errors.js';

export { CATEGORIES, Scores } from './models.js';
export type {
  Analysis,
  Badge,
  Category,
  Identity,
  Observation,
  RawPayload,
  Score,
  TrackResult,
} from './models.js';

export {
  DEFAULT_TOLERANCE_SECONDS,
  EVENT_HEADER,
  SIGNATURE_HEADER,
  TIMESTAMP_HEADER,
  computeWebhookSignature,
  verifyWebhook,
  verifyWebhookSignature,
} from './webhooks.js';
export type { VerifyWebhookOptions, WebhookEvent, WebhookPayload } from './webhooks.js';
