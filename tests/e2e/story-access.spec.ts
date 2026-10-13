import { expect, test, type Page } from "@playwright/test";

// Real browser, real login, real database. Emails are unique per run so the
// test can be repeated against the dev database.
const run = Date.now();
const PASSWORD = "correct-horse-battery";

async function register(page: Page, email: string) {
  await page.goto("/register");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("heading", { name: "My stories" })).toBeVisible();
}

test("a user cannot open another user's story", async ({ browser }) => {
  // Alice signs up and creates a story.
  const aliceContext = await browser.newContext();
  const alice = await aliceContext.newPage();
  await register(alice, `alice-${run}@example.com`);
  await alice.getByLabel("Title").fill("Alice's grandfather");
  await alice.getByRole("button", { name: "Create story" }).click();
  await expect(
    alice.getByRole("heading", { name: "Alice's grandfather" }),
  ).toBeVisible();
  const storyUrl = new URL(alice.url());
  const storyId = storyUrl.pathname.split("/").pop()!;
  await alice.screenshot({ path: "docs/evidence/m1-owner-sees-story.png" });

  // Bob signs up in a separate browser session and tries Alice's URL.
  const bobContext = await browser.newContext();
  const bob = await bobContext.newPage();
  await register(bob, `bob-${run}@example.com`);
  await expect(bob.getByText("Alice's grandfather")).toHaveCount(0);

  await bob.goto(storyUrl.pathname);
  await expect(bob.getByText("This page could not be found")).toBeVisible();
  await expect(bob.getByText("Alice's grandfather")).toHaveCount(0);
  await bob.screenshot({ path: "docs/evidence/m1-other-user-gets-404.png" });

  // The JSON API gives Bob a real 404 status, and Alice a 200.
  expect((await bob.request.get(`/api/stories/${storyId}`)).status()).toBe(404);
  expect((await alice.request.get(`/api/stories/${storyId}`)).status()).toBe(200);

  // A visitor with no session is sent to the login page.
  const anonContext = await browser.newContext();
  const anon = await anonContext.newPage();
  await anon.goto(storyUrl.pathname);
  await expect(anon).toHaveURL(/\/login$/);
});

test("login rejects a wrong password", async ({ page }) => {
  const email = `carol-${run}@example.com`;
  await register(page, email);
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login$/);

  // Next.js keeps the page we came from hidden in the DOM, so scope to the
  // visible one.
  const form = page.locator("main:visible");
  await form.getByLabel("Email").fill(email);
  await form.getByLabel("Password").fill("wrong-password");
  await form.getByRole("button", { name: "Sign in" }).click();
  await expect(form.getByRole("alert")).toHaveText("Wrong email or password.");
  // The email must survive the failed attempt.
  await expect(form.getByLabel("Email")).toHaveValue(email);

  await form.getByLabel("Password").fill(PASSWORD);
  await form.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "My stories" })).toBeVisible();
});
