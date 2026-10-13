import {
  AlignmentType,
  Document,
  Footer,
  HeadingLevel,
  LineRuleType,
  Packer,
  PageNumber,
  Paragraph,
  TextRun,
} from "docx";
import type { StoryDocument } from "./content-model";
import { TYPE } from "./typography";

// Word measures font size in half-points and spacing in twentieths of a point.
const halfPoints = (pt: number) => Math.round(pt * 2);
const twips = (pt: number) => Math.round(pt * 20);

// A DOCX does not carry its fonts. Word uses a font installed on the
// reader's computer, so pick one that Windows and macOS both have.
const FONT = "Georgia";

export async function renderStoryDocx(story: StoryDocument): Promise<Buffer> {
  const body: Paragraph[] = [];

  const paragraph = (text: string) =>
    new Paragraph({
      children: [new TextRun(text)],
      spacing: { after: twips(TYPE.paragraphSpaceAfterPt) },
      // Never leave one line of a paragraph alone on a page.
      widowControl: true,
    });

  story.intro.forEach((text) => body.push(paragraph(text)));
  for (const section of story.sections) {
    body.push(
      new Paragraph({
        text: section.heading,
        heading: HeadingLevel.HEADING_1,
        // keepNext: keep this heading on the same page as the paragraph after
        // it. This is Word's way to prevent a heading alone at a page bottom.
        keepNext: true,
        keepLines: true,
      }),
    );
    section.paragraphs.forEach((text) => body.push(paragraph(text)));
  }
  // The body must start on a new page after the cover.
  if (body.length === 0) body.push(paragraph(""));

  // US Letter, the same paper size as the PDF. The library's default is A4.
  const pageSize = { width: twips(612), height: twips(792) };
  const pageMargins = {
    top: twips(TYPE.marginPt),
    bottom: twips(TYPE.marginPt),
    left: twips(TYPE.marginPt),
    right: twips(TYPE.marginPt),
  };

  const document = new Document({
    title: story.title,
    creator: "StoryKeep",
    subject: story.kindLabel,
    styles: {
      default: {
        document: {
          run: { font: FONT, size: halfPoints(TYPE.bodyPt) },
          paragraph: {
            spacing: { line: Math.round(TYPE.lineHeight * 240), lineRule: LineRuleType.AUTO },
          },
        },
        title: {
          run: { font: FONT, size: halfPoints(TYPE.titlePt), bold: true },
          paragraph: { alignment: AlignmentType.CENTER, spacing: { after: twips(20) } },
        },
        heading1: {
          run: { font: FONT, size: halfPoints(TYPE.headingPt), bold: true, color: "1A1A1A" },
          paragraph: {
            spacing: {
              before: twips(TYPE.headingSpaceBeforePt),
              after: twips(TYPE.headingSpaceAfterPt),
            },
          },
        },
      },
    },
    sections: [
      {
        // Section 1: the cover. No footer, so no page number on it.
        properties: { page: { size: pageSize, margin: pageMargins } },
        children: [
          // Push the title down to about the middle of the page.
          new Paragraph({ spacing: { before: twips(230) }, children: [] }),
          new Paragraph({ text: story.title, heading: HeadingLevel.TITLE }),
          new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [
              new TextRun({
                text: story.kindLabel,
                italics: true,
                size: halfPoints(TYPE.headingPt),
              }),
            ],
          }),
        ],
      },
      {
        // Section 2: the story. A new section starts on a new page, and its
        // page numbers start again at 1.
        properties: {
          page: { size: pageSize, margin: pageMargins, pageNumbers: { start: 1 } },
        },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [
                  new TextRun({
                    children: [PageNumber.CURRENT],
                    size: halfPoints(TYPE.smallPt),
                    color: "666666",
                  }),
                ],
              }),
            ],
          }),
        },
        children: body,
      },
    ],
  });

  return Packer.toBuffer(document);
}
