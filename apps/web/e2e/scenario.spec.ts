import { expect, test } from "@playwright/test";

const png = Buffer.from(
  "89504e470d0a1a0a0000000d4948445200000001000000010802000000907753de0000000c4944415408d763f8cfc0000000030001c7e4e3d30000000049454e44ae426082",
  "hex",
);

test("a classroom scenario asks for missing data and does not open a 3D solve", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") pageErrors.push(message.text());
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/scenario/new");
  await expect(page.getByText("AI not connected")).toBeVisible();
  await page.getByRole("button", { name: "Load Classroom Demo" }).click();
  await expect(page.getByText("classroom-v1").first()).toBeVisible();
  await expect(page.getByText("30 students").first()).toBeVisible();
  await expect(page.getByLabel("Span m")).toHaveValue("6");
  await expect(page.getByLabel("Tributary width m")).toHaveValue("2.5");
  await expect(page.getByLabel(/Dead load/)).toHaveValue("3");
  await expect(page.getByLabel(/Live load/)).toHaveValue("2");
  await expect(page.getByLabel("Beam self-weight N/m")).toHaveValue("0");
  await expect(page.getByLabel("Depth mm")).toHaveValue("200");
  await expect(page.getByLabel("Flange width mm")).toHaveValue("100");
  await expect(page.getByLabel("Flange thickness mm")).toHaveValue("10");
  await expect(page.getByLabel("Web thickness mm")).toHaveValue("6");
  await expect(page.getByLabel("Supports")).toHaveValue("simply supported");
  await expect(page.getByLabel("Jurisdiction")).toHaveValue("Colombia");
  await expect(page.getByText("NSR-10 Title B, Table B.4.2.1-1").first()).toBeVisible();
  await expect(page.getByText("12500.0 N/m").first()).toBeVisible();
  await expect(page.getByText("not a finite-element result").first()).toBeVisible();
  await expect(page.getByText("3D simulation is not available").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Run 3D simulation" })).toBeDisabled();
  await page.getByRole("button", { name: "Run Demo Analysis" }).click();
  await expect(page.getByRole("heading", { name: "Beam-element results" })).toBeVisible();
  await expect(page.getByText("not a certification").first()).toBeVisible();
  await expect(page.getByText("Euler-Bernoulli beam elements").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Run 3D simulation" })).toBeDisabled();
  await page.getByLabel("Span m").fill("5");
  await page.getByRole("button", { name: "Compare this edit" }).click();
  await expect(page.getByText("Edited, 5 m")).toBeVisible();
  await page.getByLabel("Evidence images").setInputFiles([
    { name: "plan.png", mimeType: "image/png", buffer: png },
    { name: "photo.png", mimeType: "image/png", buffer: png },
  ]);
  await expect(page.getByText("plan.png")).toBeVisible();
  await expect(page.getByText("photo.png")).toBeVisible();
  await page.getByRole("button", { name: "Remove" }).first().click();
  await expect(page.getByText("plan.png")).toHaveCount(0);
  await page.getByRole("heading", { name: "Beam-element results" }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: "../../docs/screenshots/scenario-model-1440x900.png" });
  await page.reload();
  await expect(page.getByText("12500.0 N/m").first()).toBeVisible();
  await expect(page.getByText("photo.png")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Beam-element results" })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("heading", { name: "Beam-element results" }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: "../../docs/screenshots/scenario-model-mobile.png" });
  await page.getByRole("link", { name: "Open Studio manually" }).click();
  await expect(page.getByRole("button", { name: "Load cantilever example" })).toBeVisible();
  expect(pageErrors).toEqual([]);
});

test("a failed send leaves the scenario and the typed span in place", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.route("**/api/v1/scenarios/*/turn", (route) => route.abort());
  await page.goto("/scenario/new");
  await expect(page.getByRole("heading", { name: "Scenario assistant" })).toBeVisible();
  await page.getByLabel("Span m").fill("6");
  await page.getByLabel("Describe the problem").fill("Review the span I typed.");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByText(/failed|network|abort|unavailable/i).first()).toBeVisible();
  await expect(page.getByLabel("Span m")).toHaveValue("6");
  await expect(page.getByRole("heading", { name: "Scenario assistant" })).toBeVisible();
  expect(pageErrors).toEqual([]);
});

