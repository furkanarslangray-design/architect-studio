import { describe, expect, it } from "vitest";
import { helpText } from "../src/cli";

describe("CLI help", () => {
  it("prints usage for every subcommand", () => {
    expect(helpText("init")).toContain("architect init");
    expect(helpText("doctor")).toContain("--fail-on-drift");
    expect(helpText("projects")).toContain("list|show|save|restore");
    expect(helpText("eval")).toContain("--record");
  });

  it("prints root usage with subcommands and flags", () => {
    const help = helpText();
    expect(help).toContain("Usage:");
    expect(help).toContain("pnpm architect init");
    expect(help).toContain("--web-search");
    expect(help).toContain("Subcommands: init, doctor, projects");
  });

  it("falls back to the root help for an unknown topic", () => {
    expect(helpText("nope")).toBe(helpText());
  });
});
