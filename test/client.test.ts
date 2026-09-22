/** Client construction, configuration, and the track() request body. */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { DEFAULT_BASE_URL, Dregs } from '../src/client.js';

import { BASE_URL, SECRET_KEY, json, makeClient, stubFetch } from './helpers.js';

const ACCEPTED = json(200, { status: 'success', id: 'evt_1', fingerprint: null });

describe('construction', () => {
  const saved = { ...process.env };

  beforeEach(() => {
    delete process.env.DREGS_SECRET_KEY;
    delete process.env.DREGS_BASE_URL;
  });

  afterEach(() => {
    process.env = { ...saved };
  });

  it('reads the secret key from the environment', () => {
    process.env.DREGS_SECRET_KEY = SECRET_KEY;

    expect(new Dregs().baseUrl).toBe(DEFAULT_BASE_URL);
  });

  it('reads the base url from the environment', () => {
    process.env.DREGS_BASE_URL = 'https://staging.example.com/api';

    expect(new Dregs({ secretKey: SECRET_KEY }).baseUrl).toBe('https://staging.example.com/api');
  });

  it('prefers an explicit base url over the environment', () => {
    process.env.DREGS_BASE_URL = 'https://staging.example.com/api';

    expect(new Dregs({ secretKey: SECRET_KEY, baseUrl: BASE_URL }).baseUrl).toBe(BASE_URL);
  });

  it('does not double up a trailing slash on the base url', () => {
    expect(new Dregs({ secretKey: SECRET_KEY, baseUrl: `${BASE_URL}/` }).baseUrl).toBe(BASE_URL);
  });

  it('names the environment variable when no key is found', () => {
    expect(() => new Dregs()).toThrow(/DREGS_SECRET_KEY/);
  });

  it('refuses a public key with an explanation', () => {
    expect(() => new Dregs({ secretKey: 'pk_abcdefghQijklmQabcdefghijklmn' })).toThrow(
      /public key/,
    );
  });

  it('refuses a negative retry count', () => {
    expect(() => new Dregs({ secretKey: SECRET_KEY, maxRetries: -1 })).toThrow(/maxRetries/);
  });

  it('refuses a non-positive timeout', () => {
    expect(() => new Dregs({ secretKey: SECRET_KEY, timeout: 0 })).toThrow(/timeout/);
  });

  it('defaults the retry count and the timeout', () => {
    const client = new Dregs({ secretKey: SECRET_KEY });

    expect(client.maxRetries).toBe(2);
    expect(client.timeout).toBe(10_000);
  });
});

