import JSZip from "jszip";
import { extractText } from "unpdf";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { processStripeEvent } from "@/billing/events";
import { parseStory } from "@/export/content-model";
import { renderStoryDocx } from "@/export/docx";
import { renderStoryPdf } from "@/export/pdf";
import { createStory } from "@/stories/data";
import { saveVersion } from "@/stories/versions";
import { LONG_LIFE_STORY, SHORT_EULOGY } from "../fixtures/stories";
import { createTestUser, giveActiveSubscription, resetDb } from "../helpers/db";
import { checkoutCompletedEvent } from "../helpers/stripe";

const session = vi.hoisted(() => ({ userId: null as string | null }));
vi.mock("@/auth/session", () => ({
  getSession: async () => (session.userId ? { user: { id: session.userId } } : null),
}));

import { GET } from "@/app/api/stories/[id]/export/route";

/** Text of each PDF page, read back from the finished file. */
async function pdfPages(file: Buffer): Promise<string[]> {
  const { text } = await extractText(new Uint8Array(file), { mergePages: false });
  return text.map((page) => page.replace(/\s+/g, " ").trim());
}

/** The XML parts inside a DOCX file (a DOCX is a zip of XML files). */
async function docxParts(file: Buffer) {
  const zip = await JSZip.loadAsync(file);
  const read = (name: string) => zip.file(name)!.async("string");
  const names = Object.keys(zip.files);
  const footerName = names.find((name) => /^word\/footer\d*\.xml$/.test(name));
  return {
    names,
    document: await read("word/document.xml"),
    styles: await read("word/styles.xml"),
    footer: footerName ? await read(footerName) : "",
  };
}

/** Visible text of a DOCX body, paragraph by paragraph. */
const docxParagraphs = (documentXml: string) =>
  [...documentXml.matchAll(/<w:p[ >][\s\S]*?<\/w:p>/g)]
    .map(([p]) => [...p.matchAll(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g)].map((m) => m[1]).join(""))
    .map((text) => text.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&apos;/g, "'"))
    .filter(Boolean);

const short = parseStory(SHORT_EULOGY);
const long = parseStory(LONG_LIFE_STORY);

