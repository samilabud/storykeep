# M6 evidence: server-side PDF and DOCX export

**Claims:** `GET /api/stories/:id/export?format=pdf|docx` builds a PDF or a
Word file on the server from the current version of a story. Both files have
a cover title, consistent headings and body type, page numbers and page
breaks with no orphan headings. Long text and special characters work.
Downloading requires payment.

## Sample files

Made by `pnpm samples` from the fixtures in `tests/fixtures/stories.ts`.

| File | Pages | What it shows |
|---|---|---|
| [samples/sample-eulogy.pdf](samples/sample-eulogy.pdf) | 2 | A short eulogy: cover and one page |
| [samples/sample-eulogy.docx](samples/sample-eulogy.docx) | 2 | The same content as a Word file |
| [samples/sample-life-story.pdf](samples/sample-life-story.pdf) | 7 | About 1,900 words, 7 sections, accents, quotes, symbols, emoji |
| [samples/sample-life-story.docx](samples/sample-life-story.docx) | 6 | The same content as a Word file |

The Word page counts are from LibreOffice (`soffice --convert-to pdf`). Word
itself may differ by a page, because Word lays the text out when it opens the
file.

Page images:

| | PDF | DOCX (rendered by LibreOffice) |
|---|---|---|
| Cover | [m6-pdf-cover-1.png](m6-pdf-cover-1.png) | [m6-docx-cover-1.png](m6-docx-cover-1.png) |
| Body page 2 | [m6-pdf-page-3.png](m6-pdf-page-3.png) | [m6-docx-page-3.png](m6-docx-page-3.png) |

Both body pages show a section heading followed by its paragraph, the same
type sizes, and the page number 2 at the bottom centre.

## Automated tests

| Test | File | What it checks |
|---|---|---|
| Vitest, 16 tests | `tests/unit/export-content-model.test.ts` | Text to title, sections and paragraphs. The title is not printed twice. Emoji removal keeps accents and symbols. Safe file names. |
| Vitest, 30 tests | `tests/integration/export.test.ts` | See below. |
| Playwright, 2 tests | `tests/e2e/export.spec.ts` | A subscriber clicks "Download PDF" and "Download Word" in a real browser. The test opens both downloaded files and reads the text. An unpaid eulogy shows no link, and the API answers 402. |

The tests your brief asked for, "files open, contain the expected text, and
page count is sensible":

- **Files open.** The PDF starts with `%PDF-` and a PDF parser reads it. The
  DOCX is a zip with `word/document.xml` and `word/styles.xml`.
- **Expected text.** PDF text is extracted page by page: the cover holds only
  the title and kind, and the body holds every heading and paragraph. The DOCX
  XML is parsed, and its paragraphs match the source in order.
- **Sensible page count.** About 1,900 words give 6 body pages (the test
  allows 4 to 7), and no middle page is nearly empty.

Also covered:

- Page numbers: the cover has none, body pages end in 1, 2, 3...
- No orphan headings in the PDF: a heading is pushed down page 1 one line at a
  time, 17 different positions. It is never the last thing on a page, and at
  the boundary it moves to page 2 with its paragraph.
- No orphan headings in the DOCX: every heading has `keepNext`.
- Special characters: `María José Ñáñez-Brontë`, curly quotes, the em dash,
  `5¢`, `½`, `£2`, `Ærøskøbing, Łódź, Dvořák` are all in both files.
- Emoji: left out of the PDF with no empty boxes, kept in the DOCX.
- The PDF embeds its font.
- The DOCX uses real `Heading1` and `Title` styles, US Letter paper, 1 inch
  margins and the same type sizes as the PDF, and escapes `<`, `>` and `&`.
- The route: 401 not signed in, 404 another user's story (even a paid one),
  402 unpaid eulogy, 402 life story without a subscription, 400 unknown
  format, 409 no text yet, 200 with the right content type and file name.
  It exports the current version.

Full output: [m6-test-output.log](m6-test-output.log)

### The tests can fail

| I broke | Result |
|---|---|
| Removed the keep-together block in the PDF | `× moves a heading to the next page when it would be last on a page` |
| Removed `keepNext` in the DOCX | `× keeps every heading with the paragraph after it` |
| Put a line height back on the PDF page style | `× numbers the body pages 1, 2, 3...` |

## Also checked

- The export works in a production build (`next build` and `next start`), and
  the build output lists the three font files with the export route.
- Screenshot of the download links: [m6-download-links.png](m6-download-links.png)

## Not proven

- The DOCX was opened in LibreOffice, not in Microsoft Word.
- No test compares the look of the two files pixel by pixel. They share sizes,
  margins and structure, and I compared the page images by eye.

## How to repeat it

```bash
pnpm samples          # rewrites docs/evidence/samples
pnpm test             # content model, PDF, DOCX and route tests
pnpm test:e2e         # downloads both files in a browser
```
