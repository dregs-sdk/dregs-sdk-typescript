/**
 * The `client.identities`, `client.groups`, `client.events`, `client.devices`, and
 * `client.escalations` namespaces.
 *
 * These are thin: they name the endpoint, then hand the response to a parser. The transport,
 * retries, and error mapping all live on the client. Every argument the SDK can check is checked
 * before a request goes out.
 *
 * @module
 */

import type {
  Analysis,
  Device,
  Escalation,
  EscalationSummary,
  Event,
  Group,
  Identity,
  IdentityReview,
  LinkedIdentity,
  Page,
  RawPayload,
  ScoreHistoryEntry,
  Scores,
} from './models.js';
import {
  parseAnalysis,
  parseDevice,
  parseEscalation,
  parseEscalationSummary,
  parseEvent,
  parseGroup,
  parseIdentity,
  parseIdentityReview,
  parseLinkedIdentity,
  parseList,
  parsePage,
  parseScoreHistoryEntry,
  parseScores,
} from './models.js';

/** Query parameters for a request. Unset ones are left off the URL. @internal */
export type Query = Readonly<Record<string, string | number | boolean | null | undefined>>;

/** How a resource reaches the client's transport. @internal */
export type RequestFn = (
  method: string,
  path: string,
  body?: unknown,
  query?: Query,
) => Promise<unknown>;

/** The `type` a group gets when the caller does not name one. @internal */
export const DEFAULT_GROUP_TYPE = 'organization';

/** The direction a list is sorted in. Either case is accepted. */
export type SortOrder = 'asc' | 'desc' | 'ASC' | 'DESC';

/** An escalation's status. Either case is accepted, and it is sent upper-cased. */
export type EscalationStatus =
  'open' | 'acknowledged' | 'closed' | Uppercase<'open' | 'acknowledged' | 'closed'>;

/** An escalation's severity. Either case is accepted, and it is sent upper-cased. */
export type EscalationSeverity =
  'info' | 'warning' | 'critical' | Uppercase<'info' | 'warning' | 'critical'>;

/** Sorting and page size, shared by every `list()` and `listAll()`. */
export interface ListOptions {
  /** Items per page, at most 100. */
  pageSize?: number;

  /** The field to sort on, such as `"lastTrackedAt"`. Each `list()` names the useful ones. */
  sort?: string;

  /** `"asc"` or `"desc"`. */
  order?: SortOrder;
}

/** Which page to return, on top of the sorting and page size. */
export interface PageOptions extends ListOptions {
  /** The page to return, counting from 0. Defaults to 0. */
  page?: number;
}

/** Filters for {@link Identities.list} and {@link Identities.listAll}. */
export interface IdentityFilters {
  /** Free text matched against ids, names, emails, and usernames. */
  term?: string;

  /**
   * Only members of the group with this id. Pair it with `groupType` when your group ids are not
   * unique across types.
   */
  group?: string;

  /** Only members of groups of this type. */
  groupType?: string;

  /** Only identities seen on the device with this fingerprint. */
  device?: string;

  /** Only identities carrying the badge with this slug. */
  badge?: string;
}

/** Filters for {@link Groups.list} and {@link Groups.listAll}. */
export interface GroupFilters {
  /** Only groups of this type, such as `"team"`. */
  groupType?: string;

  /** Only groups this identity belongs to. */
  identity?: string;

  /** Free text matched against group ids and names. */
  term?: string;
}

/** Filters for {@link Events.list} and {@link Events.listAll}. */
export interface EventFilters {
  /** Only events from this identity. */
  identity?: string;

  /** Only events sent with the group with this id. */
  group?: string;

  /** Only events sent with a group of this type. */
  groupType?: string;

  /** Only events from the device with this fingerprint. */
  device?: string;

  /** Only events from this browser session. */
  session?: string;

  /** Free text matched against event names and data. */
  term?: string;
}

