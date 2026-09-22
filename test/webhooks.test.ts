/** Webhook signature verification. */

import { createHmac } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { WebhookVerificationError } from '../src/errors.js';
import { computeWebhookSignature, verifyWebhook, verifyWebhookSignature } from '../src/webhooks.js';

const SECRET = 'whsec_abc123';
const SENT_AT = new Date('2026-09-21T14:22:09Z');

function payload(overrides: Record<string, unknown> = {}): Buffer {
  return Buffer.from(
    JSON.stringify({
      event: 'ESCALATION_CREATED',
      timestamp: '2026-09-21T14:22:09Z',
      identityId: 'user_12345',
      ...overrides,
    }),
    'utf8',
  );
}

function sign(body: Buffer | string, secret = SECRET): string {
  return createHmac('sha256', secret).update(body).digest('hex');
}

function at(offsetSeconds: number): Date {
  return new Date(SENT_AT.getTime() + offsetSeconds * 1000);
}

describe('computeWebhookSignature', () => {
  it('matches a hand-rolled HMAC', () => {
    const body = payload();

    expect(computeWebhookSignature(body, SECRET)).toBe(sign(body));
  });

  it('hashes a string body as UTF-8', () => {
    const body = payload();

    expect(computeWebhookSignature(body.toString('utf8'), SECRET)).toBe(
      computeWebhookSignature(body, SECRET),
    );
  });

  it('hashes a Uint8Array the same as a Buffer', () => {
    const body = payload();

    expect(computeWebhookSignature(new Uint8Array(body), SECRET)).toBe(sign(body));
  });
});

describe('verifyWebhookSignature', () => {
  it('accepts a good signature', () => {
    const body = payload();

    expect(verifyWebhookSignature(body, sign(body), SECRET)).toBe(true);
  });

  it('tolerates surrounding whitespace on the header', () => {
    const body = payload();

    expect(verifyWebhookSignature(body, `  ${sign(body)}\n`, SECRET)).toBe(true);
  });

  it('rejects a tampered body', () => {
    const signature = sign(payload());

    expect(verifyWebhookSignature(payload({ identityId: 'someone_else' }), signature, SECRET)).toBe(
      false,
    );
  });

  it('rejects the wrong secret', () => {
    const body = payload();

    expect(verifyWebhookSignature(body, sign(body, 'whsec_other'), SECRET)).toBe(false);
  });

  it('rejects an empty signature', () => {
    expect(verifyWebhookSignature(payload(), '', SECRET)).toBe(false);
  });

  it('rejects an empty secret', () => {
    const body = payload();

    expect(verifyWebhookSignature(body, sign(body), '')).toBe(false);
  });

  it('rejects a signature of the wrong length without throwing', () => {
    // timingSafeEqual throws on a length mismatch, so the guard in front of it is load-bearing.
    expect(verifyWebhookSignature(payload(), 'abc123', SECRET)).toBe(false);
  });

  it('rejects a re-serialized body, which is the mistake worth catching', () => {
    const received = payload();
    const reserialized = Buffer.from(
      JSON.stringify(JSON.parse(received.toString('utf8')), null, 2),
      'utf8',
    );

    expect(verifyWebhookSignature(reserialized, sign(received), SECRET)).toBe(false);
  });
});

describe('verifyWebhook', () => {
  it('returns the parsed event', () => {
    const body = payload();

    const event = verifyWebhook({
      payload: body,
      signature: sign(body),
      secret: SECRET,
      now: SENT_AT,
    });

    expect(event.event).toBe('ESCALATION_CREATED');
    expect(event.identityId).toBe('user_12345');
  });

  it('throws on a bad signature', () => {
    expect(() =>
      verifyWebhook({
        payload: payload(),
        signature: 'deadbeef',
        secret: SECRET,
        now: SENT_AT,
      }),
    ).toThrow(WebhookVerificationError);
  });

  it('throws on a body that is not JSON', () => {
    const body = Buffer.from('not json at all', 'utf8');

    expect(() => verifyWebhook({ payload: body, signature: sign(body), secret: SECRET })).toThrow(
      /not valid JSON/,
    );
  });

  it('throws on a JSON array body', () => {
    const body = Buffer.from('[1, 2, 3]', 'utf8');

    expect(() => verifyWebhook({ payload: body, signature: sign(body), secret: SECRET })).toThrow(
      /not a JSON object/,
    );
  });

  it('refuses a stale payload as a replay', () => {
    const body = payload();

    expect(() =>
      verifyWebhook({ payload: body, signature: sign(body), secret: SECRET, now: at(3600) }),
    ).toThrow(/replay/);
  });

  it('refuses a payload from the future too', () => {
    const body = payload();

    expect(() =>
      verifyWebhook({ payload: body, signature: sign(body), secret: SECRET, now: at(-3600) }),
    ).toThrow(/replay/);
  });

  it('accepts a payload inside the tolerance', () => {
    const body = payload();

    const event = verifyWebhook({
      payload: body,
      signature: sign(body),
      secret: SECRET,
      now: at(120),
    });

    expect(event.event).toBe('ESCALATION_CREATED');
  });

  it('honours a tighter tolerance', () => {
    const body = payload();

    expect(() =>
      verifyWebhook({
        payload: body,
        signature: sign(body),
        secret: SECRET,
        tolerance: 30,
        now: at(120),
      }),
    ).toThrow(/replay/);
  });

  it('can have the freshness check waived', () => {
    const body = payload();

    const event = verifyWebhook({
      payload: body,
      signature: sign(body),
      secret: SECRET,
      tolerance: null,
      now: at(86_400 * 30),
    });

    expect(event.event).toBe('ESCALATION_CREATED');
  });

  it('throws on a missing timestamp unless the check is waived', () => {
    const body = Buffer.from(JSON.stringify({ event: 'ESCALATION_CREATED' }), 'utf8');

    expect(() => verifyWebhook({ payload: body, signature: sign(body), secret: SECRET })).toThrow(
      /no timestamp/,
    );

    expect(
      verifyWebhook({ payload: body, signature: sign(body), secret: SECRET, tolerance: null })
        .event,
    ).toBe('ESCALATION_CREATED');
  });

  it('throws on an unreadable timestamp', () => {
    const body = payload({ timestamp: 'the day before yesterday' });

    expect(() => verifyWebhook({ payload: body, signature: sign(body), secret: SECRET })).toThrow(
      /unreadable/,
    );
  });

  it('accepts a string payload', () => {
    const body = payload().toString('utf8');

    const event = verifyWebhook({
      payload: body,
      signature: sign(body),
      secret: SECRET,
      now: SENT_AT,
    });

    expect(event.event).toBe('ESCALATION_CREATED');
  });

  it('is catchable as the SDK base error', () => {
    try {
      verifyWebhook({ payload: payload(), signature: 'nope', secret: SECRET });

      expect.unreachable('verification should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(WebhookVerificationError);
      expect((error as Error).name).toBe('WebhookVerificationError');
    }
  });
});