describe("PDF export", () => {
  it("is a real PDF that opens, with a cover page and the story text", async () => {
    const file = await renderStoryPdf(short);
    expect(file.subarray(0, 5).toString()).toBe("%PDF-");

    const pages = await pdfPages(file);
    expect(pages).toHaveLength(2);
    expect(pages[0]).toBe("Grandpa Joe A Eulogy"); // the cover, and nothing else
    expect(pages[1]).toContain("The Man We Knew as Joe");
    expect(pages[1]).toContain("Joe was a carpenter for forty years.");
    expect(pages[1]).toContain("Thank you, Grandpa Joe. We will miss you.");
  });

  it("does not repeat the title line from the text inside the body", async () => {
    const pages = await pdfPages(await renderStoryPdf(short));
    expect(pages[1].startsWith("The Man We Knew as Joe")).toBe(true);
  });

  it("numbers the body pages 1, 2, 3... and leaves the cover unnumbered", async () => {
    const pages = await pdfPages(await renderStoryPdf(long));
    expect(pages[0]).not.toMatch(/\d$/);
    pages.slice(1).forEach((page, index) => {
      expect(page.endsWith(` ${index + 1}`)).toBe(true);
    });
  });

  it("spreads a long story over a sensible number of pages", async () => {
    const pages = await pdfPages(await renderStoryPdf(long));
    const words = LONG_LIFE_STORY.content.split(/\s+/).length;
    // About 1,900 words. At 300 to 500 words a page that is 4 to 7 body pages.
    expect(words).toBeGreaterThan(1500);
    expect(pages.length - 1).toBeGreaterThanOrEqual(4);
    expect(pages.length - 1).toBeLessThanOrEqual(7);
    // No page is blank or nearly blank except possibly the last.
    pages.slice(1, -1).forEach((page) => expect(page.length).toBeGreaterThan(800));
  });

  it("never leaves a heading alone at the bottom of a page", async () => {
    const pages = await pdfPages(await renderStoryPdf(long));
    const headings = long.sections.map((section) => section.heading);
    for (const page of pages.slice(1)) {
      const withoutPageNumber = page.replace(/ \d+$/, "");
      for (const heading of headings) {
        expect(withoutPageNumber.endsWith(heading)).toBe(false);
      }
    }
    // The test is only meaningful if headings do land on several pages.
    const pagesWithHeading = pages.filter((page) => /Chapter \d: The House/.test(page));
    expect(pagesWithHeading.length).toBeGreaterThanOrEqual(3);
  });

  it("moves a heading to the next page when it would be last on a page", async () => {
    // Push one heading down the first page a line at a time. For some of
    // these lengths the heading is the last thing that fits on page 1. It
    // must then start page 2, together with its paragraph.
    const paragraph =
      "This paragraph follows the heading and is long enough to need several lines of text on the page, so that it cannot squeeze into the space that is left under the heading.";
    let movedToNextPage = 0;

    for (let lines = 14; lines <= 30; lines++) {
      const filler = Array.from({ length: lines }, (_, i) => `Filler line ${i + 1}.`);
      const story = parseStory({
        title: "Orphan test",
        kind: "eulogy",
        content: [...filler, "## Target Heading", paragraph].join("\n\n"),
      });
      const pages = (await pdfPages(await renderStoryPdf(story))).slice(1);

      for (const page of pages) {
        expect(page.replace(/ \d+$/, "").endsWith("Target Heading")).toBe(false);
      }
      // The heading and the start of its paragraph are always on one page.
      const page = pages.find((p) => p.includes("Target Heading"))!;
      expect(page).toContain("Target Heading This paragraph follows the heading");
      if (pages.length === 2 && pages[1].startsWith("Target Heading")) movedToNextPage++;
    }
    // Proof that the range really crossed the page boundary.
    expect(movedToNextPage).toBeGreaterThan(0);
  }, 30_000);

  it("keeps accented letters, curly quotes, dashes and symbols", async () => {
    const text = (await pdfPages(await renderStoryPdf(long))).join(" ");
    for (const piece of [
      "María José Ñáñez-Brontë",
      "Zoë's “Grandmother”: Early Years in Köln & São Paulo",
      "François",
      "“a child born in winter is never afraid of the cold” — and he was right",
      "5¢",
      "½ a peso",
      "£2 a week",
      "naïve, façade, coöperate, Ærøskøbing, Łódź, Dvořák",
    ]) {
      expect(text).toContain(piece);
    }
  });

  it("embeds its font, so it looks the same on every computer", async () => {
    const file = await renderStoryPdf(short);
    expect(file.toString("latin1")).toMatch(/\/FontName\s*\/[A-Z]{6}\+DejaVuSerif/);
  });

  it("leaves emoji out instead of printing empty boxes", async () => {
    const text = (await pdfPages(await renderStoryPdf(long))).join(" ");
    expect(text).toContain("told by the people who loved her.");
    expect(text).toContain("What She Left Us");
    expect(text).toContain("Thank you, abuela.");
    expect(text).not.toMatch(/\p{Extended_Pictographic}/u);
    expect(text).not.toContain("�"); // the "unknown character" mark
  });

  it("renders a story with no headings, and an empty story, without failing", async () => {
    const plain = parseStory({ title: "Plain", kind: "eulogy", content: "One.\n\nTwo." });
    expect((await pdfPages(await renderStoryPdf(plain)))[1]).toContain("One. Two.");
    const empty = parseStory({ title: "Empty", kind: "eulogy", content: "" });
    expect(await pdfPages(await renderStoryPdf(empty))).toHaveLength(2);
  });
});

