// Compiled from src/skill/lib/docx/header-footer.cts. Edit the source, then run npm run build.
// Headers and footers (design §9). The cover page has its own header and footer (titlePage), so
// the running header with the small logo starts on page 2. When approval is needed, every page,
// the cover included, carries the DRAFT banner (design X11).
import { AlignmentType, BorderStyle, Footer, Header, PageNumber, Paragraph, ShadingType, TabStopType, TextRun } from "docx";
import type { TextWatermark } from "docx/watermarks";
import { type BuildContext, fillFooter, run } from "./context.cjs";
import { logoImage } from "./images.cjs";
import { DRAFT_COLOR, LOGO_BOX, SIZE, WHITE } from "./theme.cjs";

type WatermarkClass = typeof TextWatermark;

/**
 * docx added TextWatermark in 9.8.0. A sandbox may have an older copy, so it's loaded at run time;
 * the build reports whether it was used, and the DRAFT banner is there either way.
 */
export function loadWatermark(): WatermarkClass | null {
  try {
    return (require("docx/watermarks") as { TextWatermark: WatermarkClass }).TextWatermark;
  } catch {
    return null;
  }
}

export function draftText(ctx: BuildContext): string {
  return `DRAFT, pending approval by ${ctx.pricing.approval.approver ?? "an approver"}`;
}

function draftBanner(ctx: BuildContext): Paragraph {
  return new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 120 },
    shading: { type: ShadingType.CLEAR, color: "auto", fill: DRAFT_COLOR },
    children: [new TextRun({ text: draftText(ctx), bold: true, size: SIZE.small, color: WHITE })],
  });
}

function draftMarks(ctx: BuildContext, watermark: WatermarkClass | null): Paragraph[] {
  if (!ctx.draft) return [];
  const marks = [draftBanner(ctx)];
  // Silver at Word's default "semitransparent" setting, so the page stays readable underneath.
  if (watermark) marks.push(new Paragraph({ children: [new watermark({ text: "DRAFT" })] }));
  return marks;
}

export function headersFor(ctx: BuildContext, watermark: WatermarkClass | null): { first: Header; default: Header } {
  const { theme } = ctx;
  const brandMark = ctx.logo
    ? logoImage(ctx.logo, LOGO_BOX.header, ctx.company)
    : run(ctx.company, { bold: true, size: SIZE.small, color: theme.colors.primary, font: theme.fonts.heading });
  const running = new Paragraph({
    tabStops: [{ type: TabStopType.RIGHT, position: theme.textWidth }],
    border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: theme.colors.muted, space: 4 } },
    children: [brandMark, run(`\tProposal for ${ctx.client}`, { size: SIZE.small, color: theme.colors.muted })],
  });
  const first = draftMarks(ctx, watermark);
  return {
    first: new Header({ children: first.length > 0 ? first : [new Paragraph({})] }),
    default: new Header({ children: [...draftMarks(ctx, watermark), running] }),
  };
}

export function footersFor(ctx: BuildContext): { first: Footer; default: Footer } {
  const { theme } = ctx;
  const text = fillFooter(ctx.pack.brand.footer, ctx);
  const small = { size: SIZE.small, color: theme.colors.muted };
  return {
    first: new Footer({ children: [new Paragraph({ children: [run(text, small)] })] }),
    default: new Footer({
      children: [
        new Paragraph({
          tabStops: [{ type: TabStopType.RIGHT, position: theme.textWidth }],
          children: [run(text, small), run("\t", small), new TextRun({ children: ["Page ", PageNumber.CURRENT, " of ", PageNumber.TOTAL_PAGES], ...small })],
        }),
      ],
    }),
  };
}
