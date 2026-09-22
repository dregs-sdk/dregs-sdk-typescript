/**
 * Loads the built package the way a consumer would, both ways.
 *
 * A dual-format build that only ever gets imported one way is a build with half its output
 * untested. The identity checks matter as much as the loading: if the two entry points end up
 * with separate copies of the modules they share, `verifyWebhook` imported from `dregs` and
 * from `dregs/webhooks` are different functions, and a `WebhookVerificationError` thrown by one
 * fails an `instanceof` check against the class exported by the other. Code splitting is what
 * prevents that, and this is what proves it.
 */

import { createRequire } from 'node:module';

import * as esmRoot from '../dist/index.js';
import * as esmWebhooks from '../dist/webhooks.js';

const require = createRequire(import.meta.url);

const cjsRoot = require('../dist/index.cjs');
const cjsWebhooks = require('../dist/webhooks.cjs');

function check(condition, description) {
  if (!condition) {
    console.error(`FAIL  ${description}`);
    process.exitCode = 1;

    return;
  }

  console.log(`ok    ${description}`);
}

for (const [format, root, webhooks] of [
  ['esm', esmRoot, esmWebhooks],
  ['cjs', cjsRoot, cjsWebhooks],
]) {
  check(typeof root.Dregs === 'function', `${format}: the root exports the Dregs class`);
  check(typeof root.VERSION === 'string', `${format}: the root exports a version`);
  check(
    typeof webhooks.verifyWebhook === 'function',
    `${format}: the webhooks subpath exports verifyWebhook`,
  );
  check(
    root.verifyWebhook === webhooks.verifyWebhook,
    `${format}: both entry points share one verifyWebhook`,
  );

  let thrown;

  try {
    webhooks.verifyWebhook({ payload: '{}', signature: 'not-a-signature', secret: 'whsec_x' });
  } catch (error) {
    thrown = error;
  }

  check(
    thrown instanceof root.WebhookVerificationError,
    `${format}: an error from the subpath is instanceof the root's class`,
  );
}
