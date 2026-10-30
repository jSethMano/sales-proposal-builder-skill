"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadWatermark = loadWatermark;
exports.draftText = draftText;
exports.headersFor = headersFor;
exports.footersFor = footersFor;
// Compiled from src/skill/lib/docx/header-footer.cts. Edit the source, then run npm run build.
// Headers and footers (design §9). The cover page has its own header and footer (titlePage), so
// the running header with the small logo starts on page 2. When approval is needed, every page,
// the cover included, carries the DRAFT banner (design X11).
const docx_1 = require("docx");
const context_cjs_1 = require("./context.cjs");
const images_cjs_1 = require("./images.cjs");
const theme_cjs_1 = require("./theme.cjs");
/**
 * docx added TextWatermark in 9.8.0. A sandbox may have an older copy, so it's loaded at run time;
 * the build reports whether it was used, and the DRAFT banner is there either way.
 */
function loadWatermark() {
    try {
        return require("docx/watermarks").TextWatermark;
    }
    catch {
        return null;
    }
}
function draftText(ctx) {
    return `DRAFT, pending approval by ${ctx.pricing.approval.approver ?? "an approver"}`;
}
function draftBanner(ctx) {
    return new docx_1.Paragraph({
        alignment: docx_1.AlignmentType.CENTER,
        spacing: { after: 120 },
        shading: { type: docx_1.ShadingType.CLEAR, color: "auto", fill: theme_cjs_1.DRAFT_COLOR },
        children: [new docx_1.TextRun({ text: draftText(ctx), bold: true, size: theme_cjs_1.SIZE.small, color: theme_cjs_1.WHITE })],
    });
}
function draftMarks(ctx, watermark) {
    if (!ctx.draft)
        return [];
    const marks = [draftBanner(ctx)];
    // Silver at Word's default "semitransparent" setting, so the page stays readable underneath.
    if (watermark)
        marks.push(new docx_1.Paragraph({ children: [new watermark({ text: "DRAFT" })] }));
    return marks;
}
function headersFor(ctx, watermark) {
    const { theme } = ctx;
    const brandMark = ctx.logo
        ? (0, images_cjs_1.logoImage)(ctx.logo, theme_cjs_1.LOGO_BOX.header, ctx.company)
        : (0, context_cjs_1.run)(ctx.company, { bold: true, size: theme_cjs_1.SIZE.small, color: theme.colors.primary, font: theme.fonts.heading });
    const running = new docx_1.Paragraph({
        tabStops: [{ type: docx_1.TabStopType.RIGHT, position: theme.textWidth }],
        border: { bottom: { style: docx_1.BorderStyle.SINGLE, size: 4, color: theme.colors.muted, space: 4 } },
        children: [brandMark, (0, context_cjs_1.run)(`\tProposal for ${ctx.client}`, { size: theme_cjs_1.SIZE.small, color: theme.colors.muted })],
    });
    const first = draftMarks(ctx, watermark);
    return {
        first: new docx_1.Header({ children: first.length > 0 ? first : [new docx_1.Paragraph({})] }),
        default: new docx_1.Header({ children: [...draftMarks(ctx, watermark), running] }),
    };
}
function footersFor(ctx) {
    const { theme } = ctx;
    const text = (0, context_cjs_1.fillFooter)(ctx.pack.brand.footer, ctx);
    const small = { size: theme_cjs_1.SIZE.small, color: theme.colors.muted };
    return {
        first: new docx_1.Footer({ children: [new docx_1.Paragraph({ children: [(0, context_cjs_1.run)(text, small)] })] }),
        default: new docx_1.Footer({
            children: [
                new docx_1.Paragraph({
                    tabStops: [{ type: docx_1.TabStopType.RIGHT, position: theme.textWidth }],
                    children: [(0, context_cjs_1.run)(text, small), (0, context_cjs_1.run)("\t", small), new docx_1.TextRun({ children: ["Page ", docx_1.PageNumber.CURRENT, " of ", docx_1.PageNumber.TOTAL_PAGES], ...small })],
                }),
            ],
        }),
    };
}
