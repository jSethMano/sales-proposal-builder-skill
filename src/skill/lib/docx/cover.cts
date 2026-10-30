// Compiled from src/skill/lib/docx/cover.cts. Edit the source, then run npm run build.
// The cover page: logo, title, client, who it's from, dates, and a DRAFT callout when approval is
// needed. Everything on it comes from the proposal, the pricing or the pack.
import { BorderStyle, HeadingLevel, Paragraph, ShadingType } from "docx";
import { formatDate } from "../check.cjs";
import { type BuildContext, run } from "./context.cjs";
import { draftText } from "./header-footer.cjs";
import { logoImage } from "./images.cjs";
import { DRAFT_COLOR, DRAFT_TINT, LOGO_BOX, SIZE } from "./theme.cjs";

export function coverPage(ctx: BuildContext): Paragraph[] {
  const { theme, proposal, pricing, pack } = ctx;
  const { contact } = proposal.client;
  const { signatory, company } = pack.brand;
  const date = (iso: string): string => formatDate(iso, pricing.locale);

  const out: Paragraph[] = [
    new Paragraph({
      spacing: { after: 1440 },
      children: [
        ctx.logo
          ? logoImage(ctx.logo, LOGO_BOX.cover, ctx.company)
          : run(ctx.company, { bold: true, size: SIZE.subtitle, color: theme.colors.primary, font: theme.fonts.heading }),
      ],
    }),
    new Paragraph({ heading: HeadingLevel.TITLE, spacing: { after: 160 }, children: [run(proposal.title)] }),
    new Paragraph({
      spacing: { after: 480 },
      // A 3 pt rule in the accent color under the subtitle.
      border: { bottom: { style: BorderStyle.SINGLE, size: 24, color: theme.colors.accent, space: 8 } },
      children: [run(`Proposal for ${ctx.client}`, { size: SIZE.subtitle, color: theme.colors.muted, font: theme.fonts.heading })],
    }),
  ];

  const details: [string, string][] = [
    ["Prepared for", [contact.name, contact.title, ctx.client].filter(Boolean).join(", ")],
    ["Prepared by", [signatory.name, signatory.title, ctx.company].join(", ")],
    ["Date", date(proposal.date)],
    ["Proposed start", date(proposal.startDate)],
    ["Valid until", pricing.formatted.validUntil],
  ];
  for (const [label, value] of details) {
    out.push(new Paragraph({ spacing: { after: 60 }, children: [run(`${label}: `, { bold: true, color: theme.colors.primary }), run(value)] }));
  }

  if (ctx.draft) {
    const edge = { style: BorderStyle.SINGLE, size: 8, color: DRAFT_COLOR, space: 6 };
    out.push(
      new Paragraph({
        spacing: { before: 480 },
        border: { top: edge, bottom: edge, left: edge, right: edge },
        shading: { type: ShadingType.CLEAR, color: "auto", fill: DRAFT_TINT },
        children: [run(`${draftText(ctx)}. `, { bold: true, color: DRAFT_COLOR }), run(pricing.approval.reason ?? "")],
      }),
    );
  }

  const contactLine = [company.website, company.email, company.phone].filter(Boolean).join("  ·  ");
  out.push(
    new Paragraph({ spacing: { before: 960, after: 0 }, children: [run(company.legalName, { size: SIZE.small, color: theme.colors.muted })] }),
  );
  if (company.address) out.push(new Paragraph({ spacing: { after: 0 }, children: [run(company.address, { size: SIZE.small, color: theme.colors.muted })] }));
  if (contactLine) out.push(new Paragraph({ children: [run(contactLine, { size: SIZE.small, color: theme.colors.muted })] }));
  return out;
}
