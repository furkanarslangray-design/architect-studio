/**
 * Local Nx plugin for this workspace.
 *
 * Generators keep `packages/*` uniform (project.json targets, tsconfig, source and
 * Vitest suite). Run them through Nx:
 *
 * ```bash
 * pnpm nx g @architect-studio/workspace-plugin:package order-flow \
 *   --description="Order flow orchestration"
 * pnpm nx g @architect-studio/workspace-plugin:package order-flow --dry-run
 * ```
 */
export const WORKSPACE_PLUGIN = "@architect-studio/workspace-plugin" as const;