describe("DOCX export", () => {
  it("is a real Word file: a zip with the expected parts", async () => {
    const file = await renderStoryDocx(short);
    expect(file.subarray(0, 2).toString()).toBe("PK");
    const { names } = await docxParts(file);
    expect(names).toEqual(
      expect.arrayContaining(["[Content_Types].xml", "word/document.xml", "word/styles.xml"]),
    );
  });

  it("contains the title, the headings and the paragraphs in order", async () => {
    const { document } = await docxParts(await renderStoryDocx(short));
    expect(docxParagraphs(document)).toEqual([
      "Grandpa Joe",
      "A Eulogy",
      "The Man We Knew as Joe",
      expect.stringContaining("His name was Joseph Ellis."),
      expect.stringContaining("There is something fitting about that."),
      "Forty Years of Carpentry",
      expect.stringContaining("Joe was a carpenter for forty years."),
      "What Stays With Us",
      expect.stringContaining("So the next time you climb the steps"),
      "Thank you, Grandpa Joe. We will miss you.",
    ]);
  });

  it("marks headings with real heading styles, so Word's outline and screen readers see them", async () => {
    const { document } = await docxParts(await renderStoryDocx(short));
    expect(document.match(/<w:pStyle w:val="Heading1"\/>/g)).toHaveLength(3);
    expect(document.match(/<w:pStyle w:val="Title"\/>/g)).toHaveLength(1);
  });

  it("keeps every heading with the paragraph after it (no orphan headings)", async () => {
    const { document } = await docxParts(await renderStoryDocx(long));
    const headings = [...document.matchAll(/<w:p[ >][\s\S]*?<\/w:p>/g)]
      .map(([p]) => p)
      .filter((p) => p.includes('w:val="Heading1"'));
    expect(headings).toHaveLength(long.sections.length);
    for (const heading of headings) expect(heading).toContain("<w:keepNext/>");
  });

  it("starts the story on a new page after the cover, with page numbers from 1", async () => {
    const { document, footer } = await docxParts(await renderStoryDocx(short));
    // Two sections: the cover, then the body. A new section is a new page.
    expect(document.match(/<w:sectPr/g)).toHaveLength(2);
    expect(document).toMatch(/<w:pgNumType w:start="1"/);
    // The footer holds Word's PAGE field, which Word fills with the number.
    expect(footer).toContain("PAGE");
    // Only the body section has a footer, so the cover has no number.
    expect(document.match(/<w:footerReference/g)).toHaveLength(1);
  });

  it("uses US Letter paper with 1 inch margins, the same as the PDF", async () => {
    const { document } = await docxParts(await renderStoryDocx(short));
    expect(document).toMatch(/<w:pgSz w:w="12240" w:h="15840"/);
    expect(document).toMatch(/<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/);
  });

  it("sets the same type sizes as the PDF: 11.5pt body, 15pt headings, 28pt title", async () => {
    const { styles } = await docxParts(await renderStoryDocx(short));
    expect(styles).toContain('<w:sz w:val="23"/>'); // half-points: 11.5pt
    expect(styles).toContain('<w:sz w:val="30"/>'); // 15pt
    expect(styles).toContain('<w:sz w:val="56"/>'); // 28pt
    expect(styles).toContain('w:ascii="Georgia"');
  });

  it("keeps accented letters, curly quotes, symbols, and emoji too", async () => {
    const { document } = await docxParts(await renderStoryDocx(long));
    const text = docxParagraphs(document).join("\n");
    for (const piece of [
      "María José Ñáñez-Brontë",
      "Zoë's “Grandmother”: Early Years in Köln & São Paulo",
      "naïve, façade, coöperate, Ærøskøbing, Łódź, Dvořák",
      "5¢",
      "What She Left Us ❤️", // Word has an emoji font, so emoji stay
    ]) {
      expect(text).toContain(piece);
    }
  });

  it("escapes characters that are special in XML", async () => {
    const tricky = parseStory({
      title: "A & B <tag>",
      kind: "eulogy",
      content: '## Q&A <b>\n\nShe said "5 < 6 & 7 > 3".',
    });
    const { document } = await docxParts(await renderStoryDocx(tricky));
    expect(document).toContain("A &amp; B &lt;tag&gt;");
    expect(document).not.toContain("<tag>");
    expect(document).not.toContain("<b>");
  });
});

