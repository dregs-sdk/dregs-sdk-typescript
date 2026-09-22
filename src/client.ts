/**
 * The Dregs client.
 *
 * There is one client and every method returns a promise; JavaScript has no meaningful
 * sync/async split, so there is no async twin to pick between.
 *
 * @module
 */

import {
  DregsAPIError,
  DregsConnectionError,
  DregsTimeoutError,
  QuotaExceededError,
  RateLimitError,
  errorForStatus,
} from './errors.js';
import type { RawPayload, TrackResult } from './models.js';
import { parseTrackResult } from './models.js';
import type { RequestFn } from './resources.js';
import { Identities } from './resources.js';
import { VERSION } from './version.js';

/** The API root used when neither an option nor `DREGS_BASE_URL` names one. */
export const DEFAULT_BASE_URL = 'https://dregs.com/api';

/** How long a request may take before it is abandoned, in milliseconds. */
export const DEFAULT_TIMEOUT_MS = 10_000;

/** How many times a failed request is retried before the error is thrown. */
export const DEFAULT_MAX_RETRIES = 2;

/** The environment variable the secret key is read from. */
export const SECRET_KEY_ENV = 'DREGS_SECRET_KEY';

/** The environment variable the base URL is read from. */
export const BASE_URL_ENV = 'DREGS_BASE_URL';

/** The `source` sent on events when the caller does not name one. */
export const DEFAULT_SOURCE = 'node-sdk';

/**
 * Statuses worth another attempt. 429 and 5xx are transient by definition; 408 shows up in front
 * of some proxies.
 */
const RETRY_STATUSES: ReadonlySet<number> = new Set([408, 429, 500, 502, 503, 504]);

/** Body-level statuses older API builds used on `POST /api/events`. */
const STATUS_RATE_LIMITED = 'rate_limited';
const STATUS_QUOTA_EXCEEDED = 'quota_exceeded';

/** The longest a single backoff will ever be, in milliseconds. */
const MAX_BACKOFF_MS = 8_000;

/** The longest a server-sent `Retry-After` will be honoured for, in milliseconds. */
const MAX_RETRY_AFTER_MS = 60_000;

/** The `fetch` this client calls. Any implementation with the standard signature will do. */
export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

/** Everything you can configure on a {@link Dregs} client. */
export interface DregsOptions {
  /**
   * Your credential's secret key, the one starting `sk_`. Found under **Settings → Credentials**
   * in the dashboard. Defaults to `$DREGS_SECRET_KEY`.
   */
  secretKey?: string;

  /**
   * The API root every request is built against. Defaults to `$DREGS_BASE_URL`, then
   * `https://dregs.com/api`. A trailing slash is harmless.
   */
  baseUrl?: string;

  /**
   * Milliseconds before a request is abandoned and retried. Defaults to 10 000.
   *
   * This covers the whole request, not just the connect, so raise it if you are behind a slow
   * egress proxy rather than lowering `maxRetries` to compensate.
   */
  timeout?: number;

  /**
   * How many times to retry a failed request. Defaults to 2; pass 0 to handle it yourself.
   *
   * Retries cover connection failures, timeouts, 408, 429, and 5xx, with exponential backoff and
   * full jitter. `Retry-After` wins when the server sends one. A retried event keeps its id, so
   * a retry can never double-count.
   */
  maxRetries?: number;

  /**
   * A `fetch` to call instead of the runtime's own, for callers who need a proxy agent, custom
   * TLS, or their own instrumentation. Anything with the standard signature works, including a
   * stub in a test.
   */
  fetch?: FetchLike;
}

/** The arguments to {@link Dregs.track} beyond the event type. */
export interface TrackOptions {
  /**
   * Your own id for the user. This is the same id you pass to `dregs.identify()` in the browser
   * tracker, and the one you look scores up by.
   *
   * It is required: a server-side event carries no device signature, so the identity is the only
   * thing tying the event to a user.
   */
  identity: string;

  /** Attributes of the event itself, such as the plan bought or the referrer that sent them. */
  data?: Readonly<Record<string, unknown>>;

  /**
   * Attributes of the *user*, such as email, name, or username. Dregs merges these into the
   * identity, and the analyzers lean on them heavily, so send them whenever you have them.
   *
   * Flat keys work best. Name them as your application already does and map them to Dregs's
   * canonical fields under **Settings → Mappings**.
   */
  identityData?: Readonly<Record<string, unknown>>;

