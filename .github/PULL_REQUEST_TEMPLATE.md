## What this changes

<!-- A sentence or two. If it changes the public surface, say so plainly: this SDK is a port of
     the reference Python SDK, and the Java, Ruby, and PHP ports share its shape. -->

## Checklist

- [ ] `npm test` passes
- [ ] `npm run lint` and `npm run format:check` pass
- [ ] `npm run typecheck` passes
- [ ] `npm run build` and `npm run verify:package` pass, if the entry points or `exports` changed
- [ ] New behavior has a test, or the fix has one that failed before it
- [ ] `package-lock.json` is committed, if dependencies changed
- [ ] `CHANGELOG.md` has an entry under Unreleased, for anything user-visible
