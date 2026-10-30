// Compiled from src/skill/lib/docx/document.cts. Edit the source, then run npm run build.
// Assembles the .docx from a checked proposal, its pricing and the pack (design §9).
import { Document, Packer } from "docx";
import type { Pack, PricingOutput, Proposal } from "../types.cjs";
import { createContext } from "./context.cjs";
import { coverPage } from "./cover.cjs";
import { footersFor, headersFor, loadWatermark } from "./header-footer.cjs";
import { bodySections } from "./sections.cjs";
import { numberingFor, stylesFor } from "./theme.cjs";

// Distance from the page edge to the header and footer, in twips: Word's default of 1.25 cm.
const HEADER_FOOTER_DISTANCE = 708;

export interface Rendered {
  buffer: Buffer;
  draft: boolean;
  /** Whether a DRAFT watermark was added; it needs docx 9.8.0 or later. The banner is always there. */
  watermark: boolean;
}

export async function renderDocx(pack: Pack, proposal: Proposal, pricing: PricingOutput, skillVersion: string): Promise<Rendered> {
  const ctx = createContext(pack, proposal, pricing);
  const watermark = ctx.draft ? loadWatermark() : null;
  const { page } = ctx.theme;
  const doc = new Document({
    title: proposal.title,
    creator: `sales-proposal-builder ${skillVersion}`,
    description: `Proposal for ${ctx.client} (pack ${pack.brand.packId})`,
    styles: stylesFor(ctx.theme),
    numbering: numberingFor(),
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
        headers: headersFor(ctx, watermark),
        footers: footersFor(ctx),
        children: [...coverPage(ctx), ...bodySections(ctx)],
      },
    ],
  });
  return { buffer: await Packer.toBuffer(doc), draft: ctx.draft, watermark: watermark !== null };
}
