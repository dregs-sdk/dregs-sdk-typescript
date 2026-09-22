/** The identities namespace and the models it returns. */

import { describe, expect, it } from 'vitest';

import { Scores } from '../src/models.js';

import { BASE_URL, empty, json, makeClient, stubFetch } from './helpers.js';

const IDENTITY = {
  id: 'user_12345',
  displayName: 'Ada Lovelace',
  displayEmail: 'ada@example.com',
  displayUsername: 'ada',
  humanityScore: 85,
  authenticityScore: 72,
  uniquenessScore: 91,
  behaviorScore: 68,
  createdAt: '2026-09-01T10:00:00Z',
  lastTrackedAt: '2026-09-21T14:20:00Z',
  disregarded: false,
  badges: [{ slug: 'behavior.account-takeover-signal', name: 'Account Takeover Suspected' }],
  data: { email: 'ada@example.com', plan: 'pro' },
};

const ANALYSIS = {
  id: 2000871,
  identityId: 'user_12345',
  scores: [
    {
      category: 'HUMANITY',
      value: 85,
      observations: [
        {
          category: 'HUMANITY',
          id: 'humanity.user-agent',
          label: 'User Agent Analysis',
          explanation: 'Browser fingerprint consistent with standard Chrome on macOS',
          value: 0.92,
          confidence: 0.85,
          weight: 0.85,
          metadata: { browser: 'Chrome' },
        },
      ],
    },
    { category: 'BEHAVIOR', value: 68, observations: [] },
  ],
  eventCount: 47,
  deviceCount: 2,
  durationMillis: 312,
  startedAt: '2026-09-21T14:22:09Z',
  finishedAt: '2026-09-21T14:22:09Z',
};

describe('get', () => {
  it('parses an identity', async () => {
    const identity = await makeClient(stubFetch(json(200, IDENTITY))).identities.get('user_12345');

    expect(identity.id).toBe('user_12345');
    expect(identity.displayEmail).toBe('ada@example.com');
    expect(identity.displayUsername).toBe('ada');
    expect(identity.humanityScore).toBe(85);
    expect(identity.disregarded).toBe(false);
    expect(identity.data.plan).toBe('pro');
    expect(identity.createdAt?.getUTCFullYear()).toBe(2026);
    expect(identity.lastScoredAt).toBeNull();
  });

  it('parses badges', async () => {
    const identity = await makeClient(stubFetch(json(200, IDENTITY))).identities.get('user_12345');

    expect(identity.badges).toHaveLength(1);
    expect(identity.badges[0]?.name).toBe('Account Takeover Suspected');
    expect(identity.badges[0]?.metadata).toEqual({});
  });

  it('exposes the same scores view as the scores call', async () => {
    const identity = await makeClient(stubFetch(json(200, IDENTITY))).identities.get('user_12345');

    expect(identity.scores).toBeInstanceOf(Scores);
    expect(identity.scores.humanity).toBe(85);
    expect(identity.scores.behavior).toBe(68);
    expect(identity.scores).toHaveLength(4);
  });

  it('leaves an unscored category out of the scores view', async () => {
    const identity = await makeClient(
      stubFetch(json(200, { id: 'user_12345', humanityScore: 85 })),
    ).identities.get('user_12345');

    expect(identity.scores).toHaveLength(1);
    expect(identity.scores.behavior).toBeNull();
  });

  it('escapes an identity id that needs it', async () => {
    const stub = stubFetch(json(200, { id: 'ada@example.com' }));

    await makeClient(stub).identities.get('ada@example.com');

    expect(stub.lastCall().url).toBe(`${BASE_URL}/identities/ada%40example.com`);
  });

  it('escapes a slash so it cannot climb the path', async () => {
    const stub = stubFetch(json(200, { id: 'a/b' }));

    await makeClient(stub).identities.get('tenant/../admin');

    expect(stub.lastCall().url).toBe(`${BASE_URL}/identities/tenant%2F..%2Fadmin`);
  });

  it('refuses an empty identity id before any request', async () => {
    const stub = stubFetch(json(200, {}));

    await expect(makeClient(stub).identities.get('')).rejects.toThrow(/identity id is required/);
    expect(stub.callCount).toBe(0);
  });
});

