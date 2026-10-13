// One description of the document that both the PDF and the DOCX renderer
// read. If the two files ever differ in content, the bug is here, in one
// place, and not in two renderers that each parse the text their own way.

export type StoryDocument = {
  title: string;
  /** "A Eulogy" or "A Life Story", shown under the title on the cover. */
  kindLabel: string;
  /** Text before the first heading, if any. */
  intro: string[];
  sections: { heading: string; paragraphs: string[] }[];
};

const KIND_LABEL = { eulogy: "A Eulogy", life_story: "A Life Story" } as const;

/**
 * Turns the stored story text into a document.
 *
 * The text format is the one the LLM is asked for and the user edits:
 *   - the first non-empty line is the title
 *   - a line that starts with "## " is a section heading
 *   - a blank line ends a paragraph
 */
export function parseStory(input: {
  title: string;
  kind: keyof typeof KIND_LABEL;
  content: string;
}): StoryDocument {
  const lines = input.content.replace(/\r\n?/g, "\n").split("\n");

  const document: StoryDocument = {
    title: input.title,
    kindLabel: KIND_LABEL[input.kind],
    intro: [],
    sections: [],
  };

  let paragraph: string[] = [];
  let sawTitleLine = false;
  const target = () => document.sections.at(-1)?.paragraphs ?? document.intro;
  const endParagraph = () => {
    if (paragraph.length > 0) target().push(paragraph.join(" "));
    paragraph = [];
  };

  for (const raw of lines) {
    const line = raw.trim();

    const heading = /^#{1,6}\s+(.*)$/.exec(line);
    if (heading) {
      endParagraph();
      const text = cleanInline(heading[1]);
      // A "# Title" line repeats the title that is already on the cover.
      const isTitle = line.startsWith("# ") && !sawTitleLine && document.sections.length === 0;
      sawTitleLine = true;
      if (!isTitle && text) document.sections.push({ heading: text, paragraphs: [] });
      continue;
    }

    if (line === "") {
      endParagraph();
      continue;
    }

    // The first plain line is the title the LLM was asked to write. The cover
    // already shows the title, so do not print it a second time as body text.
    if (!sawTitleLine && document.sections.length === 0 && document.intro.length === 0 && paragraph.length === 0) {
      sawTitleLine = true;
      if (sameText(line, input.title)) continue;
    }

    paragraph.push(cleanInline(line));
  }
  endParagraph();

  return document;
}

/** Removes Markdown marks the exports do not render (bold, italics, code). */
function cleanInline(text: string): string {
  return text
    .replace(/(\*\*|__)(.+?)\1/g, "$2")
    .replace(/(\*|_)(.+?)\1/g, "$2")
    .replace(/`(.+?)`/g, "$1")
    .trim();
}

const sameText = (a: string, b: string) =>
  cleanInline(a).toLowerCase() === b.trim().toLowerCase();

// Emoji and other pictographs, with the invisible characters that join them.
const PICTOGRAPHS = /[\p{Extended_Pictographic}\u{FE0F}\u{200D}\u{1F3FB}-\u{1F3FF}]/gu;

/**
 * The PDF font has letters, accents and punctuation, but no emoji. Without
 * this, an emoji would print as an empty box. The fallback is to leave it
 * out and tidy the space it leaves behind.
 */
export function stripPictographs(text: string): string {
  return text
    .replace(PICTOGRAPHS, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\s+([.,;:!?])/g, "$1")
    .trim();
}

/** The same document with pictographs removed from every piece of text. */
export function withoutPictographs(document: StoryDocument): StoryDocument {
  const clean = (texts: string[]) => texts.map(stripPictographs).filter(Boolean);
  return {
    ...document,
    title: stripPictographs(document.title),
    intro: clean(document.intro),
    sections: document.sections.map((section) => ({
      heading: stripPictographs(section.heading),
      paragraphs: clean(section.paragraphs),
    })),
  };
}

/** A safe download name: "Grandpa Joe" -> "grandpa-joe". */
export function fileSlug(title: string): string {
  const slug = title
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // drop accents: "José" -> "Jose"
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return slug || "story";
}
