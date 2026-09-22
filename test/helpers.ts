/**
 * A recording `fetch` stub, and the fixtures the suite shares.
 *
 * The SDK takes its `fetch` as an option, so mocking HTTP needs no library and no network: the
 * tests hand the client a stub and read the requests back off it.
 */

import { expect, vi } from 'vitest';

import { Dregs } from '../src/client.js';
import type { DregsOptions, FetchLike } from '../src/client.js';

export const BASE_URL = 'https://api.test.invalid/api';
export const SECRET_KEY = 'sk_abcdefghQijklmQabcdefghijklmn';

/** One queued answer: the makings of a `Response`, or a transport failure to throw. */
export type Answer = ResponseSpec | Error;

/**
 * A response described rather than built, so the stub can hand out a fresh `Response` per
 * attempt. A `Response` body can only be read once, which a retry test would otherwise trip on.
 */
export interface ResponseSpec {
  status: number;
  body: string | null;
  headers: Record<string, string>;
}

export interface FetchStub {
  /** The `fetch` to hand the client. */
  readonly fetch: FetchLike;
  /** Every request the client made, in order. */
  readonly calls: { url: string; init: RequestInit }[];
  /** How many requests the client made. */
  readonly callCount: number;
  /** The most recent request. Fails the test when there was none. */
  lastCall(): { url: string; init: RequestInit };
  /** The most recent request's body, parsed. */
  lastBody(): Record<string, unknown>;
  /** The request at `index`, parsed. */
  bodyAt(index: number): Record<string, unknown>;
}

/**
 * Builds a `fetch` stub that answers with `answers` in order, repeating the last one once the
 * queue runs dry. That repetition is what lets a "retries stop at the limit" test queue a single
 * failure and still count the attempts.
 */
export function stubFetch(...answers: Answer[]): FetchStub {
  const calls: { url: string; init: RequestInit }[] = [];

  const fetch: FetchLike = (url, init) => {
    calls.push({ url, init });

    const answer = answers[Math.min(calls.length - 1, answers.length - 1)];

    if (answer === undefined) {
      return Promise.reject(new Error('The fetch stub was called with no answers queued.'));
    }

    if (answer instanceof Error) {
      return Promise.reject(answer);
    }

    return Promise.resolve(
      new Response(answer.body, { status: answer.status, headers: answer.headers }),
    );
  };

  return {
    fetch,
    calls,
    get callCount() {
      return calls.length;
    },
    lastCall() {
      const call = calls.at(-1);

      expect(call, 'expected the client to have made a request').toBeDefined();

      return call!;
    },
    lastBody() {
      return JSON.parse(this.lastCall().init.body as string);
    },
    bodyAt(index: number) {
      const call = calls[index];

      expect(call, `expected a request at index ${index}`).toBeDefined();

      return JSON.parse(call!.init.body as string);
    },
  };
}

/** A JSON response, with optional headers. */
export function json(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): ResponseSpec {
  return {
    status,
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json', ...headers },
  };
}

/** An empty response, as `POST /actions/analyze` sends. */
export function empty(status: number, headers: Record<string, string> = {}): ResponseSpec {
  return { status, body: null, headers };
}

/** A non-JSON response, as a gateway in front of the API might send. */
export function text(status: number, body: string): ResponseSpec {
  return { status, body, headers: { 'Content-Type': 'text/html' } };
}

/** The error body Spring produces for a 4xx or 5xx. */
export function errorBody(status: number, message: string): Record<string, unknown> {
  return { timestamp: '2026-09-21T14:22:09Z', status, error: 'Error', message };
}

/** A transport failure, as the runtime's `fetch` throws one. */
export function connectionFailure(): Error {
  return new TypeError('fetch failed', { cause: new Error('ECONNREFUSED') });
}

/** A timeout, as `AbortSignal.timeout` aborts one. */
export function timeoutFailure(): Error {
  const error = new Error('This operation was aborted');

  error.name = 'TimeoutError';

  return error;
}

/**
 * Awaits a promise expected to reject, and returns the error narrowed to `T`.
 *
 * `promise.catch((e: T) => e)` would type the result as `T | <resolved value>`, which makes
 * every assertion on the error's own fields a type error.
 */
export async function rejection<T>(promise: Promise<unknown>): Promise<T> {
  try {
    await promise;
  } catch (error) {
    return error as T;
  }

  throw new Error('Expected the call to reject, but it resolved.');
}

/**
 * Builds a client against a stub.
 *
 * Backoff is stubbed to zero so the retry tests do not spend real seconds asleep; the backoff
 * calculation itself is tested on its own.
 */
export function makeClient(stub: FetchStub, options: Partial<DregsOptions> = {}): Dregs {
  vi.spyOn(Dregs.prototype as unknown as { backoff: () => number }, 'backoff').mockReturnValue(0);

  return new Dregs({
    secretKey: SECRET_KEY,
    baseUrl: BASE_URL,
    maxRetries: 0,
    fetch: stub.fetch,
    ...options,
  });
}