  /**
   * Your own id for the event, which makes ingestion idempotent: reposting the same id returns
   * the original event instead of recording a second one.
   *
   * Pass the id your application already has — the row id of the record that triggered the
   * event, say. When you omit it the SDK generates one, which is what makes its own retries
   * safe. At most 64 characters, and it cannot start with `dregs-`.
   */
  eventId?: string;

  /**
   * When the event happened, if not now. A `Date`, or an ISO-8601 string. Sent as UTC.
   */
  timestamp?: Date | string;

  /** A label for where the event came from. Defaults to `"node-sdk"`. */
  source?: string;
}

/**
 * A Dregs client.
 *
 * The secret key comes from the `DREGS_SECRET_KEY` environment variable unless you pass one.
 * Find it under **Settings → Credentials** in the dashboard; it is the key starting `sk_`, not
 * the `pk_` public key the browser tracker uses.
 *
 * ```ts
 * import { Dregs } from '@dregs/sdk';
 *
 * const client = new Dregs();
 *
 * await client.track('user.signup', { identity: 'user_12345', data: { plan: 'pro' } });
 *
 * const scores = await client.identities.scores('user_12345');
 * ```
 *
 * Build one at startup and keep it. There is nothing to close: the client holds no state beyond
 * its configuration, and connection pooling belongs to the runtime's `fetch`.
 */
export class Dregs {
  /** Read identities, their scores, and their analysis. */
  readonly identities: Identities;

  readonly #secretKey: string;
  readonly #baseUrl: string;
  readonly #timeout: number;
  readonly #maxRetries: number;
  readonly #fetch: FetchLike;

  /**
   * @param options Configuration. Every field has a default, so `new Dregs()` reads the
   *   environment and is usually enough.
   * @throws {TypeError} No secret key was found, the key given is a `pk_` public key, or
   *   `maxRetries` is negative.
   */
  constructor(options: DregsOptions = {}) {
    const secretKey = options.secretKey ?? readEnv(SECRET_KEY_ENV);

    if (!secretKey) {
      throw new TypeError(
        `No Dregs secret key. Pass { secretKey: '...' } or set the ${SECRET_KEY_ENV} ` +
          "environment variable. You will find your credential's secret key under " +
          'Settings -> Credentials in the Dregs dashboard.',
      );
    }

    if (secretKey.startsWith('pk_')) {
      throw new TypeError(
        'That is a public key. The public key is for the browser tracker and cannot read ' +
          'identities or scores; this SDK needs the secret key from the same credential, ' +
          "which starts with 'sk_'.",
      );
    }

    const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;

    if (maxRetries < 0 || !Number.isInteger(maxRetries)) {
      throw new TypeError('maxRetries must be a non-negative integer.');
    }

    const timeout = options.timeout ?? DEFAULT_TIMEOUT_MS;

    if (timeout <= 0) {
      throw new TypeError('timeout must be greater than zero.');
    }

    const resolvedFetch: FetchLike | undefined = options.fetch ?? globalThis.fetch;

    if (!resolvedFetch) {
      throw new TypeError(
        'No global fetch. This SDK needs Node 20 or newer, or a fetch implementation passed ' +
          'as the fetch option.',
      );
    }

    this.#secretKey = secretKey;
    this.#baseUrl = (options.baseUrl ?? readEnv(BASE_URL_ENV) ?? DEFAULT_BASE_URL).replace(
      /\/+$/,
      '',
    );
    this.#timeout = timeout;
    this.#maxRetries = maxRetries;
    this.#fetch = resolvedFetch;

    const request: RequestFn = (method, path, body) => this.request(method, path, body);

