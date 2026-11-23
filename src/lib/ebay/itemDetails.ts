/**
 * Details of one comparable (a sale or a current listing) for the listing
 * sheet on the price step: the seller's description, how they graded the disc
 * and the inlay, and the country of origin. Read from the Browse getItem
 * response; pure functions so they can be tested without eBay.
 */

export interface ItemDetails {
  /** False when eBay no longer serves the listing (ended sales often go away). */
  available: boolean;
  title: string | null;
  /** The seller's description as plain text, shortened. */
  description: string | null;
  /** eBay's condition ("Very Good", "Pre-owned"...). */
  condition: string | null;
  /** The seller's own condition notes. */
  conditionNote: string | null;
  disc: string | null;
  inlay: string | null;
  /** Country of manufacture or release, from the item specifics or the title. */
  origin: string | null;
  /** Where the item ships from (ISO alpha-2). */
  shipsFrom: string | null;
  images: string[];
  url: string | null;
}

export const EMPTY_DETAILS: ItemDetails = {
  available: false,
  title: null,
  description: null,
  condition: null,
  conditionNote: null,
  disc: null,
  inlay: null,
  origin: null,
  shipsFrom: null,
  images: [],
  url: null,
};

/** Browse getItem path for an item id: RESTful "v1|123|0", or the legacy number sold data uses. */
export function itemDetailsRequest(itemId: string): { path: string; params: Record<string, string> } | null {
  const id = itemId.trim();
  if (/^v1\|\d+\|\d+$/.test(id)) return { path: `/buy/browse/v1/item/${encodeURIComponent(id)}`, params: {} };
  if (/^\d{6,20}$/.test(id)) {
    return { path: "/buy/browse/v1/item/get_item_by_legacy_id", params: { legacy_item_id: id } };
  }
  return null;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

/** Seller HTML as readable text: no scripts, styles or tags; line breaks kept. */
export function htmlToText(html: string, max = 2000): string {
  const text = html
    .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>|<\/(p|div|li|h\d|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&(\w+);/g, (m, name) => ENTITIES[name.toLowerCase()] ?? m)
    .replace(/[ \t\f\v\r]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return text.length > max ? `${text.slice(0, max).replace(/\s+\S*$/, "")}…` : text;
}

/** Words that make a phrase a grade, not just any text after "CD:". */
const GRADE_WORD =
  /\b(mint|near mint|nm|m-|ex(cellent)?|vg\+?|very good|good|fair|poor|like new|new|sealed|perfect|great|clean|scratch(es|ed)?|scuff(s|ed)?|light|minor|wear|plays?|missing|cracked|tested)\b|\bvg\+|\bnm-?/i;

const PART_RE = {
  disc: /\b(disc|disk|cd|media)\b/i,
  inlay: /\b(inlay|insert|booklet|artwork|sleeve|cover|case|j-?card|packaging)\b/i,
};

function gradeFromText(text: string, part: keyof typeof PART_RE): string | null {
  const word = PART_RE[part].source;
  const re = new RegExp(
    `${word}(?:\\s+(?:condition|grade|grading))?\\s*(?:is|in|:|-|–|=)\\s*([^.;,\\n|/()]{1,40})`,
    "gi",
  );
  for (const m of text.matchAll(re)) {
    const phrase = m[m.length - 1].trim().replace(/\s+condition$/i, "");
    if (phrase && GRADE_WORD.test(phrase)) return phrase.replace(/^./, (c) => c.toUpperCase());
  }
  return null;
}

type Named = { name?: string; value?: string };
type Descriptor = { name?: string; values?: { content?: string }[] };

interface RawItem {
  title?: string;
  shortDescription?: string;
  description?: string;
  condition?: string;
  conditionDescription?: string;
  conditionDescriptors?: Descriptor[];
  localizedAspects?: Named[];
  itemLocation?: { country?: string };
  image?: { imageUrl?: string };
  additionalImages?: { imageUrl?: string }[];
  itemWebUrl?: string;
}

const COUNTRY_NAMES: [RegExp, string][] = [
  [/\bcanad(a|ian)\b/i, "Canada"],
  [/\b(usa|u\.s\.a\.|united states|american)\b/i, "USA"],
  [/\bjapan(ese)?\b/i, "Japan"],
  [/\b(uk|u\.k\.|united kingdom|england|british)\b/i, "UK"],
  [/\b(germany|german|west germany)\b/i, "Germany"],
  [/\b(eu|europe|european)\b/i, "Europe"],
  [/\b(australia|australian)\b/i, "Australia"],
  [/\b(france|french)\b/i, "France"],
];

/** "Made in Canada", "Canadian pressing"... in a title or description. */
export function originFromText(text: string): string | null {
  const m = text.match(/\b(?:made|pressed|printed|manufactured)\s+in\s+([a-z .]{2,20})|\b([a-z]+)\s+(?:pressing|press|issue|release|edition)\b/i);
  const phrase = m ? (m[1] ?? m[2]) : text;
  for (const [re, name] of COUNTRY_NAMES) if (re.test(phrase)) return name;
  return null;
}

export function toItemDetails(raw: unknown): ItemDetails {
  const r = (raw ?? {}) as RawItem;
  const aspects: Named[] = [
    ...(r.localizedAspects ?? []),
    ...(r.conditionDescriptors ?? []).map((d) => ({
      name: d.name,
      value: (d.values ?? []).map((v) => v.content).filter(Boolean).join(", "),
    })),
  ];
  const aspect = (test: (name: string) => boolean) =>
    aspects.find((a) => a.name && a.value && test(a.name))?.value?.trim() ?? null;
  const graded = (n: string) => /condition|grade|grading/i.test(n);

  const description = r.description ? htmlToText(r.description) : r.shortDescription?.trim() || null;
  const note = r.conditionDescription?.trim() || null;
  const texts = [note, r.title, description].filter((t): t is string => !!t);
  const fromTexts = (part: keyof typeof PART_RE) => {
    for (const t of texts) {
      const g = gradeFromText(t, part);
      if (g) return g;
    }
    return null;
  };

  const origin =
    aspect((n) => /country\/region of manufacture|country of (origin|manufacture)|release country|country\/region/i.test(n)) ??
    originFromText([r.title, description].filter(Boolean).join("\n"));

  const images = [r.image?.imageUrl, ...(r.additionalImages ?? []).map((i) => i.imageUrl)].filter(
    (u): u is string => !!u,
  );

  return {
    available: true,
    title: r.title ?? null,
    description,
    condition: r.condition ?? null,
    conditionNote: note,
    disc: aspect((n) => PART_RE.disc.test(n) && graded(n)) ?? fromTexts("disc"),
    inlay: aspect((n) => PART_RE.inlay.test(n) && graded(n)) ?? fromTexts("inlay"),
    origin,
    shipsFrom: r.itemLocation?.country ?? null,
    images,
    url: r.itemWebUrl ?? null,
  };
}

/** What can be said from the list row alone, when eBay no longer serves the item. */
export function detailsFromTitle(title: string): Pick<ItemDetails, "disc" | "inlay" | "origin"> {
  return { disc: gradeFromText(title, "disc"), inlay: gradeFromText(title, "inlay"), origin: originFromText(title) };
}
