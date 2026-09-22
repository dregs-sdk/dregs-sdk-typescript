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