/** Filters for {@link Devices.list} and {@link Devices.listAll}. */
export interface DeviceFilters {
  /** Only devices this identity was seen on. */
  identity?: string;

  /** Free text matched against fingerprints, addresses, places, and user agents. */
  term?: string;
}

/** Filters for {@link Escalations.list} and {@link Escalations.listAll}. */
export interface EscalationFilters {
  /** Only escalations in this status. */
  status?: EscalationStatus;

  /** Only escalations of this severity. */
  severity?: EscalationSeverity;

  /** Only escalations about this identity. */
  identity?: string;

  /** Only escalations opened by the escalation rule with this id. */
  rule?: number | string;
}

/** The changes {@link Identities.update} can make. Pass one or both. */
export interface IdentityUpdate {
  /**
   * `true` to leave the identity out of scoring and escalations, such as for your own staff or
   * test accounts. Linked identities are re-scored.
   */
  disregarded?: boolean;

  /** Attributes to merge into the identity, as `identityData` on `track()` would. */
  attributes?: Readonly<Record<string, unknown>>;
}

/** The arguments to {@link Groups.create} beyond the group's id. */
export interface GroupCreateOptions {
  /** The kind of group. `"organization"` when omitted. */
  groupType?: string;

  /** Attributes such as a name or plan. */
  attributes?: Readonly<Record<string, unknown>>;
}

/** One list endpoint, its filters, and its sorting, ready to fetch any page of. */
interface ListCall<T> {
  readonly path: string;
  readonly parse: (item: RawPayload) => T;
  readonly filters: Query;
  readonly options: ListOptions;
}

function segment(value: string | number | null | undefined, what: string): string {
  if (value === undefined || value === null || String(value) === '') {
    throw new TypeError(`${what} is required.`);
  }

  // Ids are the caller's own and routinely contain characters that need escaping, an email
  // address being the common one.
  return encodeURIComponent(String(value));
}

function identityPath(identityId: string, suffix = ''): string {
  return `/identities/${segment(identityId, 'An identity id')}${suffix}`;
}

function groupPath(groupType: string, groupId: string, suffix = ''): string {
  return `/groups/${segment(groupType, 'A group type')}/${segment(groupId, 'A group id')}${suffix}`;
}

function order(value: string | undefined): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== 'string' || !['asc', 'desc'].includes(value.toLowerCase())) {
    throw new TypeError("order is 'asc' or 'desc'.");
  }

  return value.toUpperCase();
}

function pageNumber(page: number | undefined): number {
  const number = page ?? 0;

  if (!Number.isInteger(number) || number < 0) {
    throw new TypeError('Pages are numbered from 0.');
  }

  return number;
}

function attributes(value: unknown): Record<string, unknown> {
  if (value === undefined || value === null) {
    return {};
  }

  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError("attributes must be an object, such as { name: 'Acme Inc' }.");
  }

  return { ...(value as Record<string, unknown>) };
}

function escalationStatus(value: unknown): string {
  const upper = typeof value === 'string' ? value.toUpperCase() : null;

  if (upper !== 'OPEN' && upper !== 'ACKNOWLEDGED' && upper !== 'CLOSED') {
    throw new TypeError("status is 'open', 'acknowledged', or 'closed'.");
  }

  return upper;
}

/**
 * The shared plumbing every namespace sits on: one request, one page, every page.
 *
 * @internal
 */
abstract class Resource {
  readonly #request: RequestFn;

  constructor(request: RequestFn) {
    this.#request = request;
  }

  protected request(method: string, path: string, body?: unknown, query?: Query): Promise<unknown> {
    return this.#request(method, path, body, query);
  }

  protected async page<T>(call: ListCall<T>, page: number | undefined): Promise<Page<T>> {
    const query: Query = {
      ...call.filters,
      pageNumber: pageNumber(page),
      pageSize: call.options.pageSize,
      sort: call.options.sort,
      order: order(call.options.order),
    };

    return parsePage(await this.request('GET', call.path, undefined, query), call.parse);
  }

