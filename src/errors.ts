/**
 * Errors thrown by the Dregs SDK.
 *
 * Everything this library throws derives from {@link DregsError}, so a caller that only wants a
 * coarse "the Dregs call failed" branch can catch that one class. Errors that came back from the
 * API carry the HTTP status and the parsed body; errors that never reached the API (DNS failure,
 * connection refused, timeout) derive from {@link DregsConnectionError} instead.
 *
 * @module
 */

/**
 * Base class for everything this library throws.
 *
 * `instanceof DregsError` is the one check that catches every failure mode, including webhook
 * verification and transport failures that never produced an HTTP status.
 */
export class DregsError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);

    // Subclassing a built-in loses the prototype link under a downlevelled target, so pin it
    // back on. Without this, `err instanceof RateLimitError` can quietly answer false.
    Object.setPrototypeOf(this, new.target.prototype);

    this.name = new.target.name;
  }
}

/** The request never reached Dregs: DNS, TCP, TLS, or a dropped connection. */
export class DregsConnectionError extends DregsError {}

/** The request was still outstanding when the configured timeout elapsed. */
export class DregsTimeoutError extends DregsConnectionError {}

/** An incoming webhook did not verify against the channel's signing secret. */
export class WebhookVerificationError extends DregsError {}

/** The fields carried by every error that reached the API and came back an error. */
export interface DregsAPIErrorOptions {
  /** The HTTP status code. */
  statusCode: number;
  /** The parsed JSON body, or `null` when the response was not JSON. */
  body?: unknown;
  /** Value of the `X-Request-Id` response header, when the response carried one. */
  requestId?: string | null;
  /** The underlying cause, when there is one worth keeping. */
  cause?: unknown;
}

/**
 * Dregs answered, and the answer was an error.
 *
 * `message` is the human-readable message the API sent, so `err.message` reads the way a JS
 * caller expects. `toString()` prefixes it with the status and the request id, which is the form
 * worth putting in a log line when you open a support ticket.
 */
export class DregsAPIError extends DregsError {
  /** The HTTP status code. */
  readonly statusCode: number;

  /** The parsed JSON body, or `null` when the response was not JSON. */
  readonly body: unknown;

  /**
   * Value of the `X-Request-Id` response header, when present.
   *
   * Quote it when you report a problem: it is what lets Dregs find your exact request.
   */
  readonly requestId: string | null;

  constructor(message: string, options: DregsAPIErrorOptions) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });

    this.statusCode = options.statusCode;
    this.body = options.body ?? null;
    this.requestId = options.requestId ?? null;
  }

  override toString(): string {
    const suffix = this.requestId ? ` (request ${this.requestId})` : '';

    return `${this.name}: HTTP ${this.statusCode}: ${this.message}${suffix}`;
  }
}

/**
 * 400. The request was malformed or missing something Dregs requires.
 *
 * For event ingestion this most often means the event carried neither an identity nor a device,
 * or the body failed validation.
 */
export class BadRequestError extends DregsAPIError {}

/** 401. The secret key was missing, unrecognized, revoked, or expired. */
export class AuthenticationError extends DregsAPIError {}

/**
 * 402. The account is over its monthly event limit and ingestion is refused.
 *
 * Events are not queued while an account is over its limit, so the caller decides whether to drop
 * the event or hold it. The limit resets with the billing period; upgrading the plan clears it
 * immediately.
 */
export class QuotaExceededError extends DregsAPIError {}

/** 403. The credential authenticated but is not allowed to do this. */
export class PermissionDeniedError extends DregsAPIError {}

/** 404. No such identity, or no analysis has been run for it yet. */
export class NotFoundError extends DregsAPIError {}

/** The fields carried by a 429, on top of the usual API error fields. */
export interface RateLimitErrorOptions extends Omit<DregsAPIErrorOptions, 'statusCode'> {
  statusCode?: number;
  /** Seconds to wait before retrying, from the `Retry-After` header. */
  retryAfter?: number | null;
}

/**
 * 429. The credential exceeded its request rate limit.
 *
 * The client retries these on its own; you only see one when the retries were exhausted or turned
 * off. Wait {@link RateLimitError.retryAfter} seconds before trying again when it is set.
 */
export class RateLimitError extends DregsAPIError {
  /**
   * Seconds to wait before retrying, from the `Retry-After` header when the response carried a
   * numeric one, and `null` otherwise.
   */
  readonly retryAfter: number | null;

  constructor(message: string, options: RateLimitErrorOptions = {}) {
    super(message, { ...options, statusCode: options.statusCode ?? 429 });

    this.retryAfter = options.retryAfter ?? null;
  }
}

/** 5xx. Something went wrong inside Dregs. These are retried automatically. */
export class ServerError extends DregsAPIError {}

const STATUS_ERRORS: Readonly<
  Record<number, new (message: string, options: DregsAPIErrorOptions) => DregsAPIError>
> = {
  400: BadRequestError,
  401: AuthenticationError,
  402: QuotaExceededError,
  403: PermissionDeniedError,
  404: NotFoundError,
};

/**
 * Returns the error class that represents `statusCode`.
 *
 * 429 is deliberately absent from the table: it needs the `Retry-After` header, so the client
 * builds a {@link RateLimitError} directly rather than going through here.
 */
export function errorForStatus(
  statusCode: number,
): new (message: string, options: DregsAPIErrorOptions) => DregsAPIError {
  const mapped = STATUS_ERRORS[statusCode];

  if (mapped) {
    return mapped;
  }

  return statusCode >= 500 ? ServerError : DregsAPIError;
}
