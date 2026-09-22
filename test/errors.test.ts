/** Status codes map to typed errors, and failed requests are retried. */

import { describe, expect, it } from 'vitest';

import { Dregs } from '../src/client.js';
import {
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
} from '../src/errors.js';

import {
  SECRET_KEY,
  connectionFailure,
  empty,
  errorBody,
  json,
  makeClient,
  rejection,
  stubFetch,
  text,
  timeoutFailure,
} from './helpers.js';

const IDENTITY = json(200, { id: 'user_12345' });
const ACCEPTED = json(200, { status: 'success', id: 'evt_1' });

const STATUS_CASES: [number, new (...args: never[]) => DregsAPIError][] = [
  [400, BadRequestError],
  [401, AuthenticationError],
  [402, QuotaExceededError],
  [403, PermissionDeniedError],
  [404, NotFoundError],
  [429, RateLimitError],
  [500, ServerError],
  [503, ServerError],
];

describe('status mapping', () => {
  it.each(STATUS_CASES)('raises its own error for %i', async (status, expected) => {
    const client = makeClient(stubFetch(json(status, errorBody(status, 'No'))));

    const error = await rejection<DregsAPIError>(client.identities.get('user_12345'));

    expect(error).toBeInstanceOf(expected);
    expect(error.statusCode).toBe(status);
  });

  it('leaves an unmapped 4xx as the base API error', async () => {
    const client = makeClient(stubFetch(json(418, errorBody(418, 'No'))));

    await expect(client.identities.get('user_12345')).rejects.toBeInstanceOf(DregsAPIError);
  });

  it('is catchable as the base class', async () => {
    const client = makeClient(stubFetch(empty(404)));

    await expect(client.identities.get('user_12345')).rejects.toBeInstanceOf(DregsError);
  });

  it('carries the API message through to the exception', async () => {
    const client = makeClient(stubFetch(json(404, errorBody(404, 'Not Found'))));

    await expect(client.identities.get('user_12345')).rejects.toThrow('Not Found');
  });

  it('formats the status and the request id into toString', async () => {
    const client = makeClient(
      stubFetch(json(500, errorBody(500, 'Boom'), { 'X-Request-Id': 'req_abc' })),
    );

    const error = await rejection<ServerError>(client.identities.get('user_12345'));

    expect(error.requestId).toBe('req_abc');
    expect(error.toString()).toBe('ServerError: HTTP 500: Boom (request req_abc)');
  });

  it('leaves the request id null when the response carried none', async () => {
    const client = makeClient(stubFetch(json(500, errorBody(500, 'Boom'))));

    const error = await rejection<ServerError>(client.identities.get('user_12345'));

    expect(error.requestId).toBeNull();
    expect(error.toString()).toBe('ServerError: HTTP 500: Boom');
  });

  it('keeps the parsed body on the exception', async () => {
    const client = makeClient(stubFetch(json(400, errorBody(400, 'Bad'))));

    const error = await rejection<BadRequestError>(client.identities.get('user_12345'));

    expect((error.body as Record<string, unknown>).message).toBe('Bad');
  });

  it('still raises the right class for a non-JSON error', async () => {
    const client = makeClient(stubFetch(text(502, '<html>gateway</html>')));

    const error = await rejection<ServerError>(client.identities.get('user_12345'));

    expect(error).toBeInstanceOf(ServerError);
    expect(error.body).toBeNull();
  });
});

describe('rate limits and quotas', () => {
  it('exposes Retry-After', async () => {
    const client = makeClient(
      stubFetch(json(429, { status: 'rate_limited' }, { 'Retry-After': '2' })),
    );

    const error = await rejection<RateLimitError>(
      client.track('user.signup', { identity: 'user_12345' }),
    );

    expect(error).toBeInstanceOf(RateLimitError);
    expect(error.retryAfter).toBe(2);
  });

  it('ignores a Retry-After given as an HTTP date', async () => {
    const client = makeClient(
      stubFetch(json(429, {}, { 'Retry-After': 'Wed, 21 Sep 2026 14:22:09 GMT' })),
    );

    const error = await rejection<RateLimitError>(
      client.track('user.signup', { identity: 'user_12345' }),
    );

    expect(error.retryAfter).toBeNull();
  });

  it('raises a rate limit reported in a 200 body', async () => {
    // Older API builds answered the ingestion limit with HTTP 200 and a body status.
    const client = makeClient(stubFetch(json(200, { status: 'rate_limited', id: null })));

    await expect(client.track('user.signup', { identity: 'user_12345' })).rejects.toBeInstanceOf(
      RateLimitError,
    );
  });

  it('raises a quota reported in a 200 body', async () => {
    const client = makeClient(stubFetch(json(200, { status: 'quota_exceeded', id: null })));

    const error = await rejection<QuotaExceededError>(
      client.track('user.signup', { identity: 'user_12345' }),
    );

    expect(error).toBeInstanceOf(QuotaExceededError);
    expect(error.statusCode).toBe(402);
  });
});

