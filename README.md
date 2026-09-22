# Dregs TypeScript SDK

[![npm](https://img.shields.io/npm/v/dregs.svg)](https://www.npmjs.com/package/dregs)
[![Node](https://img.shields.io/node/v/dregs.svg)](https://www.npmjs.com/package/dregs)
[![License](https://img.shields.io/npm/l/dregs.svg)](LICENSE)

The official TypeScript client for [Dregs](https://dregs.com), which scores the users of your application
for fraud and abuse across four categories: humanity, authenticity, uniqueness, and behavior.

Send events from your backend, read back the scores and the observations behind them.

```bash
npm install dregs
```

Node 20 or newer. No runtime dependencies: the SDK calls the runtime's own `fetch`.

## Getting started

You need the **secret key** from an API credential, which you will find under **Settings → Credentials**
in the Dregs dashboard. It starts with `sk_`. The `pk_` public key is for the browser tracker and cannot
read identities or scores.

```ts
import { Dregs } from 'dregs';

const client = new Dregs({ secretKey: process.env.DREGS_SECRET_KEY });
```

The key is read from `DREGS_SECRET_KEY` when you do not pass one, so `new Dregs()` on its own is usually
enough. Build one at startup and keep it; there is nothing to close.

CommonJS works too:

```js
const { Dregs } = require('dregs');
```

## Tracking events

```ts
await client.track('user.signup', {
  identity: 'user_12345',
  data: { plan: 'pro', referrer: 'partner-x' },
  identityData: { email: 'ada@example.com', name: 'Ada Lovelace' },
});
```

`identity` is your own id for the user — the same one you pass to `dregs.identify()` in the browser
tracker, and the one you look scores up by. It is required: a server-side event carries no device
signature, so the identity is the only thing tying the event to a user.

`identityData` carries attributes of the _user_ rather than the event. The analyzers lean on these
heavily, so send them whenever you have them. Name the keys the way your application already does and
map them to Dregs's canonical fields under **Settings → Mappings**; the same goes for event names.

### Idempotency

Every event is sent with an `id`, which makes ingestion idempotent: reposting the same id returns the
original event instead of recording a second one. Pass the id your application already has, and a retry
after a timeout can never double-count.

```ts
await client.track('purchase', { identity: 'user_12345', eventId: `order-${order.id}` });
```

When you omit it the SDK generates one, which is what makes its own retries safe.

### What comes back

```ts
const result = await client.track('user.signup', { identity: 'user_12345' });

result.accepted; // true when Dregs recorded the event
result.id; // the event's id
```

`accepted` is `false` in the uncommon case where Dregs accepts the request without recording
an event. Failures that are yours to act on throw instead — see [Errors](#errors).

## Reading scores

```ts
const scores = await client.identities.scores('user_12345');

scores.humanity; // 85
scores.authenticity; // 72
scores.uniqueness; // 91
scores.behavior; // 68
```

This is the cheap read and the one most integrations want. A category Dregs has not scored yet reads as
`null`, and a brand-new identity comes back empty. `Scores` is an array, so you can iterate, map, and
destructure it as usual.

Scoring is **asynchronous**. Scores appear moments after the events that move them, not in the same
breath, so read them at a decision point rather than immediately after a `track()` call.

```ts
if (scores.authenticity !== null && scores.authenticity < 40) {
  await holdForReview('user_12345');
}
```

### Seeing exactly why

The scores are the summary; the observations are the evidence. When you need to show or log _why_ an
identity scored the way it did, ask for the analysis.

```ts
const analysis = await client.identities.analysis('user_12345');

for (const observation of analysis.observations) {
  console.log(`${observation.label}: ${observation.explanation} (value ${observation.value})`);
}
```

Each observation carries the analyzer that produced it, a `value` from 0.0 (suspicious) to 1.0
(legitimate), a `confidence`, a `weight`, and the counts behind the finding in `metadata`. `analysis()`
throws `NotFoundError` until the identity has been analyzed at least once.

### The whole identity

```ts
const identity = await client.identities.get('user_12345');

identity.displayEmail; // "ada@example.com"
identity.humanityScore; // 85
identity.badges; // [{ name: "Account Takeover Suspected", ... }]
identity.data; // every attribute you have sent
```

### Forcing a rescore

```ts
await client.identities.analyze('user_12345');
```

This queues the work and resolves; it does not wait for the cycle to finish. Dregs rescores on its own
as events arrive, so you rarely need this outside of a support or backfill flow.

## Errors

```ts
import { DregsError, NotFoundError, QuotaExceededError, RateLimitError } from 'dregs';

try {
  await client.track('user.signup', { identity: 'user_12345' });
} catch (error) {
  if (error instanceof QuotaExceededError) {
    // over the monthly event limit; the event was not queued
  } else if (error instanceof RateLimitError) {
    // ingesting too fast; error.retryAfter when the server said how long
  } else if (error instanceof DregsError) {
    // anything else this library throws
  } else {
    throw error;
  }
}
```

| Error                   | When                                               |
| ----------------------- | -------------------------------------------------- |
| `BadRequestError`       | 400, the event was malformed                       |
| `AuthenticationError`   | 401, the secret key was not recognized             |
| `QuotaExceededError`    | 402, the account is over its monthly event limit   |
| `PermissionDeniedError` | 403, the credential may not do this                |
| `NotFoundError`         | 404, no such identity, or it has not been analyzed |
| `RateLimitError`        | 429, too many requests                             |
| `ServerError`           | 5xx                                                |
| `DregsTimeoutError`     | the request timed out                              |
| `DregsConnectionError`  | the request never reached Dregs                    |

All of them derive from `DregsError`. Those that reached the API also carry `statusCode`, `body`, and
`requestId`; `error.message` is the message the API sent, and `error.toString()` prefixes it with the
status and the request id, which is the form worth putting in a log line.

Arguments the SDK can reject without asking Dregs — a missing identity, an event id over 64 characters,
a `pk_` key — throw a plain `TypeError` before anything is sent.

### Retries

Connection failures, timeouts, 408s, 429s, and 5xx are retried automatically with exponential backoff and
full jitter, honouring `Retry-After` when the server sends one. Two retries by default:

```ts
const client = new Dregs({ maxRetries: 5 }); // or 0 to handle it yourself
```

## Promises, not an async twin

There is one `Dregs` class and every method returns a promise. JavaScript has no meaningful sync/async
split, so unlike the Python SDK there is no async client to choose between — `await` everything.

## Webhooks

Dregs signs every webhook with the channel's signing secret. Verify it against the **raw request body**
before acting on the payload — a re-serialized object will not match, because key order and whitespace
change.

```ts
import express from 'express';
import { verifyWebhook, WebhookVerificationError } from 'dregs/webhooks';

app.post('/webhooks/dregs', express.raw({ type: 'application/json' }), (req, res) => {
  let event;

  try {
    event = verifyWebhook({
      payload: req.body, // the Buffer, not req.body parsed as JSON
      signature: req.header('X-Dregs-Signature') ?? '',
      secret: process.env.DREGS_WEBHOOK_SECRET!,
    });
  } catch (error) {
    if (error instanceof WebhookVerificationError) {
      return res.sendStatus(400);
    }

    throw error;
  }

  handle(event);

  res.sendStatus(204);
});
```

`express.raw()` matters: the default `express.json()` hands you a parsed object and the original bytes are
gone. The helpers are exported from the package root as well, so `import { verifyWebhook } from 'dregs'`
works if you would rather not reach for the subpath.

`verifyWebhook` also rejects payloads older than five minutes as replays; pass `tolerance: null` to skip
that if you are deduplicating on the event id yourself. The signing secret is shown once, when you create
the webhook channel, and is not your API secret key.

## Configuration

```ts
const client = new Dregs({
  secretKey: undefined, // defaults to $DREGS_SECRET_KEY
  baseUrl: undefined, // defaults to $DREGS_BASE_URL, then https://dregs.com/api
  timeout: 10_000, // milliseconds
  maxRetries: 2,
  fetch: undefined, // bring your own fetch for a proxy agent, custom TLS, or instrumentation
});
```

## Type checking

The package ships generated declarations for both the ESM and CommonJS entry points, so there is no
`@types/dregs` to install and every public type is exported. Responses are plain readonly objects; each
one also keeps the body it was built from in `raw`, so a field Dregs adds after this release is reachable
without waiting for an SDK upgrade.

```ts
import type { Analysis, Category, Identity, Observation, Score, TrackResult } from 'dregs';
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). The short version:

```bash
npm ci
npm test
npm run lint
npm run typecheck
npm run build
```

`npm ci` installs exactly what `package-lock.json` pins and fails if the lock is out of step, so the same
commands produce the same environment locally and in CI.

## Links

- [Dregs manual](https://dregs.com/manual/) and [REST API reference](https://dregs.com/manual/api/)
- [Dregs MCP server](https://github.com/dregs-sdk/dregs-mcp), for connecting AI agents to your data
- [Security policy](SECURITY.md)

## License

MIT. See [LICENSE](LICENSE).
