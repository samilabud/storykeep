import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import JSZip from "jszip";
import { extractText } from "unpdf";
import { seedActiveSubscription } from "./db";
import { createStory, register } from "./helpers";

const run = Date.now();
const STORY_TEXT = [
  "Tía Rosa",
  "",
  "## Early Years",
  "",
  "Rosa María Ortiz was born in Córdoba. Everyone called her “Tía Rosa”.",
  "",
  "## Her Kitchen",
  "",
  "She cooked for the whole street — and never wrote a recipe down.",
].join("\n");

async function download(page: Page, linkName: string) {
  const [file] = await Promise.all([
    page.waitForEvent("download"),
    page.locator("main:visible").getByRole("link", { name: linkName }).click(),
  ]);
  return { name: file.suggestedFilename(), bytes: readFileSync(await file.path()) };
}

test("export: a subscriber downloads the story as PDF and as Word", async ({ page }) => {
  const email = `ines-${run}@example.com`;
  await register(page, email);
  await seedActiveSubscription(email); // billing has its own tests
  await createStory(page, "Tía Rosa");
  const main = page.locator("main:visible");

  // Nothing to download until the story has text.
  await expect(main.getByRole("heading", { name: "Download" })).toHaveCount(0);

  await main.getByLabel("Story text").fill(STORY_TEXT);
  await main.getByRole("button", { name: "Save as new version" }).click();
  await expect(main.getByRole("heading", { name: "Download" })).toBeVisible();
  await page.screenshot({ path: "docs/evidence/m6-download-links.png", fullPage: true });

  // PDF: open the downloaded file and read its text back.
  const pdf = await download(page, "Download PDF");
  expect(pdf.name).toBe("tia-rosa.pdf");
  const { text } = await extractText(new Uint8Array(pdf.bytes), { mergePages: false });
  const pages = text.map((t) => t.replace(/\s+/g, " ").trim());
  expect(pages).toHaveLength(2);
  expect(pages[0]).toBe("Tía Rosa A Life Story");
  expect(pages[1]).toContain("Early Years Rosa María Ortiz was born in Córdoba.");
  expect(pages[1]).toContain("Everyone called her “Tía Rosa”.");
  expect(pages[1]).toContain("She cooked for the whole street — and never wrote a recipe down.");

  // DOCX: unzip it and read the document XML.
  const docx = await download(page, "Download Word (DOCX)");
  expect(docx.name).toBe("tia-rosa.docx");
  const zip = await JSZip.loadAsync(docx.bytes);
  const xml = await zip.file("word/document.xml")!.async("string");
  expect(xml).toContain("Rosa María Ortiz was born in Córdoba.");
  expect(xml).toContain("Her Kitchen");
  expect(xml.match(/w:val="Heading1"/g)).toHaveLength(2);
});

test("export: an unpaid eulogy shows no download and the API refuses it", async ({ page }) => {
  await register(page, `jon-${run}@example.com`);
  await createStory(page, "Uncle Ben", "Eulogy");
  const storyId = new URL(page.url()).pathname.split("/").pop()!;
  const main = page.locator("main:visible");

  await main.getByLabel("Story text").fill("He told the best stories.");
  await main.getByRole("button", { name: "Save as new version" }).click();

  await expect(main.getByText("Downloads are unlocked when the eulogy is paid for.")).toBeVisible();
  await expect(main.getByRole("link", { name: "Download PDF" })).toHaveCount(0);

  // Hiding the link is not the protection. The server refuses the request.
  for (const format of ["pdf", "docx"]) {
    const response = await page.request.get(`/api/stories/${storyId}/export?format=${format}`);
    expect(response.status()).toBe(402);
  }
});