  /** Yields every item, fetching pages as it goes, until a page is the last or comes back empty. */
  protected async *walk<T>(call: ListCall<T>): AsyncGenerator<T, void, undefined> {
    for (let number = 0; ; number += 1) {
      const page = await this.page(call, number);

      yield* page.items;

      if (!page.hasNext) {
        return;
      }
    }
  }
}

// Identities ---------------------------------------------------------------------------------

function identitiesList(filters: IdentityFilters, options: ListOptions): ListCall<Identity> {
  return {
    path: '/identities',
    parse: parseIdentity,
    filters: {
      term: filters.term,
      group: filters.group,
      groupType: filters.groupType,
      device: filters.device,
      badge: filters.badge,
    },
    options,
  };
}

/**
 * Read identities, their scores, and their analysis, and update them.
 *
 * Reached as `client.identities`; there is no reason to construct one yourself.
 */
export class Identities extends Resource {
  /**
   * Returns one page of identities, most recently updated first.
   *
   * `sort` takes a field such as `"lastTrackedAt"` or `"humanityScore"`. Use
   * {@link Identities.listAll} to walk every page.
   */
  async list(options: IdentityFilters & PageOptions = {}): Promise<Page<Identity>> {
    return this.page(identitiesList(options, options), options.page);
  }

  /**
   * Yields every identity that matches, fetching pages as it goes. Use with `for await`.
   *
   * See {@link Identities.list}.
   */
  listAll(options: IdentityFilters & ListOptions = {}): AsyncGenerator<Identity, void, undefined> {
    return this.walk(identitiesList(options, options));
  }

  /**
   * Returns the identity, with its current scores, badges, and attributes.
   *
   * @param identityId Your own id for the user, the one you pass to `track()`.
   * @throws {NotFoundError} Dregs has never seen this identity.
   */
  async get(identityId: string): Promise<Identity> {
    return parseIdentity(await this.request('GET', identityPath(identityId)));
  }

  /**
   * Returns the current category scores.
   *
   * This is the cheap read and the one most integrations want. It reports the scores Dregs has
   * already computed without triggering any work. For the observations behind them, use
   * {@link Identities.analysis}.
   *
   * A category that has not been scored yet is absent, so a brand-new identity comes back empty.
   *
   * @throws {NotFoundError} Dregs has never seen this identity.
   */
  async scores(identityId: string): Promise<Scores> {
    return parseScores(await this.request('GET', identityPath(identityId, '/scores')));
  }

  /**
   * Returns an analysis cycle, with the observations behind each score.
   *
   * Use this when you need to show or log *why* an identity scored the way it did.
   *
   * @param identityId The identity.
   * @param cycleId A past cycle to return, from {@link Identities.history}. The most recent
   *   cycle when omitted.
   * @throws {NotFoundError} The identity is unknown, or it has not been analyzed yet.
   */
  async analysis(identityId: string, cycleId?: number | string): Promise<Analysis> {
    const suffix =
      cycleId === undefined || cycleId === null
        ? '/analysis'
        : `/analysis/${segment(cycleId, 'A cycle id')}`;

    return parseAnalysis(await this.request('GET', identityPath(identityId, suffix)));
  }

  /**
   * Returns the scores of past analysis cycles, newest first.
   *
   * @param identityId The identity.
   * @param options `limit`, the most cycles to return. The API's default is 100.
   * @throws {NotFoundError} Dregs has never seen this identity.
   */
  async history(
    identityId: string,
    options: { limit?: number } = {},
  ): Promise<ScoreHistoryEntry[]> {
    const payload = await this.request('GET', identityPath(identityId, '/history'), undefined, {
      limit: options.limit,
    });

    return parseList(payload, parseScoreHistoryEntry);
  }

