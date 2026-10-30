// Compiled from src/skill/lib/docx/blocks.cts. Edit the source, then run npm run build.
// Renders the markdown subset (lib/markdown.cts) as Word paragraphs, and builds the plain,
// brand-colored tables the document uses.
import {
  BorderStyle,
  HeadingLevel,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableLayoutType,
  TableRow,
  TextRun,
  VerticalAlign,
  WidthType,
  AlignmentType,
} from "docx";
import { parseMarkdown } from "../markdown.cjs";
import type { Inline } from "../types.cjs";
import { type BuildContext, fillTokens } from "./context.cjs";
import { NUMBERED_LIST, SIZE } from "./theme.cjs";

export function inlineRuns(inlines: Inline[], options: { size?: number; color?: string } = {}): TextRun[] {
  return inlines.map(
    (i) =>
      new TextRun({
        text: i.text,
        ...(i.bold ? { bold: true } : {}),
        ...(i.italic ? { italics: true } : {}),
        ...(options.size ? { size: options.size } : {}),
        ...(options.color ? { color: options.color } : {}),
      }),
  );
}

/** Markdown from the proposal or the pack, with tokens filled in, as paragraphs. */
export function markdownParagraphs(text: string, ctx: BuildContext, options: { size?: number; keepNext?: boolean; after?: number } = {}): Paragraph[] {
  const out: Paragraph[] = [];
  const common = {
    ...(options.keepNext ? { keepNext: true } : {}),
    ...(options.after !== undefined ? { spacing: { after: options.after } } : {}),
  };
  for (const block of parseMarkdown(fillTokens(text, ctx)).blocks) {
    if (block.type === "heading") {
      out.push(new Paragraph({ heading: HeadingLevel.HEADING_3, ...common, children: inlineRuns(block.inlines) }));
    } else if (block.type === "paragraph") {
      out.push(new Paragraph({ ...common, children: inlineRuns(block.inlines, options) }));
    } else if (block.type === "bullets") {
      for (const item of block.items) out.push(new Paragraph({ bullet: { level: 0 }, ...common, children: inlineRuns(item, options) }));
    } else {
      const instance = ctx.nextListInstance();
      for (const item of block.items) {
        out.push(new Paragraph({ numbering: { reference: NUMBERED_LIST, level: 0, instance }, ...common, children: inlineRuns(item, options) }));
      }
    }
  }
  return out;
}

export interface Column {
  title: string;
  /** Share of the text width, 0–1. The shares of a table's columns add up to 1. */
  share: number;
  align?: "left" | "right";
}

/** Plain text; markdown from the proposal; or text with room above it, such as a line to sign on. */
export type Cell = string | { markdown: string } | { text: string; spaceBefore: number };

// Cell padding in twips: about 0.06 in top and bottom, 0.08 in at the sides.
const CELL_MARGIN = { top: 80, bottom: 80, left: 115, right: 115 };
// Border sizes are in eighths of a point.
const RULE = 4;
const STRONG_RULE = 8;

/**
 * A table with a brand-colored header row and thin horizontal rules. Widths are fixed in twips
 * (not percentages), because LibreOffice and older Word versions handle those consistently.
 * Every row but the last keeps with the next, so a table only breaks across pages when it's
 * longer than a page; the proposal's tables are all shorter than that.
 */
export function brandTable(ctx: BuildContext, columns: Column[], rows: Cell[][], options: { totalRows?: number } = {}): Table {
  const { theme } = ctx;
  const widths = columns.map((c) => Math.round(c.share * theme.textWidth));
  const align = (c: Column) => (c.align === "right" ? AlignmentType.RIGHT : AlignmentType.LEFT);
  const cellParagraphs = (cell: Cell, column: Column, bold: boolean, keepNext: boolean): Paragraph[] => {
    if (typeof cell !== "string" && "markdown" in cell) return markdownParagraphs(cell.markdown, ctx, { size: SIZE.small, keepNext, after: 0 });
    const text = typeof cell === "string" ? cell : cell.text;
    const before = typeof cell === "string" ? 0 : cell.spaceBefore;
    return [
      new Paragraph({
        alignment: align(column),
        keepNext,
        spacing: { before, after: 0 },
        children: [new TextRun({ text, size: SIZE.small, ...(bold ? { bold: true } : {}) })],
      }),
    ];
  };

  const header = new TableRow({
    tableHeader: true,
    cantSplit: true,
    children: columns.map(
      (column, i) =>
        new TableCell({
          width: { size: widths[i] ?? 0, type: WidthType.DXA },
          margins: CELL_MARGIN,
          verticalAlign: VerticalAlign.CENTER,
          shading: { type: ShadingType.CLEAR, color: "auto", fill: theme.colors.primary },
          children: [
            new Paragraph({
              alignment: align(column),
              keepNext: true,
              spacing: { after: 0 },
              children: [new TextRun({ text: column.title, bold: true, size: SIZE.small, color: theme.onPrimary })],
            }),
          ],
        }),
    ),
  });
  const firstTotal = rows.length - (options.totalRows ?? 0);
  const body = rows.map(
    (cells, r) =>
      new TableRow({
        cantSplit: true,
        children: columns.map((column, i) => {
          const isTotal = r >= firstTotal;
          return new TableCell({
            width: { size: widths[i] ?? 0, type: WidthType.DXA },
            margins: CELL_MARGIN,
            verticalAlign: VerticalAlign.CENTER,
            ...(isTotal && r === firstTotal ? { borders: { top: { style: BorderStyle.SINGLE, size: STRONG_RULE, color: theme.colors.primary } } } : {}),
            children: cellParagraphs(cells[i] ?? "", column, isTotal, r < rows.length - 1),
          });
        }),
      }),
  );
  const rule = { style: BorderStyle.SINGLE, size: RULE, color: theme.colors.muted };
  const none = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };
  return new Table({
    width: { size: theme.textWidth, type: WidthType.DXA },
    columnWidths: widths,
    layout: TableLayoutType.FIXED,
    borders: { top: rule, bottom: rule, insideHorizontal: rule, left: none, right: none, insideVertical: none },
    rows: [header, ...body],
  });
}
