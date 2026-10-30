// Compiled from src/skill/lib/markdown.cts. Edit the source, then run npm run build.
// The markdown subset that proposal prose and terms.md may use (design §6): paragraphs, "- "
// bullets, "1. " numbered lists, "### " subheadings, **bold** and *italic*. It parses into blocks the
// docx builder renders. Anything outside the subset is reported with its line number instead of
// being passed through, so a document never shows stray markdown syntax.
import type { Block, Inline, MarkdownIssue, ParsedMarkdown } from "./types.cjs";

interface Rule {
  test: RegExp;
  message: string;
  hint: string;
}

// Checked against each whole line before it's classified.
const LINE_RULES: readonly Rule[] = [
  { test: /^#{1,2}\s|^#{4,}\s/, message: "Only ### subheadings are supported.", hint: "Use '### ' for a subheading; section headings come from the document." },
  { test: /^\s*\|/, message: "Tables aren't supported.", hint: "Use a bulleted list. The pricing table is built from pricing.json." },
  { test: /^\s*>/, message: "Block quotes aren't supported.", hint: "Write it as a normal paragraph." },
  { test: /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/, message: "Horizontal rules aren't supported.", hint: "Remove it; the document separates sections." },
  { test: /^\s*```/, message: "Code blocks aren't supported.", hint: "Write it as plain text." },
  { test: /^\s*[*+]\s/, message: "Bullets must start with '- '.", hint: "Use '- ' for each bullet item." },
  { test: /^\s+(?:-|\d+\.)\s/, message: "Nested lists aren't supported.", hint: "Flatten the list to one level." },
];

// Checked against the text inside a line.
const INLINE_RULES: readonly Rule[] = [
  { test: /!\[[^\]]*\]\([^)]*\)/, message: "Images aren't supported.", hint: "Remove the image. The only image in a proposal is the logo." },
  { test: /\[[^\]]*\]\([^)]*\)/, message: "Links aren't supported.", hint: "Write the address as plain text if it's needed." },
  { test: /`/, message: "Inline code isn't supported.", hint: "Remove the backticks." },
  { test: /<\/?[A-Za-z][^>]*>/, message: "HTML isn't supported.", hint: "Use plain text, **bold** or *italic*." },
];

const HEADING = /^###\s+(.+)$/;
const BULLET = /^-\s+(.*)$/;
const NUMBERED = /^\d+\.\s+(.*)$/;

interface Pending {
  type: Block["type"];
  /** Raw text of a heading or paragraph, or of each list item, with its first line number. */
  parts: { text: string; line: number }[];
}

export function parseMarkdown(text: string): ParsedMarkdown {
  const blocks: Block[] = [];
  const issues: MarkdownIssue[] = [];
  let pending: Pending | null = null;

  const close = (): void => {
    if (!pending) return;
    const inline = (part: { text: string; line: number }): Inline[] => parseInline(part.text, part.line, issues);
    if (pending.type === "heading" || pending.type === "paragraph") {
      const first = pending.parts[0] as { text: string; line: number };
      blocks.push({ type: pending.type, inlines: inline({ text: pending.parts.map((p) => p.text).join(" "), line: first.line }) });
    } else {
      blocks.push({ type: pending.type, items: pending.parts.map(inline) });
    }
    pending = null;
  };

  text.split(/\r?\n/).forEach((raw, index) => {
    const line = index + 1;
    if (raw.trim() === "") {
      close();
      return;
    }
    const lineRule = LINE_RULES.find((r) => r.test.test(raw));
    if (lineRule) {
      issues.push({ line, message: lineRule.message, hint: lineRule.hint });
      return;
    }
    for (const rule of INLINE_RULES) if (rule.test.test(raw)) issues.push({ line, message: rule.message, hint: rule.hint });

    const trimmed = raw.trim();
    const heading = HEADING.exec(trimmed);
    const bullet = BULLET.exec(trimmed);
    const numbered = NUMBERED.exec(trimmed);
    if (heading) {
      close();
      pending = { type: "heading", parts: [{ text: (heading[1] ?? "").trim(), line }] };
      close();
    } else if (bullet || numbered) {
      const type = bullet ? "bullets" : "numbered";
      if (pending?.type !== type) {
        close();
        pending = { type, parts: [] };
      }
      (pending as Pending).parts.push({ text: ((bullet ?? numbered)?.[1] ?? "").trim(), line });
    } else if (pending && (pending.type === "bullets" || pending.type === "numbered" || pending.type === "paragraph")) {
      // A plain line right after a list item or paragraph line continues it.
      const last = pending.parts[pending.parts.length - 1];
      if (last) last.text = `${last.text} ${trimmed}`;
    } else {
      close();
      pending = { type: "paragraph", parts: [{ text: trimmed, line }] };
    }
  });
  close();
  return { blocks, issues };
}

function parseInline(text: string, line: number, issues: MarkdownIssue[]): Inline[] {
  const out: Inline[] = [];
  let bold = false;
  let italic = false;
  let buffer = "";
  const flush = (): void => {
    if (buffer !== "") out.push({ text: buffer, bold, italic });
    buffer = "";
  };
  const marker = /\*\*|\*/g;
  let last = 0;
  for (let m = marker.exec(text); m !== null; m = marker.exec(text)) {
    buffer += text.slice(last, m.index);
    flush();
    if (m[0] === "**") bold = !bold;
    else italic = !italic;
    last = m.index + m[0].length;
  }
  buffer += text.slice(last);
  flush();
  if (bold) issues.push({ line, message: "A ** is never closed.", hint: "Close the bold text with **." });
  if (italic) {
    issues.push({ line, message: "A * is never closed.", hint: "Close the italic text with *, and write 24x7 rather than 24*7." });
  }
  return out;
}

/** Plain text of a parsed document, for word counts and scans. */
export function plainText(blocks: Block[]): string {
  const inlineText = (inlines: Inline[]): string => inlines.map((i) => i.text).join("");
  return blocks
    .map((b) => (b.type === "heading" || b.type === "paragraph" ? inlineText(b.inlines) : b.items.map(inlineText).join("\n")))
    .join("\n");
}
