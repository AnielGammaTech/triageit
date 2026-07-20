import { expect, test } from "@playwright/test";

test("login page renders the TriageIT entry point", async ({ page }) => {
  await page.goto("/login");
  await expect(page).toHaveTitle(/TriageIT/i);
  await expect(page.locator("body")).toContainText(/sign in|login/i);
});
