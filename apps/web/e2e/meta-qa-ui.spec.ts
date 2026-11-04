/**
 * Unpaid Meta QA UI regressions — fixture HTML only (no API, no Meta, no Modal).
 * Mirrors Scenario.tsx assistant article markup: role label is exact "Drafty".
 */
import { expect, test } from "@playwright/test";
import { assistantMessageArticle, isAssistantRoleLabel } from "./qa/meta-verify";

const ASSISTANT_FIXTURE = `<!doctype html>
<html lang="en">
  <body>
    <main>
      <div id="thread">
        <article class="user">
          <p class="role">You</p>
          <p>I need an I-beam for a classroom floor for 30 students in Colombia.</p>
        </article>
        <article class="assistant">
          <p class="role">Drafty</p>
          <p>Still needed: span, tributary width, dead load, supports. A headcount is not a floor load.</p>
        </article>
      </div>
      <label>Span m <input aria-label="Span m" value="" /></label>
    </main>
  </body>
</html>`;

test.describe("Meta QA UI fixtures", () => {
  test("finds the assistant article labeled Drafty without a colon", async ({ page }) => {
    expect(isAssistantRoleLabel("Drafty")).toBe(true);
    expect(isAssistantRoleLabel("Drafty:")).toBe(false);

    await page.setContent(ASSISTANT_FIXTURE);
    const article = assistantMessageArticle(page);
    await expect(article).toBeVisible();
    await expect(article.getByText("Drafty", { exact: true })).toBeVisible();
    await expect(article.getByText(/Still needed: span/i)).toBeVisible();

    // Presentation-only punctuation must not be required.
    await expect(page.getByText("Drafty:", { exact: true })).toHaveCount(0);
    await expect(page.getByLabel("Span m")).toHaveValue("");
  });

  test("does not confuse the You article with the Drafty assistant article", async ({ page }) => {
    await page.setContent(ASSISTANT_FIXTURE);
    const article = assistantMessageArticle(page);
    await expect(article).toHaveCount(1);
    await expect(article).not.toContainText("I need an I-beam");
    await expect(article).toContainText("Still needed");
  });
});
