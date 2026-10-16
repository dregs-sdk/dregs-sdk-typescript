/**
 * Typed views over the Dregs API's responses.
 *
 * Every model keeps the response it was built from in `raw`, so a field Dregs adds after this
 * release is still reachable without waiting for an SDK upgrade. Parsing is deliberately lenient:
 * a missing field becomes `null` rather than an error, because an SDK that refuses to parse a
 * response it half-understands is worse than one that hands back what it got.
 *
 * @module
 */

/**
 * The four categories Dregs scores an identity in.
 *
 * A plain string union rather than an enum, so `scores.get('HUMANITY')` type-checks and a
 * category from a future Dregs release still survives parsing (as a `null` category on a
 * {@link Score} whose `raw` still names it).
 */
export type Category = 'HUMANITY' | 'AUTHENTICITY' | 'UNIQUENESS' | 'BEHAVIOR';

/** The four categories, in the order the dashboard shows them. */
export const CATEGORIES: readonly Category[] = [
  'HUMANITY',
  'AUTHENTICITY',
  'UNIQUENESS',
  'BEHAVIOR',
];

/** An unparsed JSON object, as received. */
export type RawPayload = Readonly<Record<string, unknown>>;

/** The outcome of a {@link Dregs.track} call. */
export interface TrackResult {
  /** The status Dregs reported, normally `"success"`. */
  readonly status: string | null;

  /**
   * The event's identifier, either the one you supplied or one the SDK generated. It is `null`
   * when the event was not recorded.
   */
  readonly id: string | null;

  /**
   * The device fingerprint Dregs resolved, for events that carried a device signature.
   * Server-side events do not, so this is normally `null`.
   */
  readonly fingerprint: string | null;

  /**
   * Whether Dregs recorded the event.
   *
   * This is `false` in the uncommon case where Dregs accepts the request without recording an
   * event. A server-side integration holding a valid secret key should not normally see it, so it
   * is worth a log line if you do. Ingestion failures that are yours to act on (a bad request, an
   * unknown key, an exhausted quota, a rate limit) throw instead of landing here.
   */
  readonly accepted: boolean;

  /** The response body as received. */
  readonly raw: RawPayload;
}

/** A label Dregs applied to an identity, from an analyzer or a badge rule. */
export interface Badge {
  /** The badge's slug, such as `"behavior.account-takeover-signal"`. */
  readonly slug: string | null;

  /** The human-readable name, such as `"Account Takeover Suspected"`. */
  readonly name: string | null;

  /** Where the badge came from: an analyzer observation or a badge rule. */
  readonly type: string | null;

  /** A sentence describing why the badge was applied. */
  readonly explanation: string | null;

  /** The counts and details behind the badge. */
  readonly metadata: RawPayload;

  /** The response fragment this badge was built from. */
  readonly raw: RawPayload;
}

/** One analyzer's finding, and the reasoning behind a slice of a score. */
export interface Observation {
  /** The category the observation contributes to, or `null` for one this release predates. */
  readonly category: Category | null;

  /** The analyzer's identifier, such as `"humanity.user-agent"`. */
  readonly id: string | null;

  /** A human-readable name for the analyzer. */
  readonly label: string | null;

  /** A sentence describing what the analyzer found. This is the text to show or log. */
  readonly explanation: string | null;

  /** 0.0 for entirely suspicious, 1.0 for entirely legitimate. */
  readonly value: number | null;

  /** How sure the analyzer is, from 0.0 to 1.0. */
  readonly confidence: number | null;

  /** How heavily this observation counts toward the category score. */
  readonly weight: number | null;

  /** The counts and details behind the finding. */
  readonly metadata: RawPayload;

  /** The response fragment this observation was built from. */
  readonly raw: RawPayload;
}

/** One category's score. */
export interface Score {
  /** The category scored, or `null` for one this release predates. */
  readonly category: Category | null;

  /** An integer from 0 (worst) to 100 (best). */
  readonly value: number | null;

  /**
   * The observations behind the score. Empty on the result of `identities.scores()`, which
   * reports the scores alone; the observations come from `identities.analysis()`.
   */
  readonly observations: readonly Observation[];

