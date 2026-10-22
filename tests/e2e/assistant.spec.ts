import { expect, test } from "@playwright/test";
import { createStory, register } from "./helpers";

const run = Date.now();

// Needs the app running with LLM_PROVIDER=mock. The mock echoes the question
// and says how many answers it was given.
test("the story assistant streams a reply grounded in the story", async ({ page }) => {
  await register(page, `gail-${run}@example.com`);
  await createStory(page, "Uncle Sam");
  const main = page.locator("main:visible");

  // Answer one question, then come back to the story.
  await main.getByRole("link", { name: "Start the questionnaire" }).click();
  await main.locator("#answer").fill("Samuel Ortiz, known as Sam.");
  await main.getByRole("button", { name: "Save and continue" }).click();
  await expect(main.getByText("Question 2 of 9")).toBeVisible();
  await main.getByRole("link", { name: "← Uncle Sam" }).click();

  const assistant = main.getByRole("region", { name: "Story assistant" });
  await assistant.getByLabel("Message to the story assistant").fill("Where should I start?");
  await assistant.getByRole("button", { name: "Send" }).click();

  const log = assistant.getByRole("log");
  await expect(log).toContainText('You asked: "Where should I start?"');
  await expect(log).toContainText("1 answered questions and 8 still open");

  // The conversation survives a reload in the same tab.
  await page.reload();
  await expect(main.getByRole("log")).toContainText("Where should I start?");

  // A suggestion chip sends right away.
  await main.getByRole("button", { name: "Clear chat" }).click();
  await main.getByRole("button", { name: "What should a good opening say?" }).click();
  await expect(main.getByRole("log")).toContainText(
    'You asked: "What should a good opening say?"',
  );
});
