import { expect, test } from "@playwright/test";
import { createStory, register } from "./helpers";

const run = Date.now();

test("a user can delete a story after confirming", async ({ page }) => {
  await register(page, `dora-${run}@example.com`);
  await createStory(page, "Story to delete");
  const storyPath = new URL(page.url()).pathname;

  // The first click only asks. Cancel leaves the story alone.
  await page.getByRole("button", { name: "Delete story" }).click();
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByRole("button", { name: "Delete forever" })).toHaveCount(0);

  await page.getByRole("button", { name: "Delete story" }).click();
  await page.getByRole("button", { name: "Delete forever" }).click();

  await expect(page).toHaveURL(/\/stories$/);
  // Next.js keeps the page we came from hidden in the DOM, so scope to the
  // visible one.
  const list = page.locator("main:visible");
  await expect(list.getByRole("heading", { name: "My stories" })).toBeVisible();
  await expect(list.getByText("Story to delete")).toHaveCount(0);

  await page.goto(storyPath);
  await expect(page.getByText("This page could not be found")).toBeVisible();
});