describe('scores', () => {
  const ALL = json(200, [
    { category: 'HUMANITY', value: 85 },
    { category: 'AUTHENTICITY', value: 72 },
    { category: 'UNIQUENESS', value: 91 },
    { category: 'BEHAVIOR', value: 68 },
  ]);

  it('exposes each category by name', async () => {
    const scores = await makeClient(stubFetch(ALL)).identities.scores('user_12345');

    expect(scores.humanity).toBe(85);
    expect(scores.authenticity).toBe(72);
    expect(scores.uniqueness).toBe(91);
    expect(scores.behavior).toBe(68);
  });

  it('reaches the scores endpoint', async () => {
    const stub = stubFetch(ALL);

    await makeClient(stub).identities.scores('user_12345');

    expect(stub.lastCall().url).toBe(`${BASE_URL}/identities/user_12345/scores`);
    expect(stub.lastCall().init.method).toBe('GET');
  });

  it('behaves as an array', async () => {
    const scores = await makeClient(
      stubFetch(
        json(200, [
          { category: 'HUMANITY', value: 85 },
          { category: 'BEHAVIOR', value: 68 },
        ]),
      ),
    ).identities.scores('user_12345');

    expect(scores).toHaveLength(2);
    expect(scores[0]?.value).toBe(85);
    expect([...scores].map((s) => s.category)).toEqual(['HUMANITY', 'BEHAVIOR']);
    expect(scores.map((s) => s.value)).toEqual([85, 68]);
  });

  it('maps to a plain array rather than trying to rebuild itself', async () => {
    const scores = await makeClient(stubFetch(ALL)).identities.scores('user_12345');

    expect(scores.map((s) => s.value)).toBeInstanceOf(Array);
    expect(scores.filter(() => true)).not.toBeInstanceOf(Scores);
  });

  it('reads an unscored category as null', async () => {
    const scores = await makeClient(
      stubFetch(json(200, [{ category: 'HUMANITY', value: 85 }])),
    ).identities.scores('user_12345');

    expect(scores.humanity).toBe(85);
    expect(scores.behavior).toBeNull();
    expect(scores.get('BEHAVIOR')).toBeNull();
    expect(scores.get('HUMANITY')?.value).toBe(85);
  });

  it('comes back empty for an identity with no scores yet', async () => {
    const scores = await makeClient(stubFetch(json(200, []))).identities.scores('user_12345');

    expect(scores).toHaveLength(0);
    expect(scores.humanity).toBeNull();
  });

  it('carries no observations', async () => {
    const scores = await makeClient(
      stubFetch(json(200, [{ category: 'HUMANITY', value: 85 }])),
    ).identities.scores('user_12345');

    expect(scores[0]?.observations).toEqual([]);
  });
});

describe('analysis', () => {
  it('parses a cycle and its observations', async () => {
    const analysis = await makeClient(stubFetch(json(200, ANALYSIS))).identities.analysis(
      'user_12345',
    );

    expect(analysis.id).toBe(2000871);
    expect(analysis.identityId).toBe('user_12345');
    expect(analysis.eventCount).toBe(47);
    expect(analysis.deviceCount).toBe(2);
    expect(analysis.durationMillis).toBe(312);
    expect(analysis.finishedAt).toBeInstanceOf(Date);
    expect(analysis.scores.humanity).toBe(85);

    const observation = analysis.scores[0]?.observations[0];

    expect(observation?.id).toBe('humanity.user-agent');
    expect(observation?.label).toBe('User Agent Analysis');
    expect(observation?.value).toBe(0.92);
    expect(observation?.confidence).toBe(0.85);
    expect(observation?.weight).toBe(0.85);
    expect(observation?.metadata.browser).toBe('Chrome');
  });

  it('flattens observations across categories', async () => {
    const analysis = await makeClient(stubFetch(json(200, ANALYSIS))).identities.analysis(
      'user_12345',
    );

    expect(analysis.observations).toHaveLength(1);
    expect(analysis.observations[0]?.category).toBe('HUMANITY');
  });

  it('reaches the analysis endpoint', async () => {
    const stub = stubFetch(json(200, ANALYSIS));

    await makeClient(stub).identities.analysis('user_12345');

    expect(stub.lastCall().url).toBe(`${BASE_URL}/identities/user_12345/analysis`);
  });
});

describe('analyze', () => {
  it('posts to the action endpoint and sends no body', async () => {
    const stub = stubFetch(empty(201));

    await makeClient(stub).identities.analyze('user_12345');

    expect(stub.lastCall().url).toBe(`${BASE_URL}/identities/user_12345/actions/analyze`);
    expect(stub.lastCall().init.method).toBe('POST');
    expect(stub.lastCall().init.body).toBeUndefined();
  });
});

describe('forward compatibility', () => {
  it('keeps an unknown field on raw', async () => {
    const identity = await makeClient(
      stubFetch(json(200, { id: 'user_12345', somethingNew: 42 })),
    ).identities.get('user_12345');

    expect(identity.raw.somethingNew).toBe(42);
  });

  it('does not break on an unknown score category', async () => {
    const scores = await makeClient(
      stubFetch(
        json(200, [
          { category: 'REPUTATION', value: 50 },
          { category: 'HUMANITY', value: 85 },
        ]),
      ),
    ).identities.scores('user_12345');

    expect(scores).toHaveLength(2);
    expect(scores.humanity).toBe(85);
    expect(scores[0]?.category).toBeNull();
    expect(scores[0]?.raw.category).toBe('REPUTATION');
  });

  it('reads a missing field as null rather than throwing', async () => {
    const identity = await makeClient(stubFetch(json(200, {}))).identities.get('user_12345');

    expect(identity.id).toBeNull();
    expect(identity.displayName).toBeNull();
    expect(identity.createdAt).toBeNull();
    expect(identity.badges).toEqual([]);
    expect(identity.data).toEqual({});
  });

  it('reads an unparseable timestamp as null', async () => {
    const identity = await makeClient(
      stubFetch(json(200, { id: 'user_12345', createdAt: 'the day before yesterday' })),
    ).identities.get('user_12345');

    expect(identity.createdAt).toBeNull();
  });

  it('survives a scores body that is not an array', async () => {
    const scores = await makeClient(stubFetch(json(200, { unexpected: true }))).identities.scores(
      'user_12345',
    );

    expect(scores).toHaveLength(0);
  });
});
