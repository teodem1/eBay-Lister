/**
 * The listing description as plain text the seller can edit on a phone, and
 * back to the simple HTML eBay shows. Light markup only:
 *   "## Heading", "- bullet", "**bold**", blank line between paragraphs.
 */

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", "#39": "'" };

function decode(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&([#\w]+);/g, (m, name) => ENTITIES[name.toLowerCase()] ?? m);
}

function escape(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** HTML -> editable text. */
export function htmlToEditable(html: string): string {
  const text = html
    .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, "")
    .replace(/\s*\n\s*/g, " ")
    .replace(/<(strong|b)\b[^>]*>([\s\S]*?)<\/\1>/gi, "**$2**")
    .replace(/<h[1-6]\b[^>]*>([\s\S]*?)<\/h[1-6]>/gi, "\n\n## $1\n\n")
    .replace(/<li\b[^>]*>([\s\S]*?)<\/li>/gi, "\n- $1")
    .replace(/<\/?(ul|ol)\b[^>]*>/gi, "\n\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/?(p|div|section|table|tr)\b[^>]*>/gi, "\n\n")
    .replace(/<[^>]+>/g, "");
  return decode(text)
    .split("\n")
    .map((l) => l.replace(/[ \t]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function inline(s: string): string {
  return escape(s).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
}

/** Editable text -> HTML for eBay. */
export function editableToHtml(text: string): string {
  const out: string[] = [];
  let para: string[] = [];
  let list: string[] = [];
  const flush = () => {
    if (para.length) out.push(`<p>${para.map(inline).join("<br>")}</p>`);
    if (list.length) out.push(`<ul>${list.map((li) => `<li>${inline(li)}</li>`).join("")}</ul>`);
    para = [];
    list = [];
  };
  for (const raw of text.replace(/\r/g, "").split("\n")) {
    const line = raw.trim();
    if (!line) {
      flush();
    } else if (/^#{1,6}\s+/.test(line)) {
      flush();
      out.push(`<h2>${inline(line.replace(/^#{1,6}\s+/, ""))}</h2>`);
    } else if (/^[-*•]\s+/.test(line)) {
      if (para.length) flush();
      list.push(line.replace(/^[-*•]\s+/, ""));
    } else {
      if (list.length) flush();
      para.push(line);
    }
  }
  flush();
  return out.join("\n");
}
