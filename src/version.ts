/**
 * The package version, used in the `User-Agent` header.
 *
 * Kept here rather than read from `package.json` at runtime, because the published package is
 * both ESM and CommonJS and neither can reach its own manifest portably. A test asserts this
 * stays in step with `package.json`, so the two cannot drift.
 */
export const VERSION = '0.1.0';