  /** The response fragment this score was built from. */
  readonly raw: RawPayload;
}

/**
 * An identity's category scores.
 *
 * An array of {@link Score}, so it indexes, iterates, spreads, and maps like any other, and it
 * also offers the four categories by name:
 *
 * ```ts
 * const scores = await client.identities.scores('user_12345');
 *
 * if (scores.authenticity !== null && scores.authenticity < 40) {
 *   await holdForReview('user_12345');
 * }
 * ```
 *
 * A category Dregs has not scored yet is absent from the array, and its named accessor reads
 * `null`. A brand-new identity comes back empty.
 */
export class Scores extends Array<Score> {
  /**
   * `map`, `filter`, and `slice` return plain arrays rather than trying to rebuild a `Scores`
   * through a constructor whose shape they know nothing about.
   */
  static override get [Symbol.species](): ArrayConstructor {
    return Array;
  }

  constructor(items: readonly Score[] = []) {
    super();

    for (const item of items) {
      this.push(item);
    }
  }

  /** Returns the score for `category`, or `null` when it has not been scored. */
  get(category: Category): Score | null {
    return this.find((score) => score.category === category) ?? null;
  }

  private value(category: Category): number | null {
    return this.get(category)?.value ?? null;
  }

  /** How likely it is that a person, rather than a script, is behind the account. */
  get humanity(): number | null {
    return this.value('HUMANITY');
  }

  /** How genuine the details on the account look. */
  get authenticity(): number | null {
    return this.value('AUTHENTICITY');
  }

  /** How distinct the account is from others in the same tenant. */
  get uniqueness(): number | null {
    return this.value('UNIQUENESS');
  }

  /** How ordinary the account's activity looks. */
  get behavior(): number | null {
    return this.value('BEHAVIOR');
  }
}

/**
 * A user Dregs is tracking, and their current scores.
 *
 * `id` is your own identifier for the user, the one you pass to {@link Dregs.track} and to
 * `dregs.identify()` in the browser tracker, not an internal Dregs id.
 */
export interface Identity {
  /** Your own id for the user. */
  readonly id: string | null;

  /** The name Dregs resolved from the identity attributes you have sent. */
  readonly displayName: string | null;

  /** The email address Dregs resolved from the identity attributes you have sent. */
  readonly displayEmail: string | null;

  /** The username Dregs resolved from the identity attributes you have sent. */
  readonly displayUsername: string | null;

  /** The current humanity score, 0 to 100, or `null` when the category is unscored. */
  readonly humanityScore: number | null;

  /** The current authenticity score, 0 to 100, or `null` when the category is unscored. */
  readonly authenticityScore: number | null;

  /** The current uniqueness score, 0 to 100, or `null` when the category is unscored. */
  readonly uniquenessScore: number | null;

  /** The current behavior score, 0 to 100, or `null` when the category is unscored. */
  readonly behaviorScore: number | null;

  /** When Dregs first saw this identity. */
  readonly createdAt: Date | null;

  /** When the identity record last changed. */
  readonly updatedAt: Date | null;

  /** When the most recent event for this identity arrived. */
  readonly lastTrackedAt: Date | null;

  /** When the most recent analysis cycle finished. */
  readonly lastScoredAt: Date | null;

  /**
   * Whether the identity is excluded from fraud analysis, which is how an operator marks their
   * own admin or load-test accounts.
   */
  readonly disregarded: boolean;

  /** The badges currently applied to the identity. */
  readonly badges: readonly Badge[];

  /** Every identity attribute you have sent, merged. */
  readonly data: RawPayload;

  /**
   * The four category scores, as a {@link Scores} for parity with `identities.scores()`.
   *
   * Built from the score fields on this response, so it costs no extra request.
   */
  readonly scores: Scores;

  /** The response body this identity was built from. */
  readonly raw: RawPayload;
}

/** One analysis cycle: the scores an identity was given, and why. */
export interface Analysis {
  /** The cycle's identifier. */
  readonly id: number | null;

