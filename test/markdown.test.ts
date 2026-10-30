// The markdown parser's block output, which build-docx.cjs renders in M3. Loaded from the
// compiled lib, so the tested code is the shipped code.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { join } from "node:path";
import { describe, it } from "node:test";
import type { Block, ParsedMarkdown } from "../src/skill/lib/types.cts";
import { SCRIPTS } from "./helpers.ts";

const { parseMarkdown } = createRequire(import.meta.url)(join(SCRIPTS, "lib/markdown.cjs")) as {
  parseMarkdown: (text: string) => ParsedMarkdown;
};
const t = (text: string, bold = false, italic = false) => ({ text, bold, italic });

describe("parseMarkdown", () => {
  it("parses headings, paragraphs and both list types", () => {
    const { blocks, issues } = parseMarkdown("### Plan\n\nFirst line\nsecond line.\n\n- one\n- two\n\n1. first\n2. second");
    assert.deepEqual(issues, []);
    assert.deepEqual(blocks, [
      { type: "heading", inlines: [t("Plan")] },
      { type: "paragraph", inlines: [t("First line second line.")] },
      { type: "bullets", items: [[t("one")], [t("two")]] },
      { type: "numbered", items: [[t("first")], [t("second")]] },
    ] satisfies Block[]);
  });

  it("parses bold, italic and both together", () => {
    const { blocks } = parseMarkdown("A **bold** and *italic* and ***both*** word.");
    assert.deepEqual(blocks[0], {
      type: "paragraph",
      inlines: [t("A "), t("bold", true), t(" and "), t("italic", false, true), t(" and "), t("both", true, true), t(" word.")],
    });
  });

  it("joins a wrapped line onto the list item above it", () => {
    assert.deepEqual(parseMarkdown("- one\n  continues\n- two").blocks.length, 1);
    assert.deepEqual(parseMarkdown("- one\ncontinues\n- two").blocks, [{ type: "bullets", items: [[t("one continues")], [t("two")]] }]);
  });

  it("ends a list at a blank line, and starts a new list type cleanly", () => {
    assert.deepEqual(
      parseMarkdown("- a\n1. b").blocks.map((b) => b.type),
      ["bullets", "numbered"],
    );
  });

  it("keeps tokens as text for the build to fill in", () => {
    assert.deepEqual(parseMarkdown("Total: {{pricing.termTotal}}").blocks[0], { type: "paragraph", inlines: [t("Total: {{pricing.termTotal}}")] });
  });

  it("returns no blocks for empty text", () => {
    assert.deepEqual(parseMarkdown("  \n\n").blocks, []);
  });
});
