/**
 * Verifying webhooks Dregs sends you.
 *
 * Dregs signs every webhook with the channel's signing secret: `X-Dregs-Signature` is the
 * hex-encoded HMAC-SHA256 of the raw request body. Verify it before you act on the payload, and
 * verify it against the bytes you received rather than a re-serialized object, because
 * re-serializing changes key order and whitespace and will not match.
 *
 * ```ts
 * import { verifyWebhook } from '@dregs/sdk/webhooks';
 *
 * app.post('/webhooks/dregs', express.raw({ type: 'application/json' }), (req, res) => {
 *   const event = verifyWebhook({
 *     payload: req.body, // the Buffer, not req.body parsed as JSON
 *     signature: req.header('X-Dregs-Signature') ?? '',
 *     secret: process.env.DREGS_WEBHOOK_SECRET!,
 *   });
 *
 *   handle(event);
 * });
 * ```
 *
 * The signing secret is shown once, when you create the webhook channel. It is not your API
 * secret key: one authenticates you to Dregs, the other proves a payload came from Dregs.
 *
 * @module
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

import { WebhookVerificationError } from './errors.js';

/** The header carrying the hex-encoded HMAC-SHA256 of the raw body. */
export const SIGNATURE_HEADER = 'X-Dregs-Signature';

/** The header carrying the delivery's timestamp. */
export const TIMESTAMP_HEADER = 'X-Dregs-Timestamp';

/** The header naming the event type. */
export const EVENT_HEADER = 'X-Dregs-Event';

/** How far out of date a webhook's timestamp may be before {@link verifyWebhook} rejects it. */
export const DEFAULT_TOLERANCE_SECONDS = 300;

/**
 * A raw webhook body.
 *
 * A `Buffer` or `Uint8Array` is what you want: the bytes exactly as received. A string is
 * accepted for frameworks that hand you the raw text, and is hashed as UTF-8.
 */
export type WebhookPayload = string | Uint8Array;

/** A verified webhook body: `event`, `timestamp`, and the payload for that event. */
export type WebhookEvent = Record<string, unknown>;

/** The arguments to {@link verifyWebhook}. */
export interface VerifyWebhookOptions {
  /** The raw request body, exactly as received. Not a parsed object. */
  payload: WebhookPayload;

  /** The `X-Dregs-Signature` header. */
  signature: string;

  /** The channel's signing secret. */
  secret: string;

  /**
   * How many seconds out of date the payload's own `timestamp` may be before it is treated as a
   * replay. Defaults to 300. Pass `null` to skip the check, which you should only do if you are
   * deduplicating on the event id yourself.
   *
   * The timestamp is inside the signed body, so an attacker cannot alter it without breaking
   * the signature.
   */
  tolerance?: number | null;

  /** The current time. For tests. */
  now?: Date;
}

/** Returns the hex-encoded HMAC-SHA256 of `payload` under `secret`. */
export function computeWebhookSignature(payload: WebhookPayload, secret: string): string {
  return createHmac('sha256', secret).update(toBytes(payload)).digest('hex');
}

/**
 * Returns whether `signature` matches `payload`.
 *
 * The comparison is constant-time. Prefer {@link verifyWebhook}, which also rejects replays and
 * hands back the parsed event; reach for this one only when you need the boolean.
 */
export function verifyWebhookSignature(
  payload: WebhookPayload,
  signature: string,
  secret: string,
): boolean {
  if (!signature || !secret) {
    return false;
  }

  const expected = Buffer.from(computeWebhookSignature(payload, secret), 'utf8');
  const received = Buffer.from(signature.trim(), 'utf8');

  // timingSafeEqual throws on a length mismatch rather than returning false, and a wrong-length
  // signature is wrong regardless; the length is not a secret.
  return expected.length === received.length && timingSafeEqual(expected, received);
}

/**
 * Verifies a webhook and returns its parsed body.
 *
 * @returns The parsed webhook body: `event`, `timestamp`, and the payload for that event.
 * @throws {WebhookVerificationError} The signature did not match, the body was not a JSON
 *   object, or the payload is older than the tolerance. Answer 400 and do not act on it.
 */
export function verifyWebhook(options: VerifyWebhookOptions): WebhookEvent {
  const { payload, signature, secret, tolerance = DEFAULT_TOLERANCE_SECONDS, now } = options;

  if (!verifyWebhookSignature(payload, signature, secret)) {
    throw new WebhookVerificationError(
      'The webhook signature did not match. Check that you are verifying the raw request body ' +
        'rather than a re-serialized copy, and that the signing secret belongs to the channel ' +
        'that sent this delivery.',
    );
  }

  let event: unknown;

  try {
    event = JSON.parse(toText(payload));
  } catch (cause) {
    throw new WebhookVerificationError(
      `The webhook body was not valid JSON: ${cause instanceof Error ? cause.message : String(cause)}`,
      { cause },
    );
  }

  if (typeof event !== 'object' || event === null || Array.isArray(event)) {
    throw new WebhookVerificationError('The webhook body was not a JSON object.');
  }

  const body = event as WebhookEvent;

  if (tolerance !== null && tolerance !== undefined) {
    checkFreshness(body, tolerance, now);
  }

  return body;
}

function checkFreshness(event: WebhookEvent, tolerance: number, now: Date | undefined): void {
  const raw = event.timestamp;

  if (typeof raw !== 'string' || !raw) {
    throw new WebhookVerificationError(
      'The webhook carried no timestamp, so it cannot be checked for replay. Pass ' +
        'tolerance: null if you are deduplicating deliveries some other way.',
    );
  }

  const sent = new Date(raw);

  if (Number.isNaN(sent.getTime())) {
    throw new WebhookVerificationError(
      `The webhook timestamp was unreadable: ${JSON.stringify(raw)}`,
    );
  }

  const age = Math.abs(((now ?? new Date()).getTime() - sent.getTime()) / 1000);

  if (age > tolerance) {
    throw new WebhookVerificationError(
      `The webhook timestamp is ${age.toFixed(0)}s away from now, beyond the ${tolerance}s ` +
        'tolerance. Treating it as a replay.',
    );
  }
}

function toBytes(payload: WebhookPayload): Buffer {
  return typeof payload === 'string' ? Buffer.from(payload, 'utf8') : Buffer.from(payload);
}

function toText(payload: WebhookPayload): string {
  return typeof payload === 'string' ? payload : Buffer.from(payload).toString('utf8');
}