  /** The identity that was analyzed. */
  readonly identityId: string | null;

  /** The category scores, each carrying its observations. */
  readonly scores: Scores;

  /** Every observation from the cycle, flattened across all categories. */
  readonly observations: readonly Observation[];

  /** How many events the cycle considered. */
  readonly eventCount: number | null;

  /** How many devices the cycle considered. */
  readonly deviceCount: number | null;

  /** How long the cycle took, in milliseconds. */
  readonly durationMillis: number | null;

  /** When the cycle started. */
  readonly startedAt: Date | null;

  /** When the cycle finished. */
  readonly finishedAt: Date | null;

  /** The response body this analysis was built from. */
  readonly raw: RawPayload;
}

/**
 * One page of a list call.
 *
 * Pages are numbered from 0. A page is iterable, so `for (const item of page)` and `[...page]`
 * work as well as `page.items`. To walk every page, use the namespace's `listAll()` rather than
 * looping on `pageNumber` yourself.
 */
export interface Page<T> extends Iterable<T> {
  /** The items on this page. */
  readonly items: readonly T[];

  /** This page's number, counting from 0. */
  readonly pageNumber: number;

  /** The most items a page holds. */
  readonly pageSize: number;

  /** How many pages there are in all. */
  readonly totalPages: number;

  /** How many items there are across every page. */
  readonly totalElements: number;

  /** Whether this is the first page. */
  readonly first: boolean;

  /** Whether this is the last page. */
  readonly last: boolean;

  /** Whether another page follows this one. */
  readonly hasNext: boolean;

  /** The response body this page was built from. */
  readonly raw: RawPayload;
}

/** A pointer to another resource: its id, a label for display, and its API path. */
export interface Reference {
  /** The resource's id. */
  readonly id: string | null;

  /** A label for display, such as an identity's name. */
  readonly label: string | null;

  /** The resource's path in the API. */
  readonly path: string | null;

  /** The response fragment this reference was built from. */
  readonly raw: RawPayload;
}

/** A pointer to a group, as it appears on an event. */
export interface GroupReference {
  /** The kind of group, such as `"organization"` or `"team"`. */
  readonly type: string | null;

  /** Your own id for the group. */
  readonly id: string | null;

  /** A label for display, such as the group's name. */
  readonly label: string | null;

  /** The group's path in the API. */
  readonly path: string | null;

  /** The response fragment this reference was built from. */
  readonly raw: RawPayload;
}

/**
 * An organization, team, workspace, or whatever your application groups users into.
 *
 * A group is identified by its `type` and `id` together, both your own. Dregs normalizes the type
 * to lower_snake_case.
 */
export interface Group {
  /** The kind of group, such as `"organization"` or `"team"`. */
  readonly type: string | null;

  /** Your own id for the group. */
  readonly id: string | null;

  /** A name for display, taken from the group's attributes. */
  readonly displayName: string | null;

  /** How many identities are members. */
  readonly identityCount: number | null;

  /** When Dregs first saw this group. */
  readonly createdAt: Date | null;

  /** When the group record last changed. */
  readonly updatedAt: Date | null;

  /** When the most recent event sent with this group arrived. */
  readonly lastTrackedAt: Date | null;

  /** The group's attributes. Empty on the groups of a list call, which leaves them out. */
  readonly data: RawPayload;

  /** The response body this group was built from. */
  readonly raw: RawPayload;
}

/** An event Dregs recorded. */
export interface Event {
  /** The event's id, either the one you sent or one Dregs generated. */
  readonly id: string | null;

  /** When the event happened. */
  readonly timestamp: Date | null;

  /** The identity the event belongs to, if any. */
  readonly identity: Reference | null;

  /** The groups the event was sent with. */
  readonly groups: readonly GroupReference[];

  /** The device fingerprint, for events that carried a device signature. */
  readonly fingerprint: string | null;

  /** The browser session, for events from the tracker. */
  readonly session: string | null;

  /** The address the event came from. */
  readonly ip: string | null;

  /** The page URL, for events from the tracker. */
  readonly url: string | null;

