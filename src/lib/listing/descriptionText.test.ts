import { describe, expect, it } from "vitest";
import { editableToHtml, htmlToEditable } from "./descriptionText";

const html = `<h2>Genesis – Wind &amp; Wuthering</h2>
<p>Original <strong>Atlantic</strong> CD.</p>
<ul><li><strong>Disc:</strong> Near mint</li><li><strong>Inlay:</strong> Near mint</li></ul>
<h2>Shipping</h2><p>Ships to Canada and the US.</p>`;

describe("description text", () => {
  it("turns the HTML into editable text", () => {
    expect(htmlToEditable(html)).toBe(
      "## Genesis – Wind & Wuthering\n\nOriginal **Atlantic** CD.\n\n- **Disc:** Near mint\n- **Inlay:** Near mint\n\n## Shipping\n\nShips to Canada and the US.",
    );
  });

  it("turns the text back into the same structure", () => {
    expect(editableToHtml(htmlToEditable(html))).toBe(
      "<h2>Genesis – Wind &amp; Wuthering</h2>\n<p>Original <strong>Atlantic</strong> CD.</p>\n" +
        "<ul><li><strong>Disc:</strong> Near mint</li><li><strong>Inlay:</strong> Near mint</li></ul>\n" +
        "<h2>Shipping</h2>\n<p>Ships to Canada and the US.</p>",
    );
  });

  it("escapes HTML typed by the seller and keeps line breaks in a paragraph", () => {
    expect(editableToHtml("a <b>\nsecond line")).toBe("<p>a &lt;b&gt;<br>second line</p>");
  });
});
