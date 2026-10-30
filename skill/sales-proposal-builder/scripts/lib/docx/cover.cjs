"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.coverPage = coverPage;
// Compiled from src/skill/lib/docx/cover.cts. Edit the source, then run npm run build.
// The cover page: logo, title, client, who it's from, dates, and a DRAFT callout when approval is
// needed. Everything on it comes from the proposal, the pricing or the pack.
const docx_1 = require("docx");
const check_cjs_1 = require("../check.cjs");
const context_cjs_1 = require("./context.cjs");
const header_footer_cjs_1 = require("./header-footer.cjs");
const images_cjs_1 = require("./images.cjs");
const theme_cjs_1 = require("./theme.cjs");
function coverPage(ctx) {
    const { theme, proposal, pricing, pack } = ctx;
    const { contact } = proposal.client;
    const { signatory, company } = pack.brand;
    const date = (iso) => (0, check_cjs_1.formatDate)(iso, pricing.locale);
    const out = [
        new docx_1.Paragraph({
            spacing: { after: 1440 },
            children: [
                ctx.logo
                    ? (0, images_cjs_1.logoImage)(ctx.logo, theme_cjs_1.LOGO_BOX.cover, ctx.company)
                    : (0, context_cjs_1.run)(ctx.company, { bold: true, size: theme_cjs_1.SIZE.subtitle, color: theme.colors.primary, font: theme.fonts.heading }),
            ],
        }),
        new docx_1.Paragraph({ heading: docx_1.HeadingLevel.TITLE, spacing: { after: 160 }, children: [(0, context_cjs_1.run)(proposal.title)] }),
        new docx_1.Paragraph({
            spacing: { after: 480 },
            // A 3 pt rule in the accent color under the subtitle.
            border: { bottom: { style: docx_1.BorderStyle.SINGLE, size: 24, color: theme.colors.accent, space: 8 } },
            children: [(0, context_cjs_1.run)(`Proposal for ${ctx.client}`, { size: theme_cjs_1.SIZE.subtitle, color: theme.colors.muted, font: theme.fonts.heading })],
        }),
    ];
    const details = [
        ["Prepared for", [contact.name, contact.title, ctx.client].filter(Boolean).join(", ")],
        ["Prepared by", [signatory.name, signatory.title, ctx.company].join(", ")],
        ["Date", date(proposal.date)],
        ["Proposed start", date(proposal.startDate)],
        ["Valid until", pricing.formatted.validUntil],
    ];
    for (const [label, value] of details) {
        out.push(new docx_1.Paragraph({ spacing: { after: 60 }, children: [(0, context_cjs_1.run)(`${label}: `, { bold: true, color: theme.colors.primary }), (0, context_cjs_1.run)(value)] }));
    }
    if (ctx.draft) {
        const edge = { style: docx_1.BorderStyle.SINGLE, size: 8, color: theme_cjs_1.DRAFT_COLOR, space: 6 };
        out.push(new docx_1.Paragraph({
            spacing: { before: 480 },
            border: { top: edge, bottom: edge, left: edge, right: edge },
            shading: { type: docx_1.ShadingType.CLEAR, color: "auto", fill: theme_cjs_1.DRAFT_TINT },
            children: [(0, context_cjs_1.run)(`${(0, header_footer_cjs_1.draftText)(ctx)}. `, { bold: true, color: theme_cjs_1.DRAFT_COLOR }), (0, context_cjs_1.run)(pricing.approval.reason ?? "")],
        }));
    }
    const contactLine = [company.website, company.email, company.phone].filter(Boolean).join("  ·  ");
    out.push(new docx_1.Paragraph({ spacing: { before: 960, after: 0 }, children: [(0, context_cjs_1.run)(company.legalName, { size: theme_cjs_1.SIZE.small, color: theme.colors.muted })] }));
    if (company.address)
        out.push(new docx_1.Paragraph({ spacing: { after: 0 }, children: [(0, context_cjs_1.run)(company.address, { size: theme_cjs_1.SIZE.small, color: theme.colors.muted })] }));
    if (contactLine)
        out.push(new docx_1.Paragraph({ children: [(0, context_cjs_1.run)(contactLine, { size: theme_cjs_1.SIZE.small, color: theme.colors.muted })] }));
    return out;
}
