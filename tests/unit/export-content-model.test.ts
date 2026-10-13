import { describe, expect, it } from "vitest";
import {
  fileSlug,
  parseStory,
  stripPictographs,
  withoutPictographs,
} from "@/export/content-model";

const parse = (content: string, title = "Grandpa Joe") =>
  parseStory({ title, kind: "eulogy", content });

describe("story content model", () => {
  it("splits the text into a title, sections and paragraphs", () => {
    const doc = parse(
      "Grandpa Joe\n\n## Early Years\n\nHe was born in 1931.\n\nHe had two sisters.\n\n## Work\n\nHe was a carpenter.",
    );
    expect(doc).toEqual({
      title: "Grandpa Joe",
      kindLabel: "A Eulogy",
      intro: [],
      sections: [
        { heading: "Early Years", paragraphs: ["He was born in 1931.", "He had two sisters."] },
        { heading: "Work", paragraphs: ["He was a carpenter."] },
      ],
    });
  });

  it("does not print the title twice when the text starts with it", () => {
    expect(parse("Grandpa Joe\n\nHe was kind.").intro).toEqual(["He was kind."]);
    expect(parse("# Grandpa Joe\n\nHe was kind.").intro).toEqual(["He was kind."]);
  });

  it("keeps a first line that is not the title", () => {
    expect(parse("He was kind.\n\n## Work\n\nCarpenter.").intro).toEqual(["He was kind."]);
  });

  it("joins lines of one paragraph and treats a blank line as the break", () => {
    const doc = parse("## A\n\nline one\nline two\n\nnext paragraph");
    expect(doc.sections[0].paragraphs).toEqual(["line one line two", "next paragraph"]);
  });

  it("handles text with no headings, Windows line endings and extra blank lines", () => {
    const doc = parse("First.\r\n\r\n\r\n\r\nSecond.\r\n");
    expect(doc).toMatchObject({ intro: ["First.", "Second."], sections: [] });
  });

  it("accepts any heading level and removes bold, italic and code marks", () => {
    const doc = parse("### **Bold** heading\n\nSome *italic* and `code` here.");
    expect(doc.sections).toEqual([
      { heading: "Bold heading", paragraphs: ["Some italic and code here."] },
    ]);
  });

  it("labels the kind", () => {
    expect(parseStory({ title: "x", kind: "life_story", content: "" }).kindLabel).toBe("A Life Story");
  });

  it("returns an empty document for empty text", () => {
    expect(parse("")).toMatchObject({ intro: [], sections: [] });
  });
});

describe("emoji fallback", () => {
  it("removes emoji and tidies the space they leave", () => {
    expect(stripPictographs("We love you ❤️ always.")).toBe("We love you always.");
    expect(stripPictographs("Thank you, abuela. 🙏")).toBe("Thank you, abuela.");
    expect(stripPictographs("Family 👨‍👩‍👧 first")).toBe("Family first");
    expect(stripPictographs("👍🏽 Yes")).toBe("Yes");
  });

  it("keeps accents, quotes, dashes and symbols", () => {
    const text = "María José “said” — naïve, façade, Łódź, 5¢, £2, ½";
    expect(stripPictographs(text)).toBe(text);
  });

  it("drops a paragraph or heading that was only emoji", () => {
    const doc = withoutPictographs(parse("## Love ❤️\n\n🌻🌻🌻\n\nReal text."));
    expect(doc.sections).toEqual([{ heading: "Love", paragraphs: ["Real text."] }]);
  });
});

describe("download file name", () => {
  it.each([
    ["Grandpa Joe", "grandpa-joe"],
    ["María José Ñáñez-Brontë", "maria-jose-nanez-bronte"],
    ["  “Quoted” / title?  ", "quoted-title"],
    ["❤️", "story"],
    ["a".repeat(100), "a".repeat(60)],
  ])("%s -> %s", (title, slug) => {
    expect(fileSlug(title)).toBe(slug);
  });
});
