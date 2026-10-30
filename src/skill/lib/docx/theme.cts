// Compiled from src/skill/lib/docx/theme.cts. Edit the source, then run npm run build.
// Turns a pack's brand into page geometry, colors, fonts and Word styles (design §9). Everything
// brand-specific comes from brand.json; the constants here are the same for every company.
import { AlignmentType, type IStylesOptions, LevelFormat, type INumberingOptions } from "docx";
import type { Brand } from "../types.cjs";

/** Twips: 1/20 of a point, 1,440 to the inch. */
const INCH = 1440;
// Page sizes in twips. Letter is 8.5 × 11 in; A4 is 210 × 297 mm.
const LETTER = { width: 12240, height: 15840 };
const A4 = { width: 11906, height: 16838 };
// Regions where Letter paper is the norm; everywhere else uses A4.
const LETTER_REGIONS = new Set(["US", "CA", "MX", "PH", "CL", "CO", "VE"]);
// One-inch margins: Word's default, and roomy enough for headers and footers.
const MARGIN = INCH;

/** DRAFT is drawn in a fixed warning red, not a brand color, so it reads the same for every company. */
export const DRAFT_COLOR = "B00020";
export const DRAFT_TINT = "FDECEA";
export const WHITE = "FFFFFF";
export const BLACK = "000000";

/** Font sizes in half-points (Word's unit): 21 is 10.5 pt. */
export const SIZE = { small: 17, body: 21, h3: 22, h2: 26, h1: 32, subtitle: 30, title: 52 } as const;
/** Spacing in twips after a body paragraph, and line spacing in 240ths of a line (276 = 1.15 lines). */
const PARAGRAPH_AFTER = 120;
const LINE = 276;

/** Logo boxes in pixels (docx sizes images at 96 px to the inch). */
export const LOGO_BOX = { cover: { width: 220, height: 80 }, header: { width: 110, height: 40 } } as const;

export const NUMBERED_LIST = "numbered-list";

export interface Theme {
  fonts: { heading: string; body: string };
  /** Hex without "#", uppercase, as Word stores it. */
  colors: { primary: string; accent: string; text: string; muted: string };
  /** White or black, whichever contrasts more with the primary color behind table headers. */
  onPrimary: string;
  page: { width: number; height: number; margin: number };
  /** Usable width between the margins, in twips. */
  textWidth: number;
}

export function themeFor(brand: Brand): Theme {
  const hex = (c: string): string => c.replace("#", "").toUpperCase();
  const size = LETTER_REGIONS.has(regionOf(brand.locale)) ? LETTER : A4;
  const primary = hex(brand.colors.primary);
  return {
    fonts: { heading: brand.fonts.heading, body: brand.fonts.body },
    colors: { primary, accent: hex(brand.colors.accent), text: hex(brand.colors.text), muted: hex(brand.colors.muted) },
    onPrimary: contrastText(primary),
    page: { ...size, margin: MARGIN },
    textWidth: size.width - 2 * MARGIN,
  };
}

function regionOf(locale: string): string {
  try {
    return new Intl.Locale(locale).maximize().region ?? "";
  } catch {
    return "";
  }
}

/** WCAG relative luminance of a hex color. */
function luminance(hex: string): number {
  const channel = (i: number): number => {
    const c = Number.parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4);
}

/** White or black text, whichever has the higher WCAG contrast ratio against the background. */
export function contrastText(background: string): string {
  const l = luminance(background);
  const againstWhite = 1.05 / (l + 0.05);
  const againstBlack = (l + 0.05) / 0.05;
  return againstWhite >= againstBlack ? WHITE : BLACK;
}

export function stylesFor(theme: Theme): IStylesOptions {
  const heading = (size: number, color: string, before: number) => ({
    run: { font: theme.fonts.heading, size, bold: true, color },
    paragraph: { spacing: { before, after: PARAGRAPH_AFTER }, keepNext: true, keepLines: true },
  });
  const body = { font: theme.fonts.body, size: SIZE.body, color: theme.colors.text };
  const spacing = { spacing: { after: PARAGRAPH_AFTER, line: LINE } };
  return {
    default: {
      document: { run: body, paragraph: spacing },
      title: { run: { font: theme.fonts.heading, size: SIZE.title, bold: true, color: theme.colors.primary } },
      heading1: heading(SIZE.h1, theme.colors.primary, 360),
      heading2: heading(SIZE.h2, theme.colors.primary, 240),
      heading3: heading(SIZE.h3, theme.colors.text, 200),
    },
    // Word and LibreOffice read the body font from the document defaults above, but Apple's
    // renderer (Pages, Quick Look) only reads it from the Normal style, so it goes on both.
    paragraphStyles: [{ id: "Normal", name: "Normal", quickFormat: true, run: body, paragraph: spacing }],
  };
}

export function numberingFor(): INumberingOptions {
  return {
    config: [
      {
        reference: NUMBERED_LIST,
        levels: [
          {
            level: 0,
            format: LevelFormat.DECIMAL,
            text: "%1.",
            alignment: AlignmentType.START,
            // Half an inch to the text, with the number hanging a quarter inch into it.
            style: { paragraph: { indent: { left: 720, hanging: 360 } } },
          },
        ],
      },
    ],
  };
}

/** Scales a logo to fit a box, keeping its aspect ratio and never enlarging it. */
export function fitLogo(width: number, height: number, box: { width: number; height: number }): { width: number; height: number } {
  const scale = Math.min(box.width / width, box.height / height, 1);
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}
