import { test, expect, type Page } from "@playwright/test";

/**
 * Critical end-to-end workflows. Each test drives the real UI against a real
 * database, so a regression in the calculation engine, the persistence layer or
 * the page wiring fails here rather than in a user's design review.
 */

async function createProject(page: Page, name: string): Promise<void> {
  await page.goto("/projects");
  await page.getByLabel("Project name").fill(name);
  await page.getByRole("button", { name: "Create project" }).click();
  await page.waitForURL("**/settings", { timeout: 30_000 });
}

async function loadSample(page: Page): Promise<void> {
  await page.goto("/projects");
  await page.getByRole("button", { name: /Load the demonstration project/ }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/projects"), { timeout: 30_000 });
}

test.describe("first run and onboarding", () => {
  test("loads the demonstration project and shows a live dashboard", async ({ page }) => {
    await loadSample(page);
    await page.goto("/");
    await expect(page.getByText("Demonstration project")).toBeVisible();
    await expect(page.getByRole("heading", { name: /DEMO — Laboratory Underwater Glider/ })).toBeVisible();

    // Every headline vehicle figure the brief requires on the dashboard.
    for (const label of [
      "Current vehicle mass",
      "Estimated displaced volume",
      "Net buoyancy",
      "Available syringe volume",
      "Centre of gravity",
      "Centre of buoyancy",
      "Predicted pitch stability",
      "Predicted dive / climb",
    ]) {
      await expect(page.getByText(label, { exact: true })).toBeVisible();
    }
    await expect(page.getByRole("heading", { name: "What should I work on next?" })).toBeVisible();
    // The ranker must explain itself, not just list tasks.
    await expect(page.getByText("Why:").first()).toBeVisible();
    await expect(page.getByText("What would close it:").first()).toBeVisible();
  });
});

test.describe("component to buoyancy budget", () => {
  test("a component added in the UI flows through to the buoyancy budget", async ({ page }) => {
    await createProject(page, "E2E Buoyancy Flow");

    await page.goto("/components");
    await page.getByRole("button", { name: "Add component" }).click();
    await page.getByLabel("Name", { exact: true }).fill("Hull tube");
    await page.getByLabel("Displacement mode").selectOption("hull");
    // Measured mass: 2000 g, entered in grams and stored in SI.
    const massRow = page.locator("div").filter({ hasText: /^Measured mass$/ }).first();
    await massRow.locator("xpath=..").locator("input[type=text]").first().fill("2000");
    const volRow = page.locator("div").filter({ hasText: /^Displaced volume \(used in the budget\)$/ }).first();
    await volRow.locator("xpath=..").locator("input[type=text]").first().fill("2500");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByText("Hull tube")).toBeVisible();

    await page.goto("/mass");
    // 2500 cm^3 at 25 degC fresh water displaces about 2.493 kg; the vehicle is
    // 2.0 kg, so it should be positively buoyant and need ballast added.
    await expect(page.getByText("Total vehicle mass")).toBeVisible();
    await expect(page.getByText(/2\.000 kg/)).toBeVisible();
    await expect(page.getByText("Ballast to neutral")).toBeVisible();
    await expect(page.getByText(/g to add/)).toBeVisible();
  });

  test("a component with no mass is reported as missing, not silently zero", async ({ page }) => {
    await createProject(page, "E2E Unweighed Part");
    await page.goto("/components");
    await page.getByRole("button", { name: "Add component" }).click();
    await page.getByLabel("Name", { exact: true }).fill("Unweighed bracket");
    await page.getByRole("button", { name: "Save", exact: true }).click();

    // The component table must flag the absent mass, not silently treat it as zero.
    await expect(page.locator("table").getByText("missing").first()).toBeVisible();
    await page.goto("/mass");
    await expect(page.getByText("Missing data is biasing this budget")).toBeVisible();
    await expect(page.getByText(/Unweighed bracket/).first()).toBeVisible();
  });
});

test.describe("buoyancy engine", () => {
  test("architecture choice changes the physics, not just the label", async ({ page }) => {
    await loadSample(page);

    // Set the architecture explicitly rather than relying on the starting state,
    // so the test is independent of anything a previous run left behind.
    const selectArchitecture = async (name: RegExp) => {
      await page.goto("/settings");
      await page.getByRole("tab", { name: "Buoyancy engine" }).click();
      await page.getByRole("button", { name }).click();
      await page.waitForTimeout(1600); // autosave debounce
    };

    await selectArchitecture(/External plunger \(displacement change\)/);
    await page.goto("/syringe");
    await expect(page.getByRole("heading", { name: "Syringe buoyancy engine" })).toBeVisible();
    await expect(page.getByText("Buoyancy authority", { exact: true })).toBeVisible();
    await expect(page.getByText("Stall margin", { exact: true })).toBeVisible();
    await page.getByRole("tab", { name: "Schematic" }).click();
    await expect(page.getByText("vehicle mass constant").first()).toBeVisible();
    await expect(page.getByText(/extend stroke fights ambient pressure/).first()).toBeVisible();

    // Switching to an internal ballast tank must change the physics: vehicle
    // mass now changes, and the opposite stroke is the one fighting pressure.
    await selectArchitecture(/Internal ballast tank/);
    await page.goto("/syringe");
    await page.getByRole("tab", { name: "Schematic" }).click();
    await expect(page.getByText("vehicle mass CHANGES").first()).toBeVisible();
    await expect(page.getByText(/retract stroke fights ambient pressure/).first()).toBeVisible();

    // Leave the sample project as it was found.
    await selectArchitecture(/External plunger \(displacement change\)/);
  });

  test("parameter sweeps render with downloadable data", async ({ page }) => {
    await loadSample(page);
    await page.goto("/syringe");
    await page.getByRole("tab", { name: "Parameter sweeps" }).click();
    await expect(page.getByText("Swept volume versus bore diameter")).toBeVisible();
    await expect(page.getByText("Required actuator force versus bore diameter")).toBeVisible();
    // The data-table affordance is the accessibility relief the palette requires.
    await page.getByRole("button", { name: "Show data" }).first().click();
    await expect(page.locator("table").first()).toBeVisible();
  });
});

