import { expect, type Page } from "@playwright/test";

export const PASSWORD = "correct-horse-battery";

export async function register(page: Page, email: string) {
  await page.goto("/register");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("heading", { name: "My stories" })).toBeVisible();
}

export async function createStory(page: Page, title: string) {
  await page.getByLabel("Title").fill(title);
  await page.getByRole("button", { name: "Create story" }).click();
  await expect(page.getByRole("heading", { name: title })).toBeVisible();
}
