/** The groups, events, devices, and escalations namespaces, the rest of identities, and paging. */

import { describe, expect, it } from 'vitest';

import { BASE_URL, empty, json, makeClient, stubFetch } from './helpers.js';

/** A `V1Page` body, as every list endpoint returns one. */
function page(
  content: Record<string, unknown>[],
  { number = 0, last = true, total }: { number?: number; last?: boolean; total?: number } = {},
): Record<string, unknown> {
  return {
    pageNumber: number,
    pageSize: 2,
    totalPages: last ? number + 1 : number + 2,
    totalElements: total ?? content.length,
    content,
    first: number === 0,
    last,
    numberOfElements: content.length,
  };
}

/** The query parameters of a request URL. */
function params(url: string): URLSearchParams {
  return new URL(url).searchParams;
}

const GROUP = {
  type: 'organization',
  id: 'org_678',
  displayName: 'Acme Inc',
  identityCount: 12,
  createdAt: '2026-10-01T10:00:00Z',
  lastTrackedAt: '2026-10-15T10:00:00Z',
  data: { name: 'Acme Inc', plan: 'enterprise' },
};

describe('paging', () => {
  it('sends the page and the filters, and drops unset ones', async () => {
    const stub = stubFetch(json(200, page([])));

    await makeClient(stub).identities.list({
      term: 'ada',
      page: 2,
      pageSize: 50,
      sort: 'humanityScore',
      order: 'asc',
    });

    const sent = params(stub.lastCall().url);

    expect(stub.lastCall().url.startsWith(`${BASE_URL}/identities?`)).toBe(true);
    expect(sent.get('term')).toBe('ada');
    expect(sent.get('pageNumber')).toBe('2');
    expect(sent.get('pageSize')).toBe('50');
    expect(sent.get('sort')).toBe('humanityScore');
    expect(sent.get('order')).toBe('ASC');
    expect(sent.has('group')).toBe(false);
    expect(sent.has('badge')).toBe(false);
  });

  it('asks for the first page when none is named', async () => {
    const stub = stubFetch(json(200, page([])));

    await makeClient(stub).identities.list();

    expect(params(stub.lastCall().url).get('pageNumber')).toBe('0');
    expect(params(stub.lastCall().url).has('pageSize')).toBe(false);
  });

  it('returns a page that is iterable and knows its position', async () => {
    const result = await makeClient(
      stubFetch(json(200, page([{ id: 'a' }, { id: 'b' }], { last: false, total: 5 }))),
    ).identities.list();

    expect(result.items.map((i) => i.id)).toEqual(['a', 'b']);
    expect([...result].map((i) => i.id)).toEqual(['a', 'b']);
    expect(result.totalElements).toBe(5);
    expect(result.pageNumber).toBe(0);
    expect(result.first).toBe(true);
    expect(result.last).toBe(false);
    expect(result.hasNext).toBe(true);
    expect(result.raw.numberOfElements).toBe(2);
  });

  it('walks every page with listAll', async () => {
    const stub = stubFetch(
      json(
        200,
        page(
          [
            { type: 'team', id: '1' },
            { type: 'team', id: '2' },
          ],
          { last: false },
        ),
      ),
      json(200, page([{ type: 'team', id: '3' }], { number: 1 })),
    );

    const ids: (string | null)[] = [];

    for await (const group of makeClient(stub).groups.listAll({ groupType: 'team' })) {
      ids.push(group.id);
    }

    expect(ids).toEqual(['1', '2', '3']);
    expect(stub.calls.map((c) => params(c.url).get('pageNumber'))).toEqual(['0', '1']);
    expect(stub.calls.every((c) => params(c.url).get('type') === 'team')).toBe(true);
  });

  it('stops listAll on an empty page even if it is not marked last', async () => {
    const stub = stubFetch(json(200, page([], { last: false })));

    const events = [];

    for await (const event of makeClient(stub).events.listAll()) {
      events.push(event);
    }

    expect(events).toEqual([]);
    expect(stub.callCount).toBe(1);
  });

  it('fetches nothing until listAll is iterated', () => {
    const stub = stubFetch(json(200, page([])));

    makeClient(stub).devices.listAll();

    expect(stub.callCount).toBe(0);
  });

  it('refuses a negative page before any request', async () => {
    const stub = stubFetch(json(200, page([])));

    await expect(makeClient(stub).devices.list({ page: -1 })).rejects.toThrow(/from 0/);
    expect(stub.callCount).toBe(0);
  });

  it('refuses an unknown order before any request', async () => {
    const stub = stubFetch(json(200, page([])));

    await expect(makeClient(stub).escalations.list({ order: 'sideways' as never })).rejects.toThrow(
      /asc/,
    );
    expect(stub.callCount).toBe(0);
  });

  it('survives a page body with no content', async () => {
    const result = await makeClient(stubFetch(json(200, {}))).groups.list();

    expect(result.items).toEqual([]);
    expect(result.hasNext).toBe(false);
  });
});

