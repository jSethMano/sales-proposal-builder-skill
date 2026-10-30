// Reads a built .docx: it's a zip of XML parts. Tests and the eval harness check the XML Word will read.
import { readFileSync } from "node:fs";
import { strFromU8, unzipSync } from "fflate";

const ENTITIES: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&apos;": "'" };
const decode = (s: string): string => s.replace(/&(?:amp|lt|gt|quot|apos);/g, (e) => ENTITIES[e] ?? e);

/** Text of each <w:p> in some XML, with tabs as "\t". */
function paragraphs(xml: string): string[] {
  return [...xml.matchAll(/<w:p[ >][\s\S]*?<\/w:p>/g)].map((p) =>
    [...p[0].matchAll(/<w:t(?: [^>]*)?>([^<]*)<\/w:t>|<w:tab\/>/g)].map((m) => (m[1] === undefined ? "\t" : decode(m[1]))).join(""),
  );
}

export interface Docx {
  parts: string[];
  xml: (part: string) => string;
  /** All paragraph text of a part, one paragraph per line. */
  text: (part?: string) => string;
  /** Text of every part that holds content: body, headers, footers, styles and properties. */
  allXml: () => string;
  /** Each table in the body as rows of cell text. */
  tables: () => string[][][];
  media: () => Uint8Array[];
  /** Header and footer parts, e.g. ["word/header1.xml", "word/header2.xml"]. */
  headers: () => string[];
  footers: () => string[];
}

export function openDocx(file: string): Docx {
  const files = unzipSync(new Uint8Array(readFileSync(file)));
  const parts = Object.keys(files).sort();
  const xml = (part: string): string => {
    const data = files[part];
    if (!data) throw new Error(`No ${part} in ${file}. Parts: ${parts.join(", ")}`);
    return strFromU8(data);
  };
  return {
    parts,
    xml,
    text: (part = "word/document.xml") => paragraphs(xml(part)).join("\n"),
    allXml: () => parts.filter((p) => p.endsWith(".xml")).map(xml).join("\n"),
    tables: () =>
      [...xml("word/document.xml").matchAll(/<w:tbl>[\s\S]*?<\/w:tbl>/g)].map((t) =>
        [...t[0].matchAll(/<w:tr[ >][\s\S]*?<\/w:tr>/g)].map((r) =>
          [...r[0].matchAll(/<w:tc>[\s\S]*?<\/w:tc>/g)].map((c) => paragraphs(c[0]).join("\n")),
        ),
      ),
    media: () => parts.filter((p) => p.startsWith("word/media/")).map((p) => files[p] as Uint8Array),
    headers: () => parts.filter((p) => /^word\/header\d+\.xml$/.test(p)),
    footers: () => parts.filter((p) => /^word\/footer\d+\.xml$/.test(p)),
  };
}
