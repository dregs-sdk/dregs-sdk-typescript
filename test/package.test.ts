/** The published surface: the version constant, and what the entry points export. */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import * as root from '../src/index.js';
import { VERSION } from '../src/version.js';
import * as webhooks from '../src/webhooks.js';

const manifest = JSON.parse(
  readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'),
) as { name: string; version: string; dependencies?: Record<string, string> };

describe('the package', () => {
  it('keeps the version constant in step with package.json', () => {
    expect(VERSION).toBe(manifest.version);
  });

  it('has no runtime dependencies', () => {
    expect(manifest.dependencies ?? {}).toEqual({});
  });

  it('exports every error class from the root', () => {
    for (const name of [
      'DregsError',
      'DregsAPIError',
      'DregsConnectionError',
      'DregsTimeoutError',
      'BadRequestError',
      'AuthenticationError',
      'QuotaExceededError',
      'PermissionDeniedError',
      'NotFoundError',
      'RateLimitError',
      'ServerError',
      'WebhookVerificationError',
    ]) {
      expect(root, `${name} should be exported from the root`).toHaveProperty(name);
    }
  });

  it('re-exports the webhook helpers from the root', () => {
    expect(root.verifyWebhook).toBe(webhooks.verifyWebhook);
    expect(root.verifyWebhookSignature).toBe(webhooks.verifyWebhookSignature);
    expect(root.computeWebhookSignature).toBe(webhooks.computeWebhookSignature);
  });
});