describe('identities', () => {
  it('fetches the analysis of a past cycle', async () => {
    const stub = stubFetch(json(200, { id: 2000871, identityId: 'user_12345', scores: [] }));

    const analysis = await makeClient(stub).identities.analysis('user_12345', 2000871);

    expect(stub.lastCall().url).toBe(`${BASE_URL}/identities/user_12345/analysis/2000871`);
    expect(analysis.id).toBe(2000871);
  });

  it('reads the score history', async () => {
    const stub = stubFetch(
      json(200, [
        {
          id: 9,
          humanityScore: 80,
          behaviorScore: 60,
          eventCount: 3,
          finishedAt: '2026-10-01T00:00:00Z',
        },
      ]),
    );

    const history = await makeClient(stub).identities.history('user_12345', { limit: 10 });

    expect(stub.lastCall().url).toBe(`${BASE_URL}/identities/user_12345/history?limit=10`);
    expect(history[0]?.cycleId).toBe(9);
    expect(history[0]?.humanity).toBe(80);
    expect(history[0]?.authenticity).toBeNull();
    expect(history[0]?.finishedAt).toBeInstanceOf(Date);
  });

  it('sends no limit on the history when none is given', async () => {
    const stub = stubFetch(json(200, []));

    await makeClient(stub).identities.history('user_12345');

    expect(stub.lastCall().url).toBe(`${BASE_URL}/identities/user_12345/history`);
  });

  it('reads the links', async () => {
    const links = await makeClient(
      stubFetch(
        json(200, [
          {
            id: 1,
            targetIdentityId: 'user_999',
            targetDisplayName: 'Bob',
            type: 'SAME_DEVICE',
            value: 0.9,
            confidence: 0.8,
          },
        ]),
      ),
    ).identities.links('user_12345');

    expect(links[0]?.identityId).toBe('user_999');
    expect(links[0]?.displayName).toBe('Bob');
    expect(links[0]?.type).toBe('SAME_DEVICE');
  });

  it('sends only what was given on update', async () => {
    const stub = stubFetch(json(200, { id: 'user_12345', disregarded: true }));

    const identity = await makeClient(stub).identities.update('user_12345', {
      disregarded: true,
    });

    expect(stub.lastCall().init.method).toBe('PATCH');
    expect(stub.lastBody()).toEqual({ disregarded: true });
    expect(identity.disregarded).toBe(true);
  });

  it('sends attributes on update', async () => {
    const stub = stubFetch(json(200, { id: 'user_12345' }));

    await makeClient(stub).identities.update('user_12345', { attributes: { plan: 'pro' } });

    expect(stub.lastBody()).toEqual({ attributes: { plan: 'pro' } });
  });

  it('refuses an update with nothing in it before any request', async () => {
    const stub = stubFetch(json(200, {}));

    await expect(makeClient(stub).identities.update('user_12345', {})).rejects.toThrow(
      /disregarded/,
    );
    expect(stub.callCount).toBe(0);
  });

  it('requests a review and reads the reviews back', async () => {
    const stub = stubFetch(
      json(201, {
        id: 7,
        identityId: 'user_12345',
        status: 'PENDING',
        userFeedback: 'real customer',
      }),
      json(200, [{ id: 7, status: 'FINISHED', summary: 'Looks fine.' }]),
    );
    const client = makeClient(stub);

    const review = await client.identities.review('user_12345', { feedback: 'real customer' });
    const reviews = await client.identities.reviews('user_12345');

    expect(stub.calls[0]?.url).toBe(`${BASE_URL}/identities/user_12345/actions/review`);
    expect(stub.calls[0]?.init.method).toBe('POST');
    expect(stub.bodyAt(0)).toEqual({ feedback: 'real customer' });
    expect(review.status).toBe('PENDING');
    expect(review.feedback).toBe('real customer');
    expect(stub.calls[1]?.url).toBe(`${BASE_URL}/identities/user_12345/reviews`);
    expect(reviews[0]?.summary).toBe('Looks fine.');
  });

  it('sends an empty body on a review without feedback', async () => {
    const stub = stubFetch(json(201, { id: 7, status: 'PENDING' }));

    await makeClient(stub).identities.review('user_12345');

    expect(stub.lastBody()).toEqual({});
  });
});

