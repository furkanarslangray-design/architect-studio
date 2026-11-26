## What changed

<!-- One or two sentences. Link the issue when there is one: Closes #123. -->

## Affected packages

<!-- e.g. app, reverse, docs -->

## Checklist

- [ ] `pnpm typecheck` exits `0`
- [ ] `pnpm test` exits `0` (or the affected package's `pnpm nx run <pkg>:test`)
- [ ] New behaviour is covered by a test where it is testable offline
- [ ] `packages/app/src/contract.ts` schemas and tests are updated with any HTTP change
- [ ] `FRONTEND_SPEC.md` still matches the shipped endpoints and response shapes
- [ ] `README.md` / `README.tr.md` / `PROJECT-SUMMARY.md` reflect user-visible changes and test counts
- [ ] No secrets, `.architect/cache/` or `.nx/` output committed

## Verification

<!-- Commands you ran and the result, plus anything you could not check (e.g. Docker image). -->
