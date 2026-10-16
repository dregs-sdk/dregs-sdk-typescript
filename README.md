# Dregs TypeScript SDK

[![npm](https://img.shields.io/npm/v/@dregs/sdk.svg)](https://www.npmjs.com/package/@dregs/sdk)
[![Node](https://img.shields.io/node/v/@dregs/sdk.svg)](https://www.npmjs.com/package/@dregs/sdk)
[![License](https://img.shields.io/npm/l/@dregs/sdk.svg)](LICENSE)

The official TypeScript client for [Dregs](https://dregs.com), which scores the users of your application
for fraud and abuse across four categories: humanity, authenticity, uniqueness, and behavior.

Send events from your backend, read back the scores and the observations behind them.

```bash
npm install @dregs/sdk
```

Node 20 or newer. No runtime dependencies: the SDK calls the runtime's own `fetch`.

> This is the **server-side** SDK, which authenticates with a secret key and can read scores.
> The browser tracking script is a separate package, [`dregs`](https://www.npmjs.com/package/dregs),
> and uses the public key. You will usually want both: the tracker in the browser, this on your
> backend.

## Getting started

You need the **secret key** from an API credential, which you will find under **Settings → Credentials**
in the Dregs dashboard. It starts with `sk_`. The `pk_` public key is for the browser tracker and cannot
read identities or scores.

```ts
import { Dregs } from '@dregs/sdk';

const client = new Dregs({ secretKey: process.env.DREGS_SECRET_KEY });
```

The key is read from `DREGS_SECRET_KEY` when you do not pass one, so `new Dregs()` on its own is usually
enough. Build one at startup and keep it; there is nothing to close.

CommonJS works too:

```js
const { Dregs } = require('@dregs/sdk');
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

### Groups

If your application groups users into organizations, teams, workspaces, or the like, pass the groups the
user is acting in. Dregs records each group and makes the identity a member of it. Each group has your
own `id`, a `type` that is your own name for the kind of group (`"organization"` when omitted), and
optional `data` that Dregs merges into the group, so later events can send the type and id alone. Dregs
normalizes types to lower_snake_case, so `ParentCompany` and `parent-company` are the same type, and an
event can carry one group of each type.

```ts
await client.track('user.login', {
  identity: 'user_12345',
  groups: [
    { type: 'organization', id: 'org_678', data: { name: 'Acme Inc', plan: 'enterprise' } },
    { type: 'team', id: 'team_42', data: { name: 'Payments' } },
  ],
});
```

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

### History, links, and past cycles

```ts
for (const entry of await client.identities.history('user_12345', { limit: 10 })) {
  console.log(entry.cycleId, entry.finishedAt, entry.humanity, entry.behavior);
}

const older = await client.identities.analysis('user_12345', 2000871); // a past cycle, by its cycleId

for (const link of await client.identities.links('user_12345')) {
  console.log(link.identityId, link.type, link.explanation); // e.g. "user_999", "SAME_DEVICE"
}
```

### Disregarding an identity

Leave your own staff and test accounts out of scoring and escalations:

```ts
await client.identities.update('qa_bot_7', { disregarded: true });
```

### Asking for a review

When a score looks wrong, Dregs's AI reviewer will look over the analysis and say why. The review runs
in the background, so read it back later with `reviews()`.

```ts
const review = await client.identities.review('user_12345', {
  feedback: 'This is a long-standing customer.',
});

review.status; // "PENDING", then "FINISHED"
```

## Listing and paging

Every namespace with a `list()` returns one `Page` at a time, numbered from 0, and a `listAll()` that
walks every page for you with `for await`:

```ts
const page = await client.identities.list({ term: 'example.com', pageSize: 50 });

page.items; // the identities on this page; the page itself is iterable too
page.totalElements; // how many match in all
page.hasNext; // whether another page follows

for await (const identity of client.identities.listAll({
  group: 'org_678',
  sort: 'humanityScore',
  order: 'asc',
})) {
  // ...
}
```

Filters you leave out are not sent. A page holds at most 100 items.

## Groups

`track()` records groups and memberships as events arrive. The `groups` namespace reads them back, and
keeps Dregs in step when something changes outside an event, such as a user leaving a team:

```ts
await client.groups.create('org_678', { attributes: { name: 'Acme Inc', plan: 'enterprise' } });

const group = await client.groups.get('organization', 'org_678');
group.identityCount; // 12

await client.groups.update('organization', 'org_678', { plan: 'business' });

await client.groups.addMember('team', 'team_42', 'user_12345');
await client.groups.removeMember('team', 'team_42', 'user_12345');

for await (const team of client.groups.listAll({ groupType: 'team', identity: 'user_12345' })) {
  console.log(team.id, team.displayName);
}
```

`create()` merges into the group when one with the same type and id already exists, so it is safe to call
on every sync. The type defaults to `"organization"`; pass `{ groupType: 'team' }` for another.

## Events, devices, and escalations

```ts
for await (const event of client.events.listAll({ identity: 'user_12345' })) {
  console.log(event.timestamp, event.name, event.canonicalType);
}

await client.devices.update('a1b2c3d4e5', { disregarded: true }); // e.g. a shared office machine

for await (const escalation of client.escalations.listAll({
  status: 'open',
  severity: 'critical',
})) {
  await notifyOnCall(escalation.identity?.id);
  await client.escalations.update(escalation.id!, { status: 'acknowledged' });
}

await client.escalations.summary(); // { open: 3, acknowledged: 1, closed: 20, ... }
```

## Errors

```ts
import { DregsError, NotFoundError, QuotaExceededError, RateLimitError } from '@dregs/sdk';

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
`requestId`; `error.message` is the message the API sent (or the status's reason phrase, such as
"Not Found", when it sent none), and `error.toString()` prefixes it with the
status and the request id, which is the form worth putting in a log line.

Arguments the SDK can reject without asking Dregs — a missing identity, an event id over 64 characters,
a `pk_` key, an empty id in a path, a negative page, an unknown escalation status — throw a plain
`TypeError` before anything is sent.

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
import { verifyWebhook, WebhookVerificationError } from '@dregs/sdk/webhooks';

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
gone. The helpers are exported from the package root as well, so `import { verifyWebhook } from '@dregs/sdk'`
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
import type {
  Analysis,
  Category,
  Escalation,
  Event,
  Group,
  Identity,
  Observation,
  Page,
  Score,
  TrackResult,
} from '@dregs/sdk';
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