describe('groups', () => {
  it('gets a group', async () => {
    const stub = stubFetch(json(200, GROUP));

    const group = await makeClient(stub).groups.get('organization', 'org_678');

    expect(stub.lastCall().url).toBe(`${BASE_URL}/groups/organization/org_678`);
    expect(group.displayName).toBe('Acme Inc');
    expect(group.identityCount).toBe(12);
    expect(group.data.plan).toBe('enterprise');
    expect(group.createdAt).toBeInstanceOf(Date);
    expect(group.updatedAt).toBeNull();
  });

  it('defaults the type on create and sends the attributes', async () => {
    const stub = stubFetch(json(201, GROUP));

    const group = await makeClient(stub).groups.create('org_678', {
      attributes: { name: 'Acme Inc' },
    });

    expect(stub.lastCall().url).toBe(`${BASE_URL}/groups`);
    expect(stub.lastCall().init.method).toBe('POST');
    expect(stub.lastBody()).toEqual({
      type: 'organization',
      id: 'org_678',
      attributes: { name: 'Acme Inc' },
    });
    expect(group.id).toBe('org_678');
  });

  it('sends an empty object on create with no attributes', async () => {
    const stub = stubFetch(json(201, GROUP));

    await makeClient(stub).groups.create('team_42', { groupType: 'team' });

    expect(stub.lastBody()).toEqual({ type: 'team', id: 'team_42', attributes: {} });
  });

  it('merges attributes on update', async () => {
    const stub = stubFetch(json(200, GROUP));

    await makeClient(stub).groups.update('team', 'team_42', { name: 'Payments' });

    expect(stub.lastCall().url).toBe(`${BASE_URL}/groups/team/team_42`);
    expect(stub.lastCall().init.method).toBe('PATCH');
    expect(stub.lastBody()).toEqual({ attributes: { name: 'Payments' } });
  });

  it('adds and removes members, escaping the identity id', async () => {
    const stub = stubFetch(empty(204));
    const client = makeClient(stub);

    await expect(
      client.groups.addMember('team', 'team_42', 'ada@example.com'),
    ).resolves.toBeUndefined();
    await expect(
      client.groups.removeMember('team', 'team_42', 'ada@example.com'),
    ).resolves.toBeUndefined();

    const url = `${BASE_URL}/groups/team/team_42/identities/ada%40example.com`;

    expect(stub.calls.map((c) => [c.init.method, c.url])).toEqual([
      ['PUT', url],
      ['DELETE', url],
    ]);
  });

  it('refuses a missing id before any request', async () => {
    const stub = stubFetch(json(200, GROUP));
    const client = makeClient(stub);

    await expect(client.groups.get('team', '')).rejects.toThrow(/group id is required/);
    await expect(client.groups.get('', 'team_42')).rejects.toThrow(/group type is required/);
    await expect(client.groups.create('')).rejects.toThrow(/group id is required/);
    await expect(client.groups.addMember('team', 'team_42', '')).rejects.toThrow(
      /identity id is required/,
    );
    expect(stub.callCount).toBe(0);
  });

  it('refuses attributes that are not an object', async () => {
    const stub = stubFetch(json(200, GROUP));

    await expect(makeClient(stub).groups.update('team', 'team_42', ['x'] as never)).rejects.toThrow(
      /attributes must be an object/,
    );
    expect(stub.callCount).toBe(0);
  });
});

