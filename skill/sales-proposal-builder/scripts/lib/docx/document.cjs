"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.renderDocx = renderDocx;
// Compiled from src/skill/lib/docx/document.cts. Edit the source, then run npm run build.
// Assembles the .docx from a checked proposal, its pricing and the pack (design §9).
const docx_1 = require("docx");
const context_cjs_1 = require("./context.cjs");
const cover_cjs_1 = require("./cover.cjs");
const header_footer_cjs_1 = require("./header-footer.cjs");
const sections_cjs_1 = require("./sections.cjs");
const theme_cjs_1 = require("./theme.cjs");
// Distance from the page edge to the header and footer, in twips: Word's default of 1.25 cm.
const HEADER_FOOTER_DISTANCE = 708;
async function renderDocx(pack, proposal, pricing, skillVersion) {
    const ctx = (0, context_cjs_1.createContext)(pack, proposal, pricing);
    const watermark = ctx.draft ? (0, header_footer_cjs_1.loadWatermark)() : null;
    const { page } = ctx.theme;
    const doc = new docx_1.Document({
        title: proposal.title,
        creator: `sales-proposal-builder ${skillVersion}`,
        description: `Proposal for ${ctx.client} (pack ${pack.brand.packId})`,
        styles: (0, theme_cjs_1.stylesFor)(ctx.theme),
        numbering: (0, theme_cjs_1.numberingFor)(),
        sections: [
            {
                properties: {
                    titlePage: true,
                    page: {
                        size: { width: page.width, height: page.height },
                        margin: {
                            top: page.margin,
                            right: page.margin,
                            bottom: page.margin,
                            left: page.margin,
                            header: HEADER_FOOTER_DISTANCE,
                            footer: HEADER_FOOTER_DISTANCE,
                        },
                    },
                },
                headers: (0, header_footer_cjs_1.headersFor)(ctx, watermark),
                footers: (0, header_footer_cjs_1.footersFor)(ctx),
                children: [...(0, cover_cjs_1.coverPage)(ctx), ...(0, sections_cjs_1.bodySections)(ctx)],
            },
        ],
    });
    return { buffer: await docx_1.Packer.toBuffer(doc), draft: ctx.draft, watermark: watermark !== null };
}