  /**
   * Returns the other identities Dregs believes are connected to this one.
   *
   * @throws {NotFoundError} Dregs has never seen this identity.
   */
  async links(identityId: string): Promise<LinkedIdentity[]> {
    return parseList(
      await this.request('GET', identityPath(identityId, '/links')),
      parseLinkedIdentity,
    );
  }

  /**
   * Queues a re-analysis of the identity.
   *
   * Scoring is asynchronous: this resolves as soon as the job is queued, not when it has run.
   * Poll {@link Identities.scores} or watch for a webhook rather than expecting fresh scores on
   * the next line.
   *
   * @throws {NotFoundError} Dregs has never seen this identity.
   */
  async analyze(identityId: string): Promise<void> {
    await this.request('POST', identityPath(identityId, '/actions/analyze'));
  }

  /**
   * Updates an identity and returns it.
   *
   * ```ts
   * await client.identities.update('qa_bot_7', { disregarded: true });
   * ```
   *
   * @throws {NotFoundError} Dregs has never seen this identity.
   * @throws {TypeError} Neither `disregarded` nor `attributes` was given.
   */
  async update(identityId: string, changes: IdentityUpdate): Promise<Identity> {
    const path = identityPath(identityId);
    const body: Record<string, unknown> = {};

    if (changes?.disregarded !== undefined && changes.disregarded !== null) {
      body.disregarded = Boolean(changes.disregarded);
    }

    if (changes?.attributes !== undefined && changes.attributes !== null) {
      body.attributes = attributes(changes.attributes);
    }

    if (Object.keys(body).length === 0) {
      throw new TypeError('Pass disregarded, attributes, or both.');
    }

    return parseIdentity(await this.request('PATCH', path, body));
  }

  /**
   * Returns the AI reviews requested for this identity, newest first.
   *
   * @throws {NotFoundError} Dregs has never seen this identity.
   */
  async reviews(identityId: string): Promise<IdentityReview[]> {
    return parseList(
      await this.request('GET', identityPath(identityId, '/reviews')),
      parseIdentityReview,
    );
  }

  /**
   * Asks Dregs's AI reviewer to look over the identity's analysis.
   *
   * The review runs in the background, so the result comes back `PENDING`. Read it again with
   * {@link Identities.reviews} once it has finished.
   *
   * @param identityId The identity.
   * @param options `feedback`, what you think the analysis got wrong, such as "this is a real
   *   customer".
   * @throws {NotFoundError} Dregs has never seen this identity.
   */
  async review(identityId: string, options: { feedback?: string } = {}): Promise<IdentityReview> {
    const body = options.feedback ? { feedback: options.feedback } : {};

    return parseIdentityReview(
      await this.request('POST', identityPath(identityId, '/actions/review'), body),
    );
  }
}

// Groups -------------------------------------------------------------------------------------

function groupsList(filters: GroupFilters, options: ListOptions): ListCall<Group> {
  return {
    path: '/groups',
    parse: parseGroup,
    filters: { type: filters.groupType, identity: filters.identity, term: filters.term },
    options,
  };
}

/**
 * Read and manage groups: the organizations, teams, or workspaces your users belong to.
 *
 * `track()` already records groups and memberships as events arrive. These calls are for reading
 * them back, and for keeping Dregs in step when something changes outside an event, such as a
 * user leaving a team.
 *
 * Reached as `client.groups`.
 */
export class Groups extends Resource {
  /**
   * Returns one page of groups, most recently active first.
   *
   * `sort` takes a field such as `"displayName"` or `"lastTrackedAt"`. The groups in a list leave
   * out their attributes; {@link Groups.get} returns them.
   */
  async list(options: GroupFilters & PageOptions = {}): Promise<Page<Group>> {
    return this.page(groupsList(options, options), options.page);
  }

  /** Yields every group that matches, fetching pages as it goes. See {@link Groups.list}. */
  listAll(options: GroupFilters & ListOptions = {}): AsyncGenerator<Group, void, undefined> {
    return this.walk(groupsList(options, options));
  }

