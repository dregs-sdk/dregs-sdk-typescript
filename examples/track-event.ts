/**
 * Send a backend event to Dregs.
 *
 * Run it with your credential's secret key in the environment:
 *
 *     DREGS_SECRET_KEY=sk_... npx tsx examples/track-event.ts
 */

import { Dregs, DregsError, QuotaExceededError, RateLimitError } from '../src/index.js';

async function main(): Promise<void> {
  const client = new Dregs();

  try {
    const result = await client.track('user.signup', {
      identity: 'user_12345',
      // Attributes of the event.
      data: { plan: 'pro', referrer: 'partner-x' },
      // Attributes of the user. The analyzers lean on these, so send what you have.
      identityData: {
        email: 'ada@example.com',
        name: 'Ada Lovelace',
        username: 'ada',
      },
      // Your own id for the event makes ingestion idempotent: resending this exact call is a
      // no-op rather than a second signup.
      eventId: 'signup-991',
    });

    if (result.accepted) {
      console.log(`Recorded event ${result.id}.`);
    } else {
      // Dregs answers a few rejections quietly rather than naming the check that failed.
      console.log(`The event was not recorded (status ${result.status}).`);
    }
  } catch (error) {
    if (error instanceof QuotaExceededError) {
      console.log('Over the monthly event limit. The event was not recorded.');
    } else if (error instanceof RateLimitError) {
      console.log(`Rate limited. Retry after ${error.retryAfter ?? 'a moment'}.`);
    } else if (error instanceof DregsError) {
      console.log(`Could not reach Dregs: ${error.toString()}`);
    } else {
      throw error;
    }
  }
}

await main();
