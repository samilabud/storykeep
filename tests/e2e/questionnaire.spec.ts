import { expect, test } from "@playwright/test";
import { createStory, PASSWORD, register } from "./helpers";

const run = Date.now();

test("questionnaire: save, skip, resume after signing in again, edit with history", async ({
  page,
}) => {
  const email = `dana-${run}@example.com`;
  await register(page, email);
  await createStory(page, "Grandpa Joe");
  const storyPath = new URL(page.url()).pathname;

  await page.getByRole("link", { name: "Start the questionnaire" }).click();
  const main = page.locator("main:visible");

  // Question 1: answer. Question 2: skip. Question 3: answer.
  await expect(main.getByText("Question 1 of 9")).toBeVisible();
  await main.locator("#answer").fill("Joseph Ellis");
  await main.getByRole("button", { name: "Save and continue" }).click();

  await expect(main.getByText("Question 2 of 9")).toBeVisible();
  await main.getByRole("button", { name: "Skip this question" }).click();

  await expect(main.getByText("Question 3 of 9")).toBeVisible();
  await main.locator("#answer").fill("He built a raft at age nine.");
  await main.getByRole("button", { name: "Save and continue" }).click();
  await expect(main.getByText("Question 4 of 9")).toBeVisible();

  // Leave completely: sign out, then sign in again.
  await page.goto("/stories");
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login$/);
  await main.getByLabel("Email").fill(email);
  await main.getByLabel("Password").fill(PASSWORD);
  await main.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "My stories" })).toBeVisible();

  // Resume: the story knows 3 questions are done and opens question 4.
  await page.goto(storyPath);
  await expect(main.getByText("3 of 9 questions done")).toBeVisible();
  await main.getByRole("link", { name: "Continue where you stopped" }).click();
  await expect(main.getByText("Question 4 of 9")).toBeVisible();
  await expect(main.getByText("Joseph Ellis")).toBeVisible();
  await expect(main.getByText("Skipped", { exact: true })).toBeVisible();
  await page.screenshot({
    path: "docs/evidence/m2-resume-at-question-4.png",
    fullPage: true,
  });

  // Edit answer 1. The old answer stays in the history.
  await main.getByRole("link", { name: /^Edit: What is their full name/ }).click();
  await expect(main.getByText("Question 1 of 9")).toBeVisible();
  await expect(main.locator("#answer")).toHaveValue("Joseph Ellis");
  await main.locator("#answer").fill("Joseph 'Joe' Ellis");
  await main.getByRole("button", { name: "Save and continue" }).click();
  await expect(main.getByText("Question 4 of 9")).toBeVisible();

  await page.goto(`${storyPath}/questionnaire?q=full_name`);
  await expect(main.locator("#answer")).toHaveValue("Joseph 'Joe' Ellis");
  await main.getByText("Earlier answers (1)").click();
  await expect(main.locator("details li")).toHaveText(["Joseph Ellis"]);
  await page.screenshot({
    path: "docs/evidence/m2-answer-history.png",
    fullPage: true,
  });
});

test("story text: each save is a new version, and an old one can be restored", async ({
  page,
}) => {
  await register(page, `erin-${run}@example.com`);
  await createStory(page, "Aunt Rosa");
  const main = page.locator("main:visible");
  const editor = main.getByLabel("Story text");
  const history = main.locator("ol li");

  await editor.fill("First text.");
  await main.getByRole("button", { name: "Save as new version" }).click();
  await expect(history).toHaveText([/Version 1.*Your edit · current/]);

  await editor.fill("Second text.");
  await main.getByRole("button", { name: "Save as new version" }).click();
  await expect(history).toHaveText([
    /Version 2.*current/,
    /Version 1.*Your edit$/,
  ]);

  // Open version 1 and restore it.
  await main.getByRole("link", { name: "Version 1" }).click();
  await expect(main.locator("article")).toHaveText("First text.");
  await main.getByRole("button", { name: "Restore this version" }).click();

  // Restore made version 3. Versions 1 and 2 are still listed.
  await expect(editor).toHaveValue("First text.");
  await expect(history).toHaveText([
    /Version 3.*current/,
    /Version 2/,
    /Version 1/,
  ]);
  await page.screenshot({
    path: "docs/evidence/m2-version-history.png",
    fullPage: true,
  });
});
