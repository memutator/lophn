import assert from "node:assert/strict";
import { test } from "node:test";
import { formatMath } from "./math.ts";

test("formatMath renders Greek letters, operators, fractions, roots and scripts into readable Unicode", () => {
  assert.equal(formatMath("x^2 + y_1 = z"), "x² + y₁ = z");
  assert.equal(
    formatMath(String.raw`\frac{-b \pm \sqrt{b^2 - 4ac}}{2a}`),
    "(-b ± √(b² - 4ac))/(2a)",
  );
  assert.equal(
    formatMath(String.raw`\alpha \to \beta \quad \forall x \in \mathbb{R}`),
    "α → β ∀ x ∈ ℝ",
  );
  assert.equal(
    formatMath(String.raw`\sum_{i=1}^{n} x_i \le \infty`),
    "∑ᵢ₌₁ⁿ xᵢ ≤ ∞",
  );
  assert.equal(formatMath(String.raw`\text{cost} = \frac{a}{b}`), "cost = a/b");
});