  /** Where the event came from, such as `"node-sdk"`. */
  readonly source: string | null;

  /** Your name for the event, such as `"user.signup"`. */
  readonly name: string | null;

  /** The Dregs event type your name is mapped to, if it is mapped. */
  readonly canonicalType: string | null;

  /** The event's attributes, with sensitive values redacted. */
  readonly data: RawPayload;

  /** The response body this event was built from. */
  readonly raw: RawPayload;
}

/** A browser or device Dregs has seen, identified by its fingerprint. */
export interface Device {
  /** The device's fingerprint. */
  readonly fingerprint: string | null;

  /** The address the device was last seen from. */
  readonly ip: string | null;

  /** The autonomous system the address belongs to. */
  readonly asn: string | null;

  /** The name of that autonomous system, such as a hosting provider or ISP. */
  readonly asnLabel: string | null;

  /** The device's user agent. */
  readonly userAgent: string | null;

  /** Where the address places the device, as resolved by geolocation. */
  readonly city: string | null;

  /** The region, such as a state or province. */
  readonly region: string | null;

  /** The country's name. */
  readonly country: string | null;

  /** The country's ISO 3166-1 alpha-2 code, such as `"US"`. */
  readonly countryCode: string | null;

  /** The IANA time zone, such as `"America/New_York"`. */
  readonly timezone: string | null;

  readonly latitude: number | null;
  readonly longitude: number | null;

  /** Whether the device is disregarded, so it no longer links the identities seen on it. */
  readonly disregarded: boolean;

  /** When Dregs first saw this device. */
  readonly firstSeenAt: Date | null;

  /** When Dregs last saw this device. */
  readonly lastSeenAt: Date | null;

  /** The response body this device was built from. */
  readonly raw: RawPayload;
}

/** Another identity Dregs believes is connected to this one, such as by a shared device. */
export interface LinkedIdentity {
  /** The linked identity's id. */
  readonly identityId: string | null;

  /** The linked identity's display name. */
  readonly displayName: string | null;

  /** How they are linked, such as `"SAME_DEVICE"` or `"SHARED_IP"`. */
  readonly type: string | null;

  /** How strongly they are linked, from 0.0 to 1.0. */
  readonly value: number | null;

  /** How sure Dregs is of the link, from 0.0 to 1.0. */
  readonly confidence: number | null;

  /** A sentence describing the link. */
  readonly explanation: string | null;

  /** The details behind the link. */
  readonly metadata: RawPayload;

  /** When Dregs found the link. */
  readonly createdAt: Date | null;

  /** The response fragment this link was built from. */
  readonly raw: RawPayload;
}

/** The scores one past analysis cycle produced. */
export interface ScoreHistoryEntry {
  /** The cycle's id, which `identities.analysis()` accepts to fetch that cycle's observations. */
  readonly cycleId: number | null;

  /** The cycle's humanity score, 0 to 100, or `null` when the category was unscored. */
  readonly humanity: number | null;

  /** The cycle's authenticity score, 0 to 100, or `null` when the category was unscored. */
  readonly authenticity: number | null;

  /** The cycle's uniqueness score, 0 to 100, or `null` when the category was unscored. */
  readonly uniqueness: number | null;

  /** The cycle's behavior score, 0 to 100, or `null` when the category was unscored. */
  readonly behavior: number | null;

  /** How many events the cycle considered. */
  readonly eventCount: number | null;

  /** How many devices the cycle considered. */
  readonly deviceCount: number | null;

  /** When the cycle finished. */
  readonly finishedAt: Date | null;

  /** The response fragment this entry was built from. */
  readonly raw: RawPayload;
}

/** A review of an identity's analysis, written by Dregs's AI reviewer. */
export interface IdentityReview {
  /** The review's id. */
  readonly id: number | null;

  /** The identity reviewed. */
  readonly identityId: string | null;

  /** `"PENDING"` until the review has run, then `"FINISHED"` or `"FAILED"`. */
  readonly status: string | null;

  /** The note you sent with the request, if any. */
  readonly feedback: string | null;

