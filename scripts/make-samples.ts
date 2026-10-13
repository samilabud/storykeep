// Writes the sample exports kept in docs/evidence/samples.
// Run with:  pnpm samples

import { mkdirSync, writeFileSync } from "node:fs";
import { parseStory } from "@/export/content-model";
import { renderStoryDocx } from "@/export/docx";
import { renderStoryPdf } from "@/export/pdf";
import { LONG_LIFE_STORY, SHORT_EULOGY } from "../tests/fixtures/stories";

const OUT = "docs/evidence/samples";

async function main() {
  mkdirSync(OUT, { recursive: true });
  for (const [name, story] of [
    ["sample-eulogy", SHORT_EULOGY],
    ["sample-life-story", LONG_LIFE_STORY],
  ] as const) {
    const document = parseStory(story);
    writeFileSync(`${OUT}/${name}.pdf`, await renderStoryPdf(document));
    writeFileSync(`${OUT}/${name}.docx`, await renderStoryDocx(document));
    console.log(`wrote ${OUT}/${name}.pdf and .docx`);
  }
}

main();