describe('the track request', () => {
  it('sends the documented body', async () => {
    const stub = stubFetch(ACCEPTED);

    await makeClient(stub).track('user.signup', {
      identity: 'user_12345',
      data: { plan: 'pro' },
      identityData: { email: 'ada@example.com' },
      eventId: 'signup-991',
    });

    expect(stub.lastCall().url).toBe(`${BASE_URL}/events`);
    expect(stub.lastBody()).toEqual({
      id: 'signup-991',
      type: 'user.signup',
      data: { plan: 'pro' },
      identity: { id: 'user_12345', data: { email: 'ada@example.com' } },
      source: 'node-sdk',
    });
  });

  it('authorizes with the secret key', async () => {
    const stub = stubFetch(ACCEPTED);

    await makeClient(stub).track('user.signup', { identity: 'user_12345' });

    const headers = stub.lastCall().init.headers as Record<string, string>;

    expect(headers.Authorization).toBe(`Bearer ${SECRET_KEY}`);
    expect(headers['User-Agent']).toMatch(/^dregs-node\/\d+\.\d+\.\d+ \(node /);
    expect(headers['Content-Type']).toBe('application/json');
  });

  it('sends empty objects when no data is given', async () => {
    const stub = stubFetch(ACCEPTED);

    await makeClient(stub).track('user.signup', { identity: 'user_12345' });

    expect(stub.lastBody().data).toEqual({});
    expect(stub.lastBody().identity).toEqual({ id: 'user_12345', data: {} });
  });

  it('generates an event id so retries are idempotent', async () => {
    const stub = stubFetch(ACCEPTED);
    const client = makeClient(stub);

    await client.track('user.signup', { identity: 'user_12345' });
    await client.track('user.signup', { identity: 'user_12345' });

    const first = stub.bodyAt(0).id as string;
    const second = stub.bodyAt(1).id as string;

    expect(first).toBeTruthy();
    expect(first).not.toBe(second);
    expect(first.startsWith('dregs-')).toBe(false);
    expect(first.length).toBeLessThanOrEqual(64);
  });

  it('accepts an overriding source', async () => {
    const stub = stubFetch(ACCEPTED);

    await makeClient(stub).track('user.signup', { identity: 'user_12345', source: 'billing-job' });

    expect(stub.lastBody().source).toBe('billing-job');
  });

  it('sends a Date timestamp as UTC', async () => {
    const stub = stubFetch(ACCEPTED);

    await makeClient(stub).track('user.signup', {
      identity: 'user_12345',
      timestamp: new Date(Date.UTC(2026, 8, 21, 14, 22, 9)),
    });

    expect(stub.lastBody().timestamp).toBe('2026-09-21T14:22:09Z');
  });

  it('accepts an ISO-8601 string timestamp', async () => {
    const stub = stubFetch(ACCEPTED);

    await makeClient(stub).track('user.signup', {
      identity: 'user_12345',
      timestamp: '2026-09-21T14:22:09Z',
    });

    expect(stub.lastBody().timestamp).toBe('2026-09-21T14:22:09Z');
  });

  it('refuses an unreadable timestamp', async () => {
    const stub = stubFetch(ACCEPTED);

    await expect(
      makeClient(stub).track('user.signup', {
        identity: 'user_12345',
        timestamp: 'the day before yesterday',
      }),
    ).rejects.toThrow(/not a valid date/);

    expect(stub.callCount).toBe(0);
  });

  it('omits the timestamp when the caller does', async () => {
    const stub = stubFetch(ACCEPTED);

    await makeClient(stub).track('user.signup', { identity: 'user_12345' });

    expect(stub.lastBody()).not.toHaveProperty('timestamp');
  });

  it('refuses an empty identity before any request', async () => {
    const stub = stubFetch(ACCEPTED);

    await expect(makeClient(stub).track('user.signup', { identity: '' })).rejects.toThrow(
      /identity is required/,
    );

    expect(stub.callCount).toBe(0);
  });

  it('refuses an empty event type', async () => {
    const stub = stubFetch(ACCEPTED);

    await expect(makeClient(stub).track('', { identity: 'user_12345' })).rejects.toThrow(
      /event type is required/,
    );
  });

  it('refuses a reserved event id', async () => {
    const stub = stubFetch(ACCEPTED);

    await expect(
      makeClient(stub).track('user.signup', { identity: 'user_12345', eventId: 'dregs-1234' }),
    ).rejects.toThrow(/reserved/);
  });

  it('refuses an overlong event id', async () => {
    const stub = stubFetch(ACCEPTED);

    await expect(
      makeClient(stub).track('user.signup', { identity: 'user_12345', eventId: 'x'.repeat(65) }),
    ).rejects.toThrow(/64 characters/);
  });
});

describe('the track response', () => {
  it('reports an accepted event', async () => {
    const result = await makeClient(stubFetch(ACCEPTED)).track('user.signup', {
      identity: 'user_12345',
    });

    expect(result.accepted).toBe(true);
    expect(result.id).toBe('evt_1');
    expect(result.status).toBe('success');
    expect(result.fingerprint).toBeNull();
  });

  it('does not accept a quiet rejection', async () => {
    const result = await makeClient(
      stubFetch(json(200, { status: 'success', id: null, fingerprint: null })),
    ).track('user.signup', { identity: 'user_12345' });

    expect(result.accepted).toBe(false);
    expect(result.id).toBeNull();
    expect(result.status).toBe('success');
  });

  it('keeps the raw body for anything the SDK does not model', async () => {
    const result = await makeClient(
      stubFetch(json(200, { status: 'success', id: 'evt_1', queuedBehind: 3 })),
    ).track('user.signup', { identity: 'user_12345' });

    expect(result.raw.queuedBehind).toBe(3);
  });
});

describe('bringing your own fetch', () => {
  it('calls the supplied fetch rather than the global one', async () => {
    const stub = stubFetch(ACCEPTED);

    await makeClient(stub).track('user.signup', { identity: 'user_12345' });

    expect(stub.callCount).toBe(1);
  });

  it('passes an abort signal so the timeout can fire', async () => {
    const stub = stubFetch(ACCEPTED);

    await makeClient(stub, { timeout: 1234 }).track('user.signup', { identity: 'user_12345' });

    expect(stub.lastCall().init.signal).toBeInstanceOf(AbortSignal);
  });
});
