/**
 * The `client.identities` namespace.
 *
 * These are thin: they name the endpoint, then hand the response to a parser. The transport,
 * retries, and error mapping all live on the client.
 *
 * @module
 */

import type { Analysis, Identity, Scores } from './models.js';
import { parseAnalysis, parseIdentity, parseScores } from './models.js';

/** How a resource reaches the client's transport. @internal */
export type RequestFn = (method: string, path: string, body?: unknown) => Promise<unknown>;

function path(identityId: string, suffix = ''): string {
  if (!identityId) {
    throw new TypeError('An identity id is required.');
  }

  // Identity ids are the caller's own user ids and routinely contain characters that need
  // escaping, an email address being the common one.
  return `/identities/${encodeURIComponent(identityId)}${suffix}`;
}

/**
 * Read identities and their scores.
 *
 * Reached as `client.identities`; there is no reason to construct one yourself.
 */
export class Identities {
  readonly #request: RequestFn;

  /** @internal */
  constructor(request: RequestFn) {
    this.#request = request;
  }

  /**
   * Returns the identity, with its current scores, badges, and attributes.
   *
   * @param identityId Your own id for the user, the one you pass to `track()`.
   * @throws {NotFoundError} Dregs has never seen this identity.
   */
  async get(identityId: string): Promise<Identity> {
    return parseIdentity(await this.#request('GET', path(identityId)));
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
    return parseScores(await this.#request('GET', path(identityId, '/scores')));
  }

  /**
   * Returns the most recent analysis cycle, with the observations behind each score.
   *
   * Use this when you need to show or log *why* an identity scored the way it did.
   *
   * @throws {NotFoundError} The identity is unknown, or it has not been analyzed yet.
   */
  async analysis(identityId: string): Promise<Analysis> {
    return parseAnalysis(await this.#request('GET', path(identityId, '/analysis')));
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
    await this.#request('POST', path(identityId, '/actions/analyze'));
  }
}