describe('events', () => {
  it('parses the groups and the identity', async () => {
    const stub = stubFetch(
      json(200, {
        id: 'signup-991',
        timestamp: '2026-10-15T10:00:00Z',
        identity: { id: 'user_12345', label: 'Ada', path: '/api/identities/user_12345' },
        groups: [
          { type: 'team', id: 'team_42', label: 'Payments', path: '/api/groups/team/team_42' },
        ],
        eventSource: 'node-sdk',
        eventName: 'user.signup',
        canonicalType: 'SIGNUP',
        eventData: { plan: 'pro' },
      }),
    );

    const event = await makeClient(stub).events.get('signup-991');

    expect(stub.lastCall().url).toBe(`${BASE_URL}/events/signup-991`);
    expect(event.name).toBe('user.signup');
    expect(event.source).toBe('node-sdk');
    expect(event.canonicalType).toBe('SIGNUP');
    expect(event.timestamp).toBeInstanceOf(Date);
    expect(event.identity?.id).toBe('user_12345');
    expect(event.identity?.label).toBe('Ada');
    expect(event.groups[0]?.type).toBe('team');
    expect(event.groups[0]?.label).toBe('Payments');
    expect(event.data.plan).toBe('pro');
  });

  it('reads a missing identity as null', async () => {
    const event = await makeClient(stubFetch(json(200, { id: 'e1' }))).events.get('e1');

    expect(event.identity).toBeNull();
    expect(event.groups).toEqual([]);
    expect(event.data).toEqual({});
  });

  it('sends the list filters', async () => {
    const stub = stubFetch(json(200, page([])));

    await makeClient(stub).events.list({
      identity: 'user_12345',
      group: 'team_42',
      groupType: 'team',
    });

    const sent = params(stub.lastCall().url);

    expect(sent.get('identity')).toBe('user_12345');
    expect(sent.get('group')).toBe('team_42');
    expect(sent.get('groupType')).toBe('team');
    expect(sent.has('session')).toBe(false);
  });
});

describe('devices', () => {
  it('updates a device', async () => {
    const stub = stubFetch(
      json(200, { fingerprint: 'abc123', disregarded: true, countryCode: 'US', latitude: 40.7 }),
    );

    const device = await makeClient(stub).devices.update('abc123', { disregarded: true });

    expect(stub.lastCall().url).toBe(`${BASE_URL}/devices/abc123`);
    expect(stub.lastCall().init.method).toBe('PATCH');
    expect(stub.lastBody()).toEqual({ disregarded: true });
    expect(device.disregarded).toBe(true);
    expect(device.countryCode).toBe('US');
    expect(device.latitude).toBe(40.7);
  });

  it('gets a device', async () => {
    const stub = stubFetch(json(200, { fingerprint: 'abc123', asnLabel: 'Example Hosting' }));

    const device = await makeClient(stub).devices.get('abc123');

    expect(stub.lastCall().url).toBe(`${BASE_URL}/devices/abc123`);
    expect(device.asnLabel).toBe('Example Hosting');
  });
});

describe('escalations', () => {
  it('upper-cases the status and severity on list', async () => {
    const stub = stubFetch(json(200, page([])));

    await makeClient(stub).escalations.list({ status: 'open', severity: 'critical', rule: 3 });

    const sent = params(stub.lastCall().url);

    expect(sent.get('status')).toBe('OPEN');
    expect(sent.get('severity')).toBe('CRITICAL');
    expect(sent.get('rule')).toBe('3');
  });

  it('updates an escalation', async () => {
    const stub = stubFetch(
      json(200, {
        id: 41,
        status: 'ACKNOWLEDGED',
        severity: 'WARNING',
        identity: { id: 'user_12345' },
        escalationRule: { id: '3', label: 'Low humanity' },
        scoreSnapshot: { humanity: 12 },
      }),
    );

    const escalation = await makeClient(stub).escalations.update(41, { status: 'acknowledged' });

    expect(stub.lastCall().url).toBe(`${BASE_URL}/escalations/41`);
    expect(stub.lastCall().init.method).toBe('PATCH');
    expect(stub.lastBody()).toEqual({ status: 'ACKNOWLEDGED' });
    expect(escalation.id).toBe(41);
    expect(escalation.identity?.id).toBe('user_12345');
    expect(escalation.rule?.label).toBe('Low humanity');
    expect(escalation.scores.humanity).toBe(12);
  });

  it('refuses an unknown status before any request', async () => {
    const stub = stubFetch(json(200, {}));
    const client = makeClient(stub);

    await expect(client.escalations.update(41, { status: 'snoozed' as never })).rejects.toThrow(
      /acknowledged/,
    );
    await expect(client.escalations.list({ status: 'snoozed' as never })).rejects.toThrow(
      /acknowledged/,
    );
    expect(stub.callCount).toBe(0);
  });

  it('reads the summary', async () => {
    const stub = stubFetch(json(200, { open: 3, acknowledged: 1, closed: 20 }));

    const summary = await makeClient(stub).escalations.summary();

    expect(stub.lastCall().url).toBe(`${BASE_URL}/escalations/summary`);
    expect([summary.open, summary.acknowledged, summary.closed]).toEqual([3, 1, 20]);
  });
});
