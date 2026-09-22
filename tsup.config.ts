import { defineConfig } from 'tsup';

/**
 * Two entry points, two module formats.
 *
 * The webhook helpers get their own entry so a webhook receiver can import `@dregs/sdk/webhooks`
 * without naming the client. Both ESM and CommonJS are emitted: this is a backend SDK, and a
 * large share of Node backends are still CommonJS, so ESM-only output would shut them out for
 * no gain. Declarations are generated for both, which is what `exports` points its `types`
 * conditions at.
 *
 * Splitting is on, and load-bearing rather than a size optimization. Without it each entry
 * bundles its own copy of the error classes, and a `WebhookVerificationError` thrown by
 * `@dregs/sdk/webhooks` fails an `instanceof` check against the one exported from `@dregs/sdk`. The
 * shared chunk gives both entries the same classes. A CI step asserts this on the built output.
 */
export default defineConfig({
  entry: ['src/index.ts', 'src/webhooks.ts'],
  format: ['esm', 'cjs'],
  target: 'node20',
  platform: 'node',
  dts: true,
  sourcemap: true,
  clean: true,
  treeshake: true,
  splitting: true,
});
