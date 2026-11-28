import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const pkg = (name: string) => fileURLToPath(new URL(`./packages/${name}/src/index.ts`, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@architect-studio/core": pkg("core"),
      "@architect-studio/generators": pkg("generators"),
      "@architect-studio/packager": pkg("packager"),
      "@architect-studio/validators": pkg("validators"),
      "@architect-studio/reverse": pkg("reverse"),
      "@architect-studio/sandbox": pkg("sandbox"),
    },
  },
  test: {
    include: ["packages/**/tests/**/*.test.ts"],
    environment: "node",
  },
});
