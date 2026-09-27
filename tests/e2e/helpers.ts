import { type Page, expect } from "@playwright/test";

export const DEMO_PASSWORD = "orbital-demo-2026";

export async function signIn(page: Page, email: string, password = DEMO_PASSWORD) {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/(ops|portal)/);
}
