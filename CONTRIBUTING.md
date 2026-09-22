# Contributing

Thanks for helping improve the Dregs TypeScript SDK.

This SDK is a **port of the reference SDK**, [dregs-sdk-python](https://github.com/dregs-sdk/dregs-sdk-python),
which the SDKs for TypeScript, Java, Ruby, and PHP all follow in shape. A change to the public
surface here is a change to all of them, so surface changes are worth discussing in an issue
before you write the code.

## Getting set up

You need Node 20 or newer. Nothing else: the SDK itself has no runtime dependencies, and `npm ci`
installs the locked development set.

```bash
npm ci
```

Then:

```bash
npm test                  # tests
npm run lint              # eslint
npm run format:check      # prettier
npm run typecheck         # tsc --noEmit, in strict mode
npm run build             # tsup, ESM + CJS + declarations
npm run verify:package    # publint and are-the-types-wrong over the built package
npm run verify:dist       # load dist/ as both ESM and CommonJS
```

CI runs exactly these, against the same locked versions, so a green run locally means a green run
there. Tests run on Node 20, 22, and 24.

If you change a dependency in `package.json`, commit the resulting `package-lock.json` alongside
it. CI installs with `npm ci` and fails if the two disagree.

## What we look for

- **Tests.** The suite hands the client its own `fetch` stub, so tests are fast and hit no
  network and no mocking library. New behavior needs a test; a bug fix needs one that fails
  without it.
- **Types.** `tsc` runs in strict mode over `src`, `test`, and `examples`. Every public type is
  exported, so consumers get the full surface with no `@types` package.
- **Lenient parsing.** Models tolerate fields they do not recognize and keep the raw body in
  `raw`. An SDK that throws on a response it half-understands ages badly.
- **No runtime dependencies.** The package has none, deliberately: it calls the runtime's own
  `fetch` and `node:crypto`. Adding one needs a good reason.
- **Both module formats.** The package publishes ESM and CommonJS. If you add an entry point,
  add it to `tsup.config.ts` and to the `exports` map, and check `npm run verify:package`.

## The API this wraps

The [Dregs manual](https://dregs.com/manual/api/) is the source of truth for the REST API. If
this SDK disagrees with the manual, the manual wins; please say so in your pull request so both
get fixed.

## Reporting problems

Bugs and feature requests go to
[GitHub issues](https://github.com/dregs-sdk/dregs-sdk-typescript/issues). Security reports go to
[security@dregs.com](mailto:security@dregs.com) instead — see [SECURITY.md](SECURITY.md).
Questions about your account or the service go to [support@dregs.com](mailto:support@dregs.com).
