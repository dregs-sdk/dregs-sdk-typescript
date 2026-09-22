/**
 * Read an identity's scores, and the observations behind them.
 *
 *     DREGS_SECRET_KEY=sk_... npx tsx examples/read-scores.ts user_12345
 */

import { Dregs, NotFoundError } from '../src/index.js';

function format(score: number | null): string {
  return score === null ? 'not scored' : String(score);
}

async function main(): Promise<void> {
  const identityId = process.argv[2] ?? 'user_12345';
  const client = new Dregs();

  const scores = await client.identities.scores(identityId).catch((error: unknown) => {
    if (error instanceof NotFoundError) {
      return null;
    }

    throw error;
  });

  if (scores === null) {
    console.log(`Dregs has never seen ${identityId}.`);

    return;
  }

  if (scores.length === 0) {
    console.log(`${identityId} has not been scored yet. Scoring runs shortly after new activity.`);

    return;
  }

  console.log(`Scores for ${identityId}`);
  console.log(`  Humanity:     ${format(scores.humanity)}`);
  console.log(`  Authenticity: ${format(scores.authenticity)}`);
  console.log(`  Uniqueness:   ${format(scores.uniqueness)}`);
  console.log(`  Behavior:     ${format(scores.behavior)}`);

  // The scores are the summary. The observations are the evidence, and they come from the
  // analysis cycle rather than from the scores endpoint.
  const analysis = await client.identities.analysis(identityId).catch((error: unknown) => {
    if (error instanceof NotFoundError) {
      return null;
    }

    throw error;
  });

  if (analysis === null) {
    console.log('\nNo analysis cycle has finished for this identity yet.');

    return;
  }

  console.log(`\nWhy, from the cycle of ${analysis.finishedAt?.toISOString() ?? 'unknown'}:`);

  const worstFirst = [...analysis.observations].sort((a, b) => (a.value ?? 1) - (b.value ?? 1));

  for (const observation of worstFirst) {
    console.log(`  [${observation.category ?? 'UNKNOWN'}] ${observation.label}`);
    console.log(`      ${observation.explanation}`);
    console.log(`      value ${observation.value}, confidence ${observation.confidence}`);
  }
}

await main();