  /**
   * Returns the group, with its attributes.
   *
   * @throws {NotFoundError} No group of this type has this id.
   */
  async get(groupType: string, groupId: string): Promise<Group> {
    return parseGroup(await this.request('GET', groupPath(groupType, groupId)));
  }

  /**
   * Creates a group, or merges `attributes` into the group that already has this type and id.
   *
   * ```ts
   * await client.groups.create('org_678', { attributes: { name: 'Acme Inc' } });
   * ```
   *
   * @param groupId Your own id for the group.
   * @param options The group's type (`"organization"` when omitted) and attributes.
   */
  async create(groupId: string, options: GroupCreateOptions = {}): Promise<Group> {
    segment(groupId, 'A group id');

    const body = {
      type: options.groupType || DEFAULT_GROUP_TYPE,
      id: String(groupId),
      attributes: attributes(options.attributes),
    };

    return parseGroup(await this.request('POST', '/groups', body));
  }

  /**
   * Merges `attributes` into the group and returns it.
   *
   * @throws {NotFoundError} No group of this type has this id.
   */
  async update(
    groupType: string,
    groupId: string,
    groupAttributes: Readonly<Record<string, unknown>>,
  ): Promise<Group> {
    const path = groupPath(groupType, groupId);
    const body = { attributes: attributes(groupAttributes) };

    return parseGroup(await this.request('PATCH', path, body));
  }

  /**
   * Makes the identity a member of the group. Adding an existing member does nothing.
   *
   * @throws {NotFoundError} The group or the identity is unknown.
   */
  async addMember(groupType: string, groupId: string, identityId: string): Promise<void> {
    await this.request('PUT', memberPath(groupType, groupId, identityId));
  }

  /**
   * Removes the identity from the group, such as when a user leaves a team.
   *
   * @throws {NotFoundError} The group or the identity is unknown.
   */
  async removeMember(groupType: string, groupId: string, identityId: string): Promise<void> {
    await this.request('DELETE', memberPath(groupType, groupId, identityId));
  }
}

function memberPath(groupType: string, groupId: string, identityId: string): string {
  return groupPath(groupType, groupId, `/identities/${segment(identityId, 'An identity id')}`);
}

// Events -------------------------------------------------------------------------------------

function eventsList(filters: EventFilters, options: ListOptions): ListCall<Event> {
  return {
    path: '/events',
    parse: parseEvent,
    filters: {
      identity: filters.identity,
      group: filters.group,
      groupType: filters.groupType,
      device: filters.device,
      session: filters.session,
      term: filters.term,
    },
    options,
  };
}

/**
 * Read the events Dregs has recorded. To record one, use `track()`.
 *
 * Reached as `client.events`.
 */
export class Events extends Resource {
  /**
   * Returns one page of events, newest first.
   *
   * `sort` takes a field such as `"timestamp"` or `"eventName"`.
   */
  async list(options: EventFilters & PageOptions = {}): Promise<Page<Event>> {
    return this.page(eventsList(options, options), options.page);
  }

  /** Yields every event that matches, fetching pages as it goes. See {@link Events.list}. */
  listAll(options: EventFilters & ListOptions = {}): AsyncGenerator<Event, void, undefined> {
    return this.walk(eventsList(options, options));
  }

  /**
   * Returns the event with this id.
   *
   * @throws {NotFoundError} No event has this id.
   */
  async get(eventId: string): Promise<Event> {
    return parseEvent(await this.request('GET', `/events/${segment(eventId, 'An event id')}`));
  }
}

// Devices ------------------------------------------------------------------------------------

function devicesList(filters: DeviceFilters, options: ListOptions): ListCall<Device> {
  return {
    path: '/devices',
    parse: parseDevice,
    filters: { identity: filters.identity, term: filters.term },
    options,
  };
}

function devicePath(fingerprint: string): string {
  return `/devices/${segment(fingerprint, 'A device fingerprint')}`;
}