  /** The reviewer's findings, once it has run. */
  readonly summary: string | null;

  /** Why the review failed, when it did. */
  readonly errorMessage: string | null;

  /** When the review was requested. */
  readonly createdAt: Date | null;

  /** When the review finished. */
  readonly completedAt: Date | null;

  /** The response body this review was built from. */
  readonly raw: RawPayload;
}

/** An escalation an escalation rule opened against an identity. */
export interface Escalation {
  /** The escalation's id. */
  readonly id: number | null;

  /** `"OPEN"`, `"ACKNOWLEDGED"`, or `"CLOSED"`. */
  readonly status: string | null;

  /** `"INFO"`, `"WARNING"`, or `"CRITICAL"`. */
  readonly severity: string | null;

  /** The identity the escalation is about. */
  readonly identity: Reference | null;

  /** The escalation rule that opened it. */
  readonly rule: Reference | null;

  /** The identity's scores when the escalation opened, by category name. */
  readonly scores: RawPayload;

  /** When the escalation opened. */
  readonly openedAt: Date | null;

  /** When the escalation was acknowledged, if it has been. */
  readonly acknowledgedAt: Date | null;

  /** When the escalation was closed, if it has been. */
  readonly closedAt: Date | null;

  /** When the escalation record was created. */
  readonly createdAt: Date | null;

  /** The response body this escalation was built from. */
  readonly raw: RawPayload;
}

/** How many escalations are in each status. */
export interface EscalationSummary {
  /** How many escalations are open. */
  readonly open: number;

  /** How many escalations are acknowledged but not closed. */
  readonly acknowledged: number;

  /** How many escalations are closed. */
  readonly closed: number;

  /** The response body this summary was built from. */
  readonly raw: RawPayload;
}

function asPayload(value: unknown): RawPayload {
  return isPayload(value) ? value : {};
}

