# Contributing

Thanks for improving Architect Studio. This repository is a pnpm workspace on Nx 24, and all
packages are TypeScript. Please keep changes small, typed and covered by the existing suites.

## Setup

Node **24.22.1** and pnpm 10 are required; the pinned version lives in `.nvmrc` (the
`rea-agents` launcher needs `^22.23.4 || ^24.22.1 || >=26.12.1`).

```bash
nvm use            # or: fnm use
pnpm install
```

## Checks

Run these before opening a pull request. Both must exit `0`.

```bash
pnpm typecheck     # nx run-many -t typecheck (9 projects)
pnpm test          # nx run-many -t test (265 tests, 27 files)
```

To scope a run to one package while iterating:

```bash
pnpm nx run app:typecheck
pnpm nx run app:test
pnpm nx run app:test --skip-nx-cache
```

Nx caches task results; add `--skip-nx-cache` when you suspect a stale pass. The repo has no
separate lint target — `typecheck` is the static gate.

## Adding a package

Use the local generator instead of copying a package by hand:

```bash
pnpm nx g @architect-studio/workspace-plugin:package order-flow \
  --description="Order flow orchestration"

# Preview without writing anything
pnpm nx g @architect-studio/workspace-plugin:package order-flow --dry-run
```

It creates `packages/<name>/project.json`, `tsconfig.json`, `src/index.ts` and
`tests/<name>.test.ts` with the repo's conventions. Names must be kebab-case and must not
already exist. Declare real cross-package dependencies in the new `project.json` under
`implicitDependencies`, because packages import each other by relative path and Nx cannot infer
those edges.

## Conventions

- Public HTTP behaviour is a contract: update `packages/app/src/contract.ts`, its schema tests
  and the matching section of `FRONTEND_SPEC.md` together. The spec/`ENDPOINTS` parity test
  fails otherwise.
- Keep generated documents and error strings localized through `packages/core/src/i18n`.
- Do not send API keys to disk, logs or generated packages.
- Keep the README, `README.tr.md` and `PROJECT-SUMMARY.md` in sync when user-visible behaviour
  or test counts change.

## Pull requests

Fill in `.github/pull_request_template.md`, keep the history readable (conventional commit
subjects such as `feat(app): …`, `fix(ci): …`, `docs: …`) and describe the verification you
ran. Never commit secrets, `.architect/cache/` or `.nx/` output.