/**
 * Read the devices Dregs has seen, and disregard them.
 *
 * Reached as `client.devices`.
 */
export class Devices extends Resource {
  /**
   * Returns one page of devices, most recently seen first.
   *
   * `sort` takes a field such as `"lastSeenAt"` or `"country"`.
   */
  async list(options: DeviceFilters & PageOptions = {}): Promise<Page<Device>> {
    return this.page(devicesList(options, options), options.page);
  }

  /** Yields every device that matches, fetching pages as it goes. See {@link Devices.list}. */
  listAll(options: DeviceFilters & ListOptions = {}): AsyncGenerator<Device, void, undefined> {
    return this.walk(devicesList(options, options));
  }

  /**
   * Returns the device with this fingerprint.
   *
   * @throws {NotFoundError} No device has this fingerprint.
   */
  async get(fingerprint: string): Promise<Device> {
    return parseDevice(await this.request('GET', devicePath(fingerprint)));
  }

  /**
   * Sets whether the device is disregarded, and returns it.
   *
   * A disregarded device, such as a shared office machine, no longer links the identities seen
   * on it.
   *
   * @throws {NotFoundError} No device has this fingerprint.
   */
  async update(fingerprint: string, changes: { disregarded: boolean }): Promise<Device> {
    const path = devicePath(fingerprint);

    return parseDevice(
      await this.request('PATCH', path, { disregarded: Boolean(changes?.disregarded) }),
    );
  }
}

// Escalations --------------------------------------------------------------------------------

function escalationsList(filters: EscalationFilters, options: ListOptions): ListCall<Escalation> {
  return {
    path: '/escalations',
    parse: parseEscalation,
    filters: {
      status: filters.status === undefined ? undefined : escalationStatus(filters.status),
      severity: filters.severity ? filters.severity.toUpperCase() : undefined,
      identity: filters.identity,
      rule: filters.rule,
    },
    options,
  };
}

function escalationPath(escalationId: number | string): string {
  return `/escalations/${segment(escalationId, 'An escalation id')}`;
}

/**
 * Read the escalations your escalation rules open, and move them along.
 *
 * Reached as `client.escalations`.
 */
export class Escalations extends Resource {
  /**
   * Returns one page of escalations, newest first.
   *
   * `sort` takes a field such as `"openedAt"` or `"severity"`.
   *
   * @throws {TypeError} `status` is not `"open"`, `"acknowledged"`, or `"closed"`.
   */
  async list(options: EscalationFilters & PageOptions = {}): Promise<Page<Escalation>> {
    return this.page(escalationsList(options, options), options.page);
  }

  /**
   * Yields every escalation that matches, fetching pages as it goes. See
   * {@link Escalations.list}.
   */
  listAll(
    options: EscalationFilters & ListOptions = {},
  ): AsyncGenerator<Escalation, void, undefined> {
    return this.walk(escalationsList(options, options));
  }

  /**
   * Returns the escalation with this id.
   *
   * @throws {NotFoundError} No escalation has this id.
   */
  async get(escalationId: number | string): Promise<Escalation> {
    return parseEscalation(await this.request('GET', escalationPath(escalationId)));
  }

  /**
   * Moves the escalation to `status` (`"open"`, `"acknowledged"`, or `"closed"`).
   *
   * @throws {NotFoundError} No escalation has this id.
   * @throws {TypeError} The status is not one of the three.
   */
  async update(
    escalationId: number | string,
    changes: { status: EscalationStatus },
  ): Promise<Escalation> {
    const path = escalationPath(escalationId);
    const body = { status: escalationStatus(changes?.status) };

    return parseEscalation(await this.request('PATCH', path, body));
  }

  /** Returns how many escalations are open, acknowledged, and closed. */
  async summary(): Promise<EscalationSummary> {
    return parseEscalationSummary(await this.request('GET', '/escalations/summary'));
  }
}