test("an aluminum bracket opens in Studio and does not start CalculiX", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/scenario/new");
  await expect(page.getByText("AI not connected")).toBeVisible();
  await page.getByLabel("Describe the problem").fill(
    "Design an aluminum bracket. Force 200 N. Legs 80 mm by 80 mm. Thickness 8 mm. Bracket width 40 mm. Displacement limit 1 mm.",
  );
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByText("Choose the fixed face")).toBeVisible();
  await expect(page.getByRole("button", { name: "Approve and open Studio" })).toHaveCount(0);
  await page.getByLabel("Fixed face").selectOption("xmin");
  await page.getByLabel("Load face").selectOption("zmax");
  await page.getByRole("button", { name: "Confirm faces" }).click();
  await expect(page.getByRole("button", { name: "Approve and open Studio" })).toBeVisible();
  await expect(page.getByText("CalculiX solid FEM, not started")).toBeVisible();
  await expect(page.getByText("3D simulation is not available")).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("button", { name: "Approve and open Studio" })).toBeVisible();
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole("button", { name: "Approve and open Studio" }).click();
  await expect(page.getByLabel("Part")).toHaveValue("l_bracket");
  await expect(page.getByLabel("Material")).toHaveValue("aluminum_6061_t6");
  await expect(page.getByLabel("Support")).toHaveValue("xmin");
  await expect(page.getByLabel("Load face")).toHaveValue("zmax");
  await expect(page.getByRole("link", { name: "Back to scenario" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Run analysis" })).toBeVisible();
  expect(pageErrors).toEqual([]);
});

test("a bracket demo asks for the physical faces before Studio", async ({ page }) => {
  await page.goto("/scenario/new");
  await page.getByRole("button", { name: "Load Bracket Demo" }).click();
  await expect(page.getByLabel("Fixed face")).toHaveValue("xmin");
  await expect(page.getByLabel("Load face")).toHaveValue("zmax");
  await expect(page.getByRole("button", { name: "Approve and open Studio" })).toHaveCount(0);
  await page.getByRole("button", { name: "Confirm faces" }).click();
  await expect(page.getByRole("button", { name: "Approve and open Studio" })).toBeVisible();
  await expect(page.getByText("CalculiX solid FEM, not started")).toBeVisible();
});

test("a recording stays in the composer until the user sends it", async ({ page }) => {
  await page.addInitScript(() => {
    const rate = 24000;
    const samples = 480;
    const buffer = new ArrayBuffer(44 + samples * 2);
    const view = new DataView(buffer);
    const ascii = (offset: number, text: string) => {
      for (let index = 0; index < text.length; index += 1) view.setUint8(offset + index, text.charCodeAt(index));
    };
    ascii(0, "RIFF");
    view.setUint32(4, 36 + samples * 2, true);
    ascii(8, "WAVE");
    ascii(12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, rate, true);
    view.setUint32(28, rate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    ascii(36, "data");
    view.setUint32(40, samples * 2, true);
    class FakeRecorder {
      state = "inactive";
      mimeType = "audio/wav";
      ondataavailable: ((event: { data: Blob }) => void) | null = null;
      onstop: (() => void) | null = null;
      start() {
        this.state = "recording";
      }
      stop() {
        this.state = "inactive";
        this.ondataavailable?.({ data: new Blob([buffer], { type: "audio/wav" }) });
        this.onstop?.();
      }
    }
    Object.defineProperty(window, "MediaRecorder", { configurable: true, value: FakeRecorder });
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: async () => ({ getTracks: () => [{ stop() {} }] }) },
    });
    Object.defineProperty(window, "speechSynthesis", {
      configurable: true,
      value: {
        speaking: false,
        cancel() {},
        speak(utterance: { onend?: () => void }) {
          window.setTimeout(() => utterance.onend?.(), 400);
        },
        getVoices() {
          return [
            { lang: "en-US", name: "English" },
            { lang: "es-ES", name: "Spanish" },
          ];
        },
      },
    });
  });
  await page.route("**/api/v1/speech/transcribe", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ transcript: "What is the beam span?" }) }),
  );
  await page.goto("/scenario/new");
  await page.getByRole("button", { name: "Microphone" }).click();
  await page.getByRole("button", { name: /Stop/ }).click();
  await expect(page.getByLabel("Describe the problem")).toHaveValue("What is the beam span?");
  await page.getByRole("button", { name: "Load Classroom Demo" }).click();
  await page.getByRole("button", { name: "Play speech" }).click();
  await expect(page.getByText("Spoken text:").first()).toBeVisible();
});

test("landing screenshots", async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto("/");
  await page.screenshot({ path: "../../docs/screenshots/landing-1366x768.png", fullPage: true });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.screenshot({ path: "../../docs/screenshots/landing-1440x900.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: "../../docs/screenshots/landing-mobile.png", fullPage: true });
});
