import path from "node:path";
import {
  Document,
  Font,
  Page,
  renderToBuffer,
  StyleSheet,
  Text,
  View,
} from "@react-pdf/renderer";
import { withoutPictographs, type StoryDocument } from "./content-model";
import { TYPE } from "./typography";

// DejaVu Serif is embedded in the file, so the PDF looks the same on every
// machine and has the accented letters that the built-in PDF fonts lack.
const FONT_DIR = path.join(process.cwd(), "src/export/fonts");
const FONT = "DejaVu Serif";

// react-pdf multiplies the font's own line spacing, and DejaVu Serif's is
// already about 1.5 times the font size. So a factor of 1 here gives the
// same look as 1.5 line spacing in the Word file.
const PDF_LINE_HEIGHT = 1;

// A first paragraph longer than this is not glued to its heading (see below).
const MAX_KEEP_TOGETHER_CHARS = 1500;

let fontsRegistered = false;
function registerFonts() {
  if (fontsRegistered) return;
  Font.register({
    family: FONT,
    fonts: [
      { src: path.join(FONT_DIR, "DejaVuSerif.ttf") },
      { src: path.join(FONT_DIR, "DejaVuSerif-Bold.ttf"), fontWeight: "bold" },
      { src: path.join(FONT_DIR, "DejaVuSerif-Italic.ttf"), fontStyle: "italic" },
    ],
  });
  // Never split a word with a hyphen at the end of a line.
  Font.registerHyphenationCallback((word) => [word]);
  fontsRegistered = true;
}

const styles = StyleSheet.create({
  page: {
    fontFamily: FONT,
    fontSize: TYPE.bodyPt,
    // No lineHeight here. In @react-pdf/renderer 4.9 a line height set on the
    // page makes the page-number text (the `render` prop) disappear. It is
    // set on the paragraph style instead.
    paddingTop: TYPE.marginPt,
    paddingBottom: TYPE.marginPt + 16, // room for the page number
    paddingHorizontal: TYPE.marginPt,
    color: "#1a1a1a",
  },
  cover: {
    fontFamily: FONT,
    padding: TYPE.marginPt,
    justifyContent: "center",
    alignItems: "center",
    color: "#1a1a1a",
  },
  coverTitle: {
    fontSize: TYPE.titlePt,
    fontWeight: "bold",
    textAlign: "center",
    lineHeight: 1,
  },
  coverRule: { width: 64, height: 1, backgroundColor: "#888888", marginVertical: 20 },
  coverKind: { fontSize: TYPE.headingPt, fontStyle: "italic", textAlign: "center" },
  heading: {
    fontSize: TYPE.headingPt,
    fontWeight: "bold",
    lineHeight: 1,
    marginTop: TYPE.headingSpaceBeforePt,
    marginBottom: TYPE.headingSpaceAfterPt,
  },
  paragraph: {
    lineHeight: PDF_LINE_HEIGHT,
    marginBottom: TYPE.paragraphSpaceAfterPt,
    textAlign: "left",
  },
  pageNumber: {
    position: "absolute",
    bottom: TYPE.marginPt / 2,
    left: 0,
    right: 0,
    textAlign: "center",
    fontSize: TYPE.smallPt,
    color: "#666666",
  },
});

function Paragraph({ text }: { text: string }) {
  // orphans/widows: never leave a single line of a paragraph alone at the
  // bottom or the top of a page.
  return (
    <Text style={styles.paragraph} orphans={2} widows={2}>
      {text}
    </Text>
  );
}

function Section({ section }: { section: StoryDocument["sections"][number] }) {
  const [first, ...rest] = section.paragraphs;
  const heading = <Text style={styles.heading}>{section.heading}</Text>;

  // No orphan headings: a heading must never be the last thing on a page.
  // `wrap={false}` makes the heading and its first paragraph one block that
  // cannot be split, so they always move to the next page together.
  // (react-pdf also has `minPresenceAhead` for this, but in version 4.9 it
  // still left a heading alone at the bottom of a page in my test.)
  const keepTogether = first !== undefined && first.length <= MAX_KEEP_TOGETHER_CHARS;

  return (
    <View>
      {keepTogether ? (
        <View wrap={false}>
          {heading}
          <Paragraph text={first} />
        </View>
      ) : (
        <>
          {heading}
          {first !== undefined && <Paragraph text={first} />}
        </>
      )}
      {rest.map((text, i) => (
        <Paragraph key={i} text={text} />
      ))}
    </View>
  );
}

function StoryPdf({ story }: { story: StoryDocument }) {
  return (
    <Document title={story.title} author="StoryKeep" subject={story.kindLabel}>
      <Page size="LETTER" style={styles.cover}>
        <Text style={styles.coverTitle}>{story.title}</Text>
        <View style={styles.coverRule} />
        <Text style={styles.coverKind}>{story.kindLabel}</Text>
      </Page>

      <Page size="LETTER" style={styles.page}>
        {story.intro.map((text, i) => (
          <Paragraph key={`intro-${i}`} text={text} />
        ))}

        {story.sections.map((section, i) => (
          <Section key={`section-${i}`} section={section} />
        ))}

        {/* `fixed` repeats this on every body page. The cover is not counted. */}
        <Text
          style={styles.pageNumber}
          fixed
          render={({ pageNumber }) => `${pageNumber - 1}`}
        />
      </Page>
    </Document>
  );
}

export async function renderStoryPdf(story: StoryDocument): Promise<Buffer> {
  registerFonts();
  return renderToBuffer(<StoryPdf story={withoutPictographs(story)} />);
}
