"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.inlineRuns = inlineRuns;
exports.markdownParagraphs = markdownParagraphs;
exports.brandTable = brandTable;
// Compiled from src/skill/lib/docx/blocks.cts. Edit the source, then run npm run build.
// Renders the markdown subset (lib/markdown.cts) as Word paragraphs, and builds the plain,
// brand-colored tables the document uses.
const docx_1 = require("docx");
const markdown_cjs_1 = require("../markdown.cjs");
const context_cjs_1 = require("./context.cjs");
const theme_cjs_1 = require("./theme.cjs");
function inlineRuns(inlines, options = {}) {
    return inlines.map((i) => new docx_1.TextRun({
        text: i.text,
        ...(i.bold ? { bold: true } : {}),
        ...(i.italic ? { italics: true } : {}),
        ...(options.size ? { size: options.size } : {}),
        ...(options.color ? { color: options.color } : {}),
    }));
}
/** Markdown from the proposal or the pack, with tokens filled in, as paragraphs. */
function markdownParagraphs(text, ctx, options = {}) {
    const out = [];
    const common = {
        ...(options.keepNext ? { keepNext: true } : {}),
        ...(options.after !== undefined ? { spacing: { after: options.after } } : {}),
    };
    for (const block of (0, markdown_cjs_1.parseMarkdown)((0, context_cjs_1.fillTokens)(text, ctx)).blocks) {
        if (block.type === "heading") {
            out.push(new docx_1.Paragraph({ heading: docx_1.HeadingLevel.HEADING_3, ...common, children: inlineRuns(block.inlines) }));
        }
        else if (block.type === "paragraph") {
            out.push(new docx_1.Paragraph({ ...common, children: inlineRuns(block.inlines, options) }));
        }
        else if (block.type === "bullets") {
            for (const item of block.items)
                out.push(new docx_1.Paragraph({ bullet: { level: 0 }, ...common, children: inlineRuns(item, options) }));
        }
        else {
            const instance = ctx.nextListInstance();
            for (const item of block.items) {
                out.push(new docx_1.Paragraph({ numbering: { reference: theme_cjs_1.NUMBERED_LIST, level: 0, instance }, ...common, children: inlineRuns(item, options) }));
            }
        }
    }
    return out;
}
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
function brandTable(ctx, columns, rows, options = {}) {
    const { theme } = ctx;
    const widths = columns.map((c) => Math.round(c.share * theme.textWidth));
    const align = (c) => (c.align === "right" ? docx_1.AlignmentType.RIGHT : docx_1.AlignmentType.LEFT);
    const cellParagraphs = (cell, column, bold, keepNext) => {
        if (typeof cell !== "string" && "markdown" in cell)
            return markdownParagraphs(cell.markdown, ctx, { size: theme_cjs_1.SIZE.small, keepNext, after: 0 });
        const text = typeof cell === "string" ? cell : cell.text;
        const before = typeof cell === "string" ? 0 : cell.spaceBefore;
        return [
            new docx_1.Paragraph({
                alignment: align(column),
                keepNext,
                spacing: { before, after: 0 },
                children: [new docx_1.TextRun({ text, size: theme_cjs_1.SIZE.small, ...(bold ? { bold: true } : {}) })],
            }),
        ];
    };
    const header = new docx_1.TableRow({
        tableHeader: true,
        cantSplit: true,
        children: columns.map((column, i) => new docx_1.TableCell({
            width: { size: widths[i] ?? 0, type: docx_1.WidthType.DXA },
            margins: CELL_MARGIN,
            verticalAlign: docx_1.VerticalAlign.CENTER,
            shading: { type: docx_1.ShadingType.CLEAR, color: "auto", fill: theme.colors.primary },
            children: [
                new docx_1.Paragraph({
                    alignment: align(column),
                    keepNext: true,
                    spacing: { after: 0 },
                    children: [new docx_1.TextRun({ text: column.title, bold: true, size: theme_cjs_1.SIZE.small, color: theme.onPrimary })],
                }),
            ],
        })),
    });
    const firstTotal = rows.length - (options.totalRows ?? 0);
    const body = rows.map((cells, r) => new docx_1.TableRow({
        cantSplit: true,
        children: columns.map((column, i) => {
            const isTotal = r >= firstTotal;
            return new docx_1.TableCell({
                width: { size: widths[i] ?? 0, type: docx_1.WidthType.DXA },
                margins: CELL_MARGIN,
                verticalAlign: docx_1.VerticalAlign.CENTER,
                ...(isTotal && r === firstTotal ? { borders: { top: { style: docx_1.BorderStyle.SINGLE, size: STRONG_RULE, color: theme.colors.primary } } } : {}),
                children: cellParagraphs(cells[i] ?? "", column, isTotal, r < rows.length - 1),
            });
        }),
    }));
    const rule = { style: docx_1.BorderStyle.SINGLE, size: RULE, color: theme.colors.muted };
    const none = { style: docx_1.BorderStyle.NONE, size: 0, color: "FFFFFF" };
    return new docx_1.Table({
        width: { size: theme.textWidth, type: docx_1.WidthType.DXA },
        columnWidths: widths,
        layout: docx_1.TableLayoutType.FIXED,
        borders: { top: rule, bottom: rule, insideHorizontal: rule, left: none, right: none, insideVertical: none },
        rows: [header, ...body],
    });
}