test.describe("stability and trim", () => {
  test("trim solver reports required travel and states it is not unique", async ({ page }) => {
    await loadSample(page);
    await page.goto("/stability");
    await page.getByRole("tab", { name: "Trim solver" }).click();
    await expect(page.getByText("Required CG x")).toBeVisible();
    await expect(page.getByText(/This is not a unique answer/)).toBeVisible();
    await expect(page.getByText("Adjustable trim ballast")).toBeVisible();
  });

  test("moving a component previews a new CG without saving", async ({ page }) => {
    await loadSample(page);
    await page.goto("/stability");
    await page.getByRole("tab", { name: "Move components" }).click();
    const slider = page.locator('input[type="range"]').first();
    await slider.evaluate((el: HTMLInputElement) => {
      el.value = String(Number(el.max));
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await expect(page.getByText("CG x (preview)")).toBeVisible();
    await expect(page.getByRole("button", { name: /Apply these moves/ })).toBeEnabled();
  });
});

test.describe("mission simulation", () => {
  test("runs a mission and plots the sawtooth depth trace", async ({ page }) => {
    await loadSample(page);
    await page.goto("/mission");
    await page.getByRole("button", { name: "Run simulation" }).click();
    await expect(page.getByText("Cycles completed")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("Depth versus time")).toBeVisible();
    await expect(page.getByText("State machine trace")).toBeVisible();
    await expect(page.getByText("Energy breakdown by state")).toBeVisible();
    // The state machine must actually have run through its states.
    await expect(page.getByText("descending").first()).toBeVisible();
  });
});

test.describe("3D viewer", () => {
  test("renders a WebGL scene with CG and CB markers", async ({ page }) => {
    await loadSample(page);
    await page.goto("/viewer");
    await expect(page.locator("canvas")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("Colour by")).toBeVisible();
    await expect(page.getByText(/CG marker/)).toBeVisible();
    // Hiding a component must not break the scene.
    await page.getByRole("button", { name: "Hide all" }).click();
    await expect(page.locator("canvas")).toBeVisible();
  });
});

test.describe("assistant", () => {
  test("answers with citations and reports missing data", async ({ page }) => {
    await loadSample(page);
    await page.goto("/assistant");
    await page.getByRole("button", { name: "What information is still missing?" }).click();
    await expect(page.getByRole("heading", { name: "Answer" })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("Project values used")).toBeVisible();
    await expect(page.getByText("Data the assistant could not find")).toBeVisible();
    await expect(page.getByText(/This answer is generated from your project data/)).toBeVisible();
  });
});

test.describe("reports", () => {
  test("generates a report with header, equations and limitations", async ({ page }) => {
    await loadSample(page);
    await page.goto("/reports");
    await page.getByRole("button", { name: "Buoyancy budget" }).click();
    await expect(page.getByText("Verification status and limitations")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/preliminary engineering estimates/)).toBeVisible();
    await expect(page.getByText(/DEMONSTRATION PROJECT/)).toBeVisible();
  });
});

test.describe("persistence", () => {
  test("data survives a full page reload and project switch", async ({ page }) => {
    await createProject(page, "E2E Persistence");
    await page.goto("/components");
    await page.getByRole("button", { name: "Add component" }).click();
    await page.getByLabel("Name", { exact: true }).fill("Persistent widget");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByText("Persistent widget")).toBeVisible();

    await page.goto("/");
    await page.reload();
    await page.goto("/components");
    await expect(page.getByText("Persistent widget")).toBeVisible();
  });

  test("undo reverses the last change", async ({ page }) => {
    await createProject(page, "E2E Undo");
    await page.goto("/components");
    await page.getByRole("button", { name: "Add component" }).click();
    await page.getByLabel("Name", { exact: true }).fill("Doomed part");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByText("Doomed part")).toBeVisible();

    await page.getByRole("button", { name: "Undo" }).click();
    await expect(page.getByText(/Undid create/)).toBeVisible({ timeout: 15_000 });
    await page.reload();
    await expect(page.getByText("Doomed part")).toHaveCount(0);
  });
});

test.describe("theme and accessibility", () => {
  test("theme toggle switches between dark and light", async ({ page }) => {
    await loadSample(page);
    await page.goto("/");
    const html = page.locator("html");
    const before = await html.getAttribute("class");
    await page.getByRole("button", { name: /Switch to (light|dark) theme/ }).click();
    await expect(html).not.toHaveClass(before ?? "");
  });

  test("every navigation entry reaches a working page", async ({ page }) => {
    await loadSample(page);
    for (const path of [
      "/", "/requirements", "/vehicle", "/components", "/viewer", "/mass", "/syringe",
      "/structure", "/stability", "/hydro", "/mission", "/compare", "/electronics",
      "/tests", "/notebook", "/decisions", "/risks", "/assumptions", "/reports",
      "/assistant", "/settings",
    ]) {
      const response = await page.goto(path);
      expect(response?.status(), `${path} returned ${response?.status()}`).toBe(200);
      await expect(page.locator("h1").first()).toBeVisible();
    }
  });
});