describe("PDF and DOCX carry the same content", () => {
  it("every heading and every paragraph is in both files", async () => {
    const pdfText = (await pdfPages(await renderStoryPdf(short))).join(" ");
    const { document } = await docxParts(await renderStoryDocx(short));
    const docxText = docxParagraphs(document).join(" ");

    for (const section of short.sections) {
      for (const piece of [section.heading, ...section.paragraphs]) {
        expect(pdfText).toContain(piece);
        expect(docxText).toContain(piece);
      }
    }
  });
});

describe("GET /api/stories/:id/export", () => {
  let alice: { id: string };
  let bob: { id: string };
  let eulogyId: string;
  let lifeStoryId: string;

  const get = (storyId: string, format = "pdf") =>
    GET(new Request(`http://localhost/api/stories/${storyId}/export?format=${format}`), {
      params: Promise.resolve({ id: storyId }),
    });
  const pay = (storyId: string) =>
    processStripeEvent(checkoutCompletedEvent({ userId: alice.id, storyId }));

  beforeEach(async () => {
    await resetDb();
    alice = await createTestUser("alice@example.com");
    bob = await createTestUser("bob@example.com");
    eulogyId = (await createStory(alice.id, { title: "Grandpa José", kind: "eulogy" })).id;
    lifeStoryId = (await createStory(alice.id, { title: "Aunt Rosa", kind: "life_story" })).id;
    for (const storyId of [eulogyId, lifeStoryId]) {
      await saveVersion(alice.id, storyId, {
        source: "user_edit",
        content: "## Work\n\nHe was a carpenter.",
      });
    }
    session.userId = alice.id;
  });

  it("401 when nobody is signed in", async () => {
    session.userId = null;
    expect((await get(eulogyId)).status).toBe(401);
  });

  it("404 for another user's story, even if that user has paid", async () => {
    await pay(eulogyId);
    session.userId = bob.id;
    expect((await get(eulogyId)).status).toBe(404);
  });

  it("402 for a eulogy that is not paid for", async () => {
    const response = await get(eulogyId);
    expect(response.status).toBe(402);
    expect(response.headers.get("content-type")).toContain("application/json");
  });

  it("402 for a life story without a subscription", async () => {
    expect((await get(lifeStoryId)).status).toBe(402);
  });

  it("a eulogy payment does not unlock the life story download", async () => {
    await pay(eulogyId);
    expect((await get(lifeStoryId)).status).toBe(402);
  });

  it("400 for an unknown format", async () => {
    await pay(eulogyId);
    expect((await get(eulogyId, "exe")).status).toBe(400);
  });

  it("409 when the story has no text yet", async () => {
    const empty = await createStory(alice.id, { title: "Empty", kind: "life_story" });
    await giveActiveSubscription(alice.id);
    expect((await get(empty.id)).status).toBe(409);
  });

  it("200 with a PDF for a paid eulogy", async () => {
    await pay(eulogyId);
    const response = await get(eulogyId, "pdf");

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/pdf");
    expect(response.headers.get("content-disposition")).toBe(
      'attachment; filename="grandpa-jose.pdf"',
    );
    expect(response.headers.get("cache-control")).toBe("private, no-store");

    const pages = await pdfPages(Buffer.from(await response.arrayBuffer()));
    expect(pages[0]).toBe("Grandpa José A Eulogy");
    expect(pages[1]).toContain("He was a carpenter.");
  });

  it("200 with a DOCX for a subscriber's life story", async () => {
    await giveActiveSubscription(alice.id);
    const response = await get(lifeStoryId, "docx");

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );
    expect(response.headers.get("content-disposition")).toBe(
      'attachment; filename="aunt-rosa.docx"',
    );
    const { document } = await docxParts(Buffer.from(await response.arrayBuffer()));
    expect(docxParagraphs(document)).toContain("He was a carpenter.");
  });

  it("exports the current version, not an older one", async () => {
    await pay(eulogyId);
    await saveVersion(alice.id, eulogyId, {
      source: "user_edit",
      content: "## Work\n\nHe was a master carpenter.",
    });
    const pages = await pdfPages(Buffer.from(await (await get(eulogyId)).arrayBuffer()));
    expect(pages[1]).toContain("He was a master carpenter.");
  });
});