function isPayload(value: unknown): value is RawPayload {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function asDate(value: unknown): Date | null {
  if (typeof value !== 'string' || !value) {
    return null;
  }

  const parsed = new Date(value);

  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function asCategory(value: unknown): Category | null {
  return typeof value === 'string' && (CATEGORIES as readonly string[]).includes(value)
    ? (value as Category)
    : null;
}

function asArray(value: unknown): RawPayload[] {
  return Array.isArray(value) ? value.filter(isPayload) : [];
}

/** Builds a {@link TrackResult} from a `POST /api/events` body. @internal */
export function parseTrackResult(payload: unknown): TrackResult {
  const body = asPayload(payload);
  const id = asString(body.id);

  return {
    status: asString(body.status),
    id,
    fingerprint: asString(body.fingerprint),
    accepted: id !== null,
    raw: body,
  };
}

/** Builds a {@link Badge}. @internal */
export function parseBadge(payload: unknown): Badge {
  const body = asPayload(payload);

  return {
    slug: asString(body.slug),
    name: asString(body.name),
    type: asString(body.type),
    explanation: asString(body.explanation),
    metadata: asPayload(body.metadata),
    raw: body,
  };
}

/** Builds an {@link Observation}. @internal */
export function parseObservation(payload: unknown): Observation {
  const body = asPayload(payload);

  return {
    category: asCategory(body.category),
    id: asString(body.id),
    label: asString(body.label),
    explanation: asString(body.explanation),
    value: asNumber(body.value),
    confidence: asNumber(body.confidence),
    weight: asNumber(body.weight),
    metadata: asPayload(body.metadata),
    raw: body,
  };
}

/** Builds a {@link Score}, with any observations it carries. @internal */
export function parseScore(payload: unknown): Score {
  const body = asPayload(payload);

  return {
    category: asCategory(body.category),
    value: asNumber(body.value),
    observations: asArray(body.observations).map(parseObservation),
    raw: body,
  };
}

/** Builds a {@link Scores} from the `GET /scores` array. @internal */
export function parseScores(payload: unknown): Scores {
  return new Scores(asArray(payload).map(parseScore));
}

/** Builds an {@link Identity}. @internal */
export function parseIdentity(payload: unknown): Identity {
  const body = asPayload(payload);

  const humanityScore = asNumber(body.humanityScore);
  const authenticityScore = asNumber(body.authenticityScore);
  const uniquenessScore = asNumber(body.uniquenessScore);
  const behaviorScore = asNumber(body.behaviorScore);

  const pairs: readonly (readonly [Category, number | null])[] = [
    ['HUMANITY', humanityScore],
    ['AUTHENTICITY', authenticityScore],
    ['UNIQUENESS', uniquenessScore],
    ['BEHAVIOR', behaviorScore],
  ];

  const scores = new Scores(
    pairs
      .filter(([, value]) => value !== null)
      .map(([category, value]) => ({ category, value, observations: [], raw: {} })),
  );

  return {
    id: asString(body.id),
    displayName: asString(body.displayName),
    displayEmail: asString(body.displayEmail),
    displayUsername: asString(body.displayUsername),
    humanityScore,
    authenticityScore,
    uniquenessScore,
    behaviorScore,
    createdAt: asDate(body.createdAt),
    updatedAt: asDate(body.updatedAt),
    lastTrackedAt: asDate(body.lastTrackedAt),
    lastScoredAt: asDate(body.lastScoredAt),
    disregarded: body.disregarded === true,
    badges: asArray(body.badges).map(parseBadge),
    data: asPayload(body.data),
    scores,
    raw: body,
  };
}

/** Builds an {@link Analysis}. @internal */
export function parseAnalysis(payload: unknown): Analysis {
  const body = asPayload(payload);
  const scores = parseScores(body.scores);

  return {
    id: asNumber(body.id),
    identityId: asString(body.identityId),
    scores,
    observations: scores.flatMap((score) => [...score.observations]),
    eventCount: asNumber(body.eventCount),
    deviceCount: asNumber(body.deviceCount),
    durationMillis: asNumber(body.durationMillis),
    startedAt: asDate(body.startedAt),
    finishedAt: asDate(body.finishedAt),
    raw: body,
  };
}

/** Builds a {@link Page}, parsing each item with `parse`. @internal */
export function parsePage<T>(payload: unknown, parse: (item: RawPayload) => T): Page<T> {
  const body = asPayload(payload);
  const items = asArray(body.content).map(parse);
  const last = body.last !== false;

  return {
    items,
    pageNumber: asNumber(body.pageNumber) ?? 0,
    pageSize: asNumber(body.pageSize) ?? 0,
    totalPages: asNumber(body.totalPages) ?? 0,
    totalElements: asNumber(body.totalElements) ?? 0,
    first: body.first !== false,
    last,
    hasNext: !last && items.length > 0,
    raw: body,
    [Symbol.iterator]: () => items[Symbol.iterator](),
  };
}

/** Builds a {@link Reference}, or `null` when there is nothing to build one from. @internal */
export function parseReference(payload: unknown): Reference | null {
  if (!isPayload(payload)) {
    return null;
  }

  return {
    id: asString(payload.id),
    label: asString(payload.label),
    path: asString(payload.path),
    raw: payload,
  };
}

/** Builds a {@link GroupReference}. @internal */
export function parseGroupReference(payload: unknown): GroupReference {
  const body = asPayload(payload);

  return {
    type: asString(body.type),
    id: asString(body.id),
    label: asString(body.label),
    path: asString(body.path),
    raw: body,
  };
}

/** Builds a {@link Group}. @internal */
export function parseGroup(payload: unknown): Group {
  const body = asPayload(payload);

  return {
    type: asString(body.type),
    id: asString(body.id),
    displayName: asString(body.displayName),
    identityCount: asNumber(body.identityCount),
    createdAt: asDate(body.createdAt),
    updatedAt: asDate(body.updatedAt),
    lastTrackedAt: asDate(body.lastTrackedAt),
    data: asPayload(body.data),
    raw: body,
  };
}

/** Builds an {@link Event}. @internal */
export function parseEvent(payload: unknown): Event {
  const body = asPayload(payload);

  return {
    id: asString(body.id),
    timestamp: asDate(body.timestamp),
    identity: parseReference(body.identity),
    groups: asArray(body.groups).map(parseGroupReference),
    fingerprint: asString(body.fingerprint),
    session: asString(body.session),
    ip: asString(body.ip),
    url: asString(body.url),
    source: asString(body.eventSource),
    name: asString(body.eventName),
    canonicalType: asString(body.canonicalType),
    data: asPayload(body.eventData),
    raw: body,
  };
}

/** Builds a {@link Device}. @internal */
export function parseDevice(payload: unknown): Device {
  const body = asPayload(payload);

  return {
    fingerprint: asString(body.fingerprint),
    ip: asString(body.ip),
    asn: asString(body.asn),
    asnLabel: asString(body.asnLabel),
    userAgent: asString(body.userAgent),
    city: asString(body.city),
    region: asString(body.region),
    country: asString(body.country),
    countryCode: asString(body.countryCode),
    timezone: asString(body.timezone),
    latitude: asNumber(body.latitude),
    longitude: asNumber(body.longitude),
    disregarded: body.disregarded === true,
    firstSeenAt: asDate(body.firstSeenAt),
    lastSeenAt: asDate(body.lastSeenAt),
    raw: body,
  };
}

/** Builds a {@link LinkedIdentity}. @internal */
export function parseLinkedIdentity(payload: unknown): LinkedIdentity {
  const body = asPayload(payload);

  return {
    identityId: asString(body.targetIdentityId),
    displayName: asString(body.targetDisplayName),
    type: asString(body.type),
    value: asNumber(body.value),
    confidence: asNumber(body.confidence),
    explanation: asString(body.explanation),
    metadata: asPayload(body.metadata),
    createdAt: asDate(body.createdAt),
    raw: body,
  };
}

/** Builds a {@link ScoreHistoryEntry}. @internal */
export function parseScoreHistoryEntry(payload: unknown): ScoreHistoryEntry {
  const body = asPayload(payload);

  return {
    cycleId: asNumber(body.id),
    humanity: asNumber(body.humanityScore),
    authenticity: asNumber(body.authenticityScore),
    uniqueness: asNumber(body.uniquenessScore),
    behavior: asNumber(body.behaviorScore),
    eventCount: asNumber(body.eventCount),
    deviceCount: asNumber(body.deviceCount),
    finishedAt: asDate(body.finishedAt),
    raw: body,
  };
}

/** Builds an {@link IdentityReview}. @internal */
export function parseIdentityReview(payload: unknown): IdentityReview {
  const body = asPayload(payload);

  return {
    id: asNumber(body.id),
    identityId: asString(body.identityId),
    status: asString(body.status),
    feedback: asString(body.userFeedback),
    summary: asString(body.summary),
    errorMessage: asString(body.errorMessage),
    createdAt: asDate(body.createdAt),
    completedAt: asDate(body.completedAt),
    raw: body,
  };
}

/** Builds an {@link Escalation}. @internal */
export function parseEscalation(payload: unknown): Escalation {
  const body = asPayload(payload);

  return {
    id: asNumber(body.id),
    status: asString(body.status),
    severity: asString(body.severity),
    identity: parseReference(body.identity),
    rule: parseReference(body.escalationRule),
    scores: asPayload(body.scoreSnapshot),
    openedAt: asDate(body.openedAt),
    acknowledgedAt: asDate(body.acknowledgedAt),
    closedAt: asDate(body.closedAt),
    createdAt: asDate(body.createdAt),
    raw: body,
  };
}

/** Builds an {@link EscalationSummary}. @internal */
export function parseEscalationSummary(payload: unknown): EscalationSummary {
  const body = asPayload(payload);

  return {
    open: asNumber(body.open) ?? 0,
    acknowledged: asNumber(body.acknowledged) ?? 0,
    closed: asNumber(body.closed) ?? 0,
    raw: body,
  };
}

/** Builds a list of items from an array body, parsing each with `parse`. @internal */
export function parseList<T>(payload: unknown, parse: (item: RawPayload) => T): T[] {
  return asArray(payload).map(parse);
}
