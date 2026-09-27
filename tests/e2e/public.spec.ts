import { expect, test } from "@playwright/test";

test("landing, catalog and assumptions pages render with honest disclaimers", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "Materials mined, refined and built in space",
  );
  await expect(page.getByRole("heading", { name: "Why make it in space?" })).toBeVisible();
  await expect(page.getByText("First-order planning model").first()).toBeVisible();

  await page.getByRole("link", { name: "Catalog" }).first().click();
  await expect(page.getByRole("heading", { name: "Catalog" })).toBeVisible();
  await expect(page.getByText("Oxygen (O₂)")).toBeVisible();
  await expect(page.getByText("Titanium truss segment, 2 m")).toBeVisible();

  await page.goto("/about");
  await expect(page.getByText("Not flight-grade analysis")).toBeVisible();
});

test("health and readiness endpoints answer", async ({ request }) => {
  expect((await request.get("/api/health")).status()).toBe(200);
  const ready = await request.get("/api/ready");
  expect(ready.status()).toBe(200);
  expect(await ready.json()).toMatchObject({ database: "ok" });
});
