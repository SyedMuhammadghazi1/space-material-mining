import { expect, test } from "@playwright/test";

test("a new customer signs up and requests a quote", async ({ page }) => {
  const email = `e2e-${Date.now()}@example.test`;
  await page.goto("/quote?item=O2");
  await expect(page.getByRole("heading", { name: "Request a quote" })).toBeVisible();
  await page.getByRole("link", { name: "Create a buyer account" }).click();

  await page.getByLabel("Full name").fill("E2E Buyer");
  await page.getByLabel("Company").fill("E2E Orbital Works (fictional)");
  await page.getByLabel("Work email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill("e2e-password-123");
  await page.getByLabel("Confirm password").fill("e2e-password-123");
  await page.getByRole("button", { name: "Create account" }).click();

  await expect(page).toHaveURL(/\/quote\?item=O2/);
  await expect(page.getByLabel("Product or material")).toHaveValue("O2");
  await page.getByLabel("Quantity (kg)").fill("750");
  await page.getByLabel("Delivery node").selectOption("LLO");
  await page.getByLabel("Notes (optional)").fill("Oxidiser for a lunar lander refuel.");
  await page.getByRole("button", { name: "Submit request for quote" }).click();

  await expect(page).toHaveURL(/\/portal\/quotes\/[0-9a-f-]{36}\?submitted=1$/);
  await expect(page.getByText("Request received")).toBeVisible();
  await expect(page.getByText("requested", { exact: true })).toBeVisible();

  await page.goto("/portal");
  await expect(page.getByRole("region", { name: "Quotes" }).getByText("Oxygen (O₂)")).toBeVisible();

  // Customers are kept out of the staff console.
  await page.goto("/ops");
  await expect(page).toHaveURL(/\/forbidden$/);
});
