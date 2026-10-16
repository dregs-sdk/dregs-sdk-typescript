# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - Unreleased

The first stable release. It catches the SDK up with the public API: groups, the rest of the identity
reads and writes, events, devices, and escalations, with paging throughout. Nothing from 0.1.0 changes,
so upgrading needs no code changes.

### Added

- `groups` on `track()`: the organizations, teams, workspaces, or other groups the user is acting in,
  each with an `id`, an optional `type` (`"organization"` by default), and optional `data`. Dregs makes
  the identity a member of each.
- `client.groups`: `list()`, `listAll()`, `get()`, `create()`, `update()`, `addMember()`, and
  `removeMember()`.
- `identities.list()`, `listAll()`, `update()` (to disregard an identity or merge attributes),
  `history()`, `links()`, `reviews()`, and `review()`, and a `cycleId` on `analysis()` for a past cycle.
- `client.events`: `list()`, `listAll()`, and `get()`, with the groups each event was sent with.
- `client.devices`: `list()`, `listAll()`, `get()`, and `update()` to disregard a device.
- `client.escalations`: `list()`, `listAll()`, `get()`, `update()` to move an escalation along, and
  `summary()`.
- `Page`, one page's items with its position and totals, and a `listAll()` on every namespace that
  walks the pages for you as an async iterator.

### Fixed

- An error response with no message in its body now carries the status's reason phrase, such as
  "Not Found", rather than an empty message. `statusText` is empty over HTTP/2, so the SDK falls back
  to the standard phrase for the status.

## [0.1.0] - 2026-09-22

The first release. A server-side client for tracking events and reading scores, ported from the
reference [Python SDK](https://github.com/dregs-sdk/dregs-sdk-python).

### Added

- A `Dregs` client, authenticating with a credential's `sk_` secret key against a configurable
  base URL. Every method returns a promise; there is no separate async client.
- `track()` for recording backend events against an identity, always sending an idempotency `id`
  so a retry cannot double-count.
- `identities.get()`, `identities.scores()`, `identities.analysis()`, and `identities.analyze()`.
- Typed errors for 400, 401, 402, 403, 404, 429, and 5xx, plus connection and timeout failures,
  all deriving from `DregsError`.
- Automatic retries with exponential backoff and full jitter, honouring `Retry-After`.
- `verifyWebhook()` for checking a webhook's signature and rejecting replays, exported from the
  package root and from the `@dregs/sdk/webhooks` subpath.
- ESM and CommonJS builds with generated declarations for both, and no runtime dependencies.

[1.0.0]: https://github.com/dregs-sdk/dregs-sdk-typescript/compare/v0.1.0...v1.0.0
[0.1.0]: https://github.com/dregs-sdk/dregs-sdk-typescript/releases/tag/v0.1.0
