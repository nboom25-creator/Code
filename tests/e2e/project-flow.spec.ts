import { expect, test } from "@playwright/test";

/**
 * Critical user flow: open a project, start it, complete a step, refresh the
 * page, and confirm progress was saved. In demo mode progress persists to
 * localStorage, so it must survive a full reload.
 */
test("progress survives a page refresh", async ({ page }) => {
  // 1. Open a project.
  await page.goto("/projects/hang-a-framed-picture");
  await expect(
    page.getByRole("heading", { name: "Hang a Framed Picture", level: 1 }),
  ).toBeVisible();

  // 2. Start the project (button is enabled once the store hydrates).
  const startButton = page.getByRole("button", { name: /start project/i });
  await expect(startButton).toBeEnabled();
  await startButton.click();

  // We should land in the guided workspace.
  await expect(page).toHaveURL(/\/projects\/hang-a-framed-picture\/guide$/);
  await expect(page.getByText(/Step 1 of/i).first()).toBeVisible();

  // 3. Complete the first step via its completion checkbox.
  const completeCheckbox = page.getByRole("checkbox", {
    name: /mark step 1 complete/i,
  });
  await completeCheckbox.check();

  // Progress reflects one completed step (5 steps => 20%).
  await expect(page.getByText("20% complete")).toBeVisible();

  // Give the debounced localStorage write time to flush.
  await page.waitForTimeout(600);

  // 4. Refresh the page.
  await page.reload();

  // 5. Confirm progress remains saved.
  await expect(page.getByText("20% complete")).toBeVisible();

  // And the completed state is preserved in the store (dashboard shows it).
  await page.goto("/dashboard");
  await expect(
    page.getByRole("heading", { name: "In progress" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Hang a Framed Picture" }),
  ).toBeVisible();
});
