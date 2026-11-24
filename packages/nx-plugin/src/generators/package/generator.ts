/**
 * Local Nx generator: `nx g @architect-studio/workspace-plugin:package <name>`.
 *
 * Every existing library in `packages/` follows the same shape — a `project.json`
 * with `typecheck`/`test` targets, a `tsconfig.json` extending `tsconfig.base.json`,
 * `src/index.ts` and a Vitest suite — so the generator writes exactly that shape.
 * It uses the tree the Nx host passes in and therefore needs no plugin runtime.
 */

export interface Tree {
  exists(path: string): boolean;
  read(path: string, encoding: "utf-8"): string | null;
  write(path: string, content: string): void;
}

export interface PackageGeneratorSchema {
  /** Package name in kebab-case; becomes `packages/<name>` and the Nx project name. */
  name: string;
  /** One-line purpose used in the generated module JSDoc and summary. */
  description?: string;
}

const NAME_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

function toPascalCase(value: string): string {
  return value
    .split("-")
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join("");
}

function toCamelCase(value: string): string {
  const pascal = toPascalCase(value);
  return pascal[0].toLowerCase() + pascal.slice(1);
}

function projectJson(name: string): string {
  return `${JSON.stringify(
    {
      name,
      $schema: "../../node_modules/nx/schemas/project-schema.json",
      sourceRoot: `packages/${name}/src`,
      projectType: "library",
      tags: ["type:lib"],
      targets: {
        typecheck: {
          executor: "nx:run-commands",
          options: { command: `tsc --noEmit -p packages/${name}/tsconfig.json` },
        },
        test: {
          executor: "nx:run-commands",
          options: { command: `vitest run packages/${name}` },
        },
      },
    },
    null,
    2,
  )}\n`;
}

function tsconfigJson(): string {
  return `${JSON.stringify(
    {
      extends: "../../tsconfig.base.json",
      include: ["src/**/*.ts", "tests/**/*.ts"],
    },
    null,
    2,
  )}\n`;
}

function sourceFile(name: string, description: string): string {
  const pascal = toPascalCase(name);
  return `/**
 * ${description}
 *
 * Scaffolded by \`pnpm nx g @architect-studio/workspace-plugin:package ${name}\`.
 */

export const PACKAGE_NAME = "${name}" as const;

export interface ${pascal}PackageInfo {
  name: typeof PACKAGE_NAME;
  root: string;
}

export const ${toCamelCase(name)}Package: ${pascal}PackageInfo = {
  name: PACKAGE_NAME,
  root: \`packages/\${PACKAGE_NAME}\`,
};
`;
}

function testFile(name: string): string {
  const pascal = toPascalCase(name);
  return `import { describe, expect, it } from "vitest";

import { PACKAGE_NAME, ${toCamelCase(name)}Package } from "../src/index";

describe("${name}", () => {
  it("exposes its package identity", () => {
    expect(PACKAGE_NAME).toBe("${name}");
    expect(${toCamelCase(name)}Package).toEqual({ name: "${name}", root: "packages/${name}" });
  });
});
`;
}

export default async function packageGenerator(tree: Tree, options: PackageGeneratorSchema): Promise<void> {
  const name = (options.name ?? "").trim();
  if (!NAME_PATTERN.test(name)) {
    throw new Error(`Invalid package name "${options.name}". Use kebab-case, for example "order-flow".`);
  }
  const root = `packages/${name}`;
  if (tree.exists(root)) {
    throw new Error(`Packages already exist at ${root}; pick another name.`);
  }

  const description = options.description?.trim() || `The ${name} library of Architect Studio.`;

  tree.write(`${root}/project.json`, projectJson(name));
  tree.write(`${root}/tsconfig.json`, tsconfigJson());
  tree.write(`${root}/src/index.ts`, sourceFile(name, description));
  tree.write(`${root}/tests/${name}.test.ts`, testFile(name));
}
