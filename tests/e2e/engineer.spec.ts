import { expect, test } from "@playwright/test";
import { signIn } from "./helpers";

test("engineer creates a mission scenario and sees computed Δv, yield and cost", async ({
  page,
}) => {
  await signIn(page, "engineer@orbital-quarry.test");
  await expect(page.getByRole("heading", { name: "Mission control" })).toBeVisible();

  await page.getByRole("link", { name: "Mission scenarios" }).first().click();
  await page.getByRole("link", { name: "New scenario" }).click();
  await expect(page.getByRole("heading", { name: "New mission scenario" })).toBeVisible();

  await page.getByLabel("Scenario name").fill("E2E Tranquillitatis MRE to EML1");
  await page.getByLabel("Target").selectOption({ label: "Mare Tranquillitatis (high-Ti mare)" });
  await page.getByLabel("Extraction process").selectOption("mre");
  await page.getByLabel("Delivery node").selectOption("EML1");
  await page.getByLabel("Process power (kW)").fill("250");
  await page.getByRole("button", { name: /Compute/ }).click();

  await expect(page).toHaveURL(/\/ops\/scenarios\/[0-9a-f-]{36}$/);
  await expect(
    page.getByRole("heading", { name: "E2E Tranquillitatis MRE to EML1" }),
  ).toBeVisible();
  // Δv budget from the documented lunar values: LEO→surface 5.91 km/s, surface→EML1 2.51 km/s.
  await expect(page.getByText("5.91 km/s")).toBeVisible();
  await expect(page.getByText("2.51 km/s")).toBeVisible();
  // Yield table and unit economics are present.
  await expect(page.getByRole("heading", { name: "Yield by element" })).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Yields" }).getByText("O₂ gas (liquefied separately)"),
  ).toBeVisible();
  await expect(page.getByText(/Cost per kg delivered to Earth–Moon L1/)).toBeVisible();
  await expect(page.getByText(/of Earth-launched/)).toBeVisible();
  await expect(page.getByText(/Planning model v\d+\.\d+\.\d+/)).toBeVisible();

  // The new snapshot appears in the list.
  await page.goto("/ops/scenarios");
  await expect(page.getByRole("link", { name: "E2E Tranquillitatis MRE to EML1" })).toBeVisible();
});