    this.identities = new Identities(request);
  }

  /** The API root every request is built against, with any trailing slash removed. */
  get baseUrl(): string {
    return this.#baseUrl;
  }

  /** How many times a failed request is retried before the error is thrown. */
  get maxRetries(): number {
    return this.#maxRetries;
  }

  /** Milliseconds before a request is abandoned. */
  get timeout(): number {
    return this.#timeout;
  }

  /**
   * Records a backend event against an identity.
   *
   * ```ts
   * await client.track('user.signup', {
   *   identity: 'user_12345',
   *   data: { plan: 'pro', referrer: 'partner-x' },
   *   identityData: { email: 'ada@example.com', name: 'Ada Lovelace' },
   * });
   * ```
   *
   * @param type Your name for the event, such as `"user.signup"`. Map it to one of Dregs's
   *   canonical types under **Settings → Mappings** so the analyzers know what it means.
   * @param options The identity the event belongs to, and anything else worth sending.
   * @returns The outcome. Check `.accepted` to confirm Dregs recorded the event.
   * @throws {QuotaExceededError} The account is over its monthly event limit.
   * @throws {RateLimitError} The credential is ingesting too fast.
   * @throws {AuthenticationError} The secret key was not recognized.
   * @throws {BadRequestError} The event was malformed.
   * @throws {TypeError} The event type, identity, or event id was unusable. These are thrown
   *   before anything is sent.
   */
  async track(type: string, options: TrackOptions): Promise<TrackResult> {
    return parseTrackResult(await this.request('POST', '/events', this.trackBody(type, options)));
  }

  /**
   * Builds the `POST /api/events` body.
   *
   * An event id is always sent. When the caller has an id of their own it is used verbatim, so
   * reposting the same event is a no-op on the Dregs side; otherwise one is generated, which is
   * what makes this client's own retries safe to perform.
   */
  private trackBody(type: string, options: TrackOptions): RawPayload {
    if (!type) {
      throw new TypeError('An event type is required.');
    }

    if (!options?.identity) {
      throw new TypeError(
        'An identity is required. A server-side event has no device signature, so the ' +
          'identity is the only thing tying the event to a user.',
      );
    }

    const eventId = options.eventId ?? randomEventId();

    if (eventId.startsWith('dregs-')) {
      throw new TypeError("Event ids starting with 'dregs-' are reserved for Dregs itself.");
    }

    if (eventId.length > 64) {
      throw new TypeError('Event ids cannot be longer than 64 characters.');
    }

    const body: Record<string, unknown> = {
      id: eventId,
      type,
      data: { ...(options.data ?? {}) },
      identity: { id: options.identity, data: { ...(options.identityData ?? {}) } },
      source: options.source ?? DEFAULT_SOURCE,
    };

    if (options.timestamp !== undefined) {
      body.timestamp = toIsoUtc(options.timestamp);
    }

    return body;
  }

  /**
   * Sends one request, retrying what is worth retrying, and returns the parsed JSON body.
   *
   * The retry loop reuses the request body verbatim, which is what keeps a retried event
   * idempotent: the generated id is built once, before the first attempt.
   */
  private async request(method: string, path: string, body?: unknown): Promise<unknown> {
    const url = `${this.#baseUrl}/${path.replace(/^\/+/, '')}`;
    const init = this.requestInit(method, body);

    for (let attempt = 0; ; attempt += 1) {
      let response: Response;
      let text: string;

      try {
        response = await this.#fetch(url, { ...init, signal: AbortSignal.timeout(this.#timeout) });
        text = await response.text();
      } catch (cause) {
        if (!this.shouldRetry(attempt, null)) {
          throw isTimeout(cause)
            ? new DregsTimeoutError(
                `The request to ${url} did not answer within ${this.#timeout}ms.`,
                { cause },
              )
            : new DregsConnectionError(`Could not reach Dregs at ${url}: ${describe(cause)}`, {
                cause,
              });
        }

        await sleep(this.backoff(attempt, null));

        continue;
      }

      try {
        return processResponse(response, text);
      } catch (error) {
        if (error instanceof DregsAPIError && this.shouldRetry(attempt, error.statusCode)) {
          await sleep(
            this.backoff(attempt, error instanceof RateLimitError ? error.retryAfter : null),
          );

          continue;
        }

        throw error;
      }
    }
  }

  private requestInit(method: string, body: unknown): RequestInit {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.#secretKey}`,
      Accept: 'application/json',
      'User-Agent': userAgent(),
    };

    if (body === undefined) {
      return { method, headers };
    }

    headers['Content-Type'] = 'application/json';

    return { method, headers, body: JSON.stringify(body) };
  }

  private shouldRetry(attempt: number, statusCode: number | null): boolean {
    if (attempt >= this.#maxRetries) {
      return false;
    }

    return statusCode === null || RETRY_STATUSES.has(statusCode);
  }

  /**
   * Milliseconds to wait before attempt `attempt + 1`.
   *
   * `Retry-After` wins when the server sent one. Otherwise this is exponential with full jitter,
   * which keeps a fleet of workers that all hit the limit at once from retrying in lockstep.
   *
   * Protected rather than private so a test can stub the waiting out.
   */
  protected backoff(attempt: number, retryAfterSeconds: number | null): number {
    if (retryAfterSeconds !== null && retryAfterSeconds >= 0) {
      return Math.min(retryAfterSeconds * 1000, MAX_RETRY_AFTER_MS);
    }

    return Math.random() * Math.min(500 * 2 ** attempt, MAX_BACKOFF_MS);
  }
}