describe('retries', () => {
  it('retries a server error and can succeed', async () => {
    const stub = stubFetch(empty(503), IDENTITY);
    const client = makeClient(stub, { maxRetries: 2 });

    expect((await client.identities.get('user_12345')).id).toBe('user_12345');
    expect(stub.callCount).toBe(2);
  });

  it('stops at the configured limit', async () => {
    const stub = stubFetch(empty(500));
    const client = makeClient(stub, { maxRetries: 2 });

    await expect(client.identities.get('user_12345')).rejects.toBeInstanceOf(ServerError);
    expect(stub.callCount).toBe(3); // the first attempt plus two retries
  });

  it('retries a rate limit', async () => {
    const stub = stubFetch(json(429, {}, { 'Retry-After': '0' }), ACCEPTED);
    const client = makeClient(stub, { maxRetries: 2 });

    expect((await client.track('user.signup', { identity: 'user_12345' })).accepted).toBe(true);
    expect(stub.callCount).toBe(2);
  });

  it('retries a 408', async () => {
    const stub = stubFetch(empty(408), IDENTITY);
    const client = makeClient(stub, { maxRetries: 1 });

    await client.identities.get('user_12345');

    expect(stub.callCount).toBe(2);
  });

  it('keeps the event id across a retry so ingestion stays idempotent', async () => {
    const stub = stubFetch(empty(503), ACCEPTED);
    const client = makeClient(stub, { maxRetries: 2 });

    await client.track('user.signup', { identity: 'user_12345' });

    expect(stub.callCount).toBe(2);
    expect(stub.bodyAt(0).id).toBe(stub.bodyAt(1).id);
  });

  it('does not retry a client error', async () => {
    const stub = stubFetch(empty(404));
    const client = makeClient(stub, { maxRetries: 2 });

    await expect(client.identities.get('user_12345')).rejects.toBeInstanceOf(NotFoundError);
    expect(stub.callCount).toBe(1);
  });

  it('does not retry at all when retries are turned off', async () => {
    const stub = stubFetch(empty(500));
    const client = makeClient(stub, { maxRetries: 0 });

    await expect(client.identities.get('user_12345')).rejects.toBeInstanceOf(ServerError);
    expect(stub.callCount).toBe(1);
  });

  it('retries a connection failure and then raises', async () => {
    const stub = stubFetch(connectionFailure());
    const client = makeClient(stub, { maxRetries: 2 });

    await expect(client.identities.get('user_12345')).rejects.toBeInstanceOf(DregsConnectionError);
    expect(stub.callCount).toBe(3);
  });

  it('recovers when a retry after a connection failure lands', async () => {
    const stub = stubFetch(connectionFailure(), IDENTITY);
    const client = makeClient(stub, { maxRetries: 2 });

    expect((await client.identities.get('user_12345')).id).toBe('user_12345');
  });

  it('raises its own error for a timeout', async () => {
    const client = makeClient(stubFetch(timeoutFailure()));

    const error = await rejection<DregsError>(client.identities.get('user_12345'));

    expect(error).toBeInstanceOf(DregsTimeoutError);
    expect(error).toBeInstanceOf(DregsConnectionError);
  });
});

describe('backoff', () => {
  class Exposed extends Dregs {
    public delay(attempt: number, retryAfter: number | null): number {
      return this.backoff(attempt, retryAfter);
    }
  }

  const client = new Exposed({ secretKey: SECRET_KEY, fetch: stubFetch().fetch });

  it('honours Retry-After ahead of its own schedule', () => {
    expect(client.delay(0, 3)).toBe(3000);
  });

  it('caps a preposterous Retry-After', () => {
    expect(client.delay(0, 86_400)).toBe(60_000);
  });

  it('grows with the attempt and stays jittered below the ceiling', () => {
    for (const attempt of [0, 1, 2, 3]) {
      const delay = client.delay(attempt, null);

      expect(delay).toBeGreaterThanOrEqual(0);
      expect(delay).toBeLessThanOrEqual(Math.min(500 * 2 ** attempt, 8000));
    }

    expect(client.delay(20, null)).toBeLessThanOrEqual(8000);
  });
});
