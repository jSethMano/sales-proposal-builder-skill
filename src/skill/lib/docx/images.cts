// Compiled from src/skill/lib/docx/images.cts. Edit the source, then run npm run build.
import { ImageRun } from "docx";
import type { Logo } from "./context.cjs";
import { fitLogo } from "./theme.cjs";

/** The company logo, scaled into a box with its aspect ratio kept. */
export function logoImage(logo: Logo, box: { width: number; height: number }, company: string): ImageRun {
  return new ImageRun({
    type: logo.type,
    data: logo.data,
    transformation: fitLogo(logo.width, logo.height, box),
    altText: { name: `${company} logo`, description: `${company} logo`, title: company },
  });
}