/** Turns a response into parsed JSON, or throws the matching error. */
function processResponse(response: Response, text: string): unknown {
  const payload = parseJson(text);

  if (response.status >= 400) {
    throw apiError(response, payload);
  }

  // An older API build reported both of these as HTTP 200 with the outcome in the body. Reading
  // the body as well as the status keeps this SDK correct against either.
  if (isRecord(payload)) {
    if (payload.status === STATUS_RATE_LIMITED) {
      throw new RateLimitError('Ingestion rate limit exceeded for this credential.', {
        body: payload,
        requestId: requestId(response),
        retryAfter: retryAfter(response),
      });
    }

    if (payload.status === STATUS_QUOTA_EXCEEDED) {
      throw new QuotaExceededError('The account is over its monthly event limit.', {
        statusCode: 402,
        body: payload,
        requestId: requestId(response),
      });
    }
  }

  return payload;
}

function apiError(response: Response, payload: unknown): DregsAPIError {
  const message = messageFrom(payload) ?? response.statusText ?? 'Request failed';
  const id = requestId(response);

  if (response.status === 429) {
    return new RateLimitError(message, {
      body: payload,
      requestId: id,
      retryAfter: retryAfter(response),
    });
  }

  const ErrorClass = errorForStatus(response.status);

  return new ErrorClass(message, { statusCode: response.status, body: payload, requestId: id });
}

function messageFrom(payload: unknown): string | null {
  if (!isRecord(payload)) {
    return null;
  }

  for (const key of ['message', 'error', 'status'] as const) {
    const value = payload[key];

    if (typeof value === 'string' && value) {
      return value;
    }
  }

  return null;
}

function requestId(response: Response): string | null {
  return response.headers.get('X-Request-Id');
}

function retryAfter(response: Response): number | null {
  const raw = response.headers.get('Retry-After');

  if (raw === null) {
    return null;
  }

  const seconds = Number(raw);

  // The header also allows an HTTP date, which is rare enough here that falling back to the
  // client's own backoff beats parsing one.
  return Number.isFinite(seconds) ? seconds : null;
}

function parseJson(text: string): unknown {
  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Whether a thrown value is the request running out of time.
 *
 * `AbortSignal.timeout` aborts with a `TimeoutError`, but which layer surfaces it depends on the
 * runtime, so the cause is worth checking too.
 */
function isTimeout(cause: unknown): boolean {
  const names = [nameOf(cause), nameOf((cause as { cause?: unknown } | null)?.cause)];

  return names.includes('TimeoutError') || names.includes('AbortError');
}

function nameOf(value: unknown): string | null {
  if (typeof value !== 'object' || value === null || !('name' in value)) {
    return null;
  }

  const { name } = value;

  return typeof name === 'string' ? name : null;
}

function describe(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function sleep(ms: number): Promise<void> {
  return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();
}

function readEnv(name: string): string | undefined {
  return typeof process === 'undefined' ? undefined : process.env[name];
}

/** A random event id with no `dregs-` prefix, which is reserved for server-generated ids. */
function randomEventId(): string {
  return globalThis.crypto.randomUUID().replace(/-/g, '');
}

/**
 * Formats a timestamp the way the API's `Instant` parser expects.
 *
 * A string is re-parsed rather than passed through, so an unusable one is rejected here instead
 * of coming back as a puzzling 400.
 */
function toIsoUtc(value: Date | string): string {
  const moment = value instanceof Date ? value : new Date(value);

  if (Number.isNaN(moment.getTime())) {
    throw new TypeError(`The timestamp ${JSON.stringify(value)} is not a valid date.`);
  }

  // Whole seconds lose the `.000`, which is the form the API's own examples use; anything
  // finer keeps its milliseconds.
  return moment.toISOString().replace(/\.000Z$/, 'Z');
}

function userAgent(): string {
  const runtime =
    typeof process !== 'undefined' && process.versions?.node
      ? `node ${process.versions.node}`
      : 'unknown';

  return `dregs-node/${VERSION} (${runtime})`;
}
