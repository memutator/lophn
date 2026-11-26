import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { APPEARANCE_DEFAULTS } from "../../../../design/appearance.ts";
import {
  parseStoredAppearance,
  readInitialAppearance,
  shellBackgroundColor,
} from "./initial-appearance.ts";

test("partial settings.json preserves saved light mode and falls back omitted fields to defaults", async () => {
  const root = await mkdtemp(join(tmpdir(), "lophn-appearance-"));
  try {
    await writeFile(
      join(root, "settings.json"),
      JSON.stringify({
        "shell.mode": "light",
        "shell.dark_theme": "neutral-dark",
        "shell.accent": "#1b7a3c",
        "shell.font": "custom",
        "shell.font_custom": "Pretendard",
      }),
    );
    const initial = readInitialAppearance(root);
    assert.equal(initial.appearance.mode, "light");
    assert.equal(
      initial.appearance.light_theme,
      APPEARANCE_DEFAULTS.light_theme,
    );
    assert.equal(initial.appearance.dark_theme, "neutral-dark");
    assert.equal(initial.appearance.accent, "#1b7a3c");
    assert.equal(initial.appearance.font, "custom");
    assert.equal(initial.appearance.font_custom, "Pretendard");
    assert.equal(
      initial.appearance.font_weight,
      APPEARANCE_DEFAULTS.font_weight,
    );
    // OS가 dark여도 저장된 light 모드의 바탕색을 돌려준다.
    assert.equal(
      shellBackgroundColor(initial.appearance, initial.themes, true),
      "#f3f2ef",
    );
    assert.ok(initial.css.includes("Pretendard"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("loads custom theme files from themes/ and ignores invalid fields safely", async () => {
  const root = await mkdtemp(join(tmpdir(), "lophn-appearance-"));
  try {
    await mkdir(join(root, "themes"), { recursive: true });
    await writeFile(
      join(root, "themes", "paper-light.json"),
      JSON.stringify({
        name: "Paper Light",
        mode: "light",
        colors: { "color.surface.shell": "#faf8f2" },
      }),
    );
    await writeFile(
      join(root, "settings.json"),
      JSON.stringify({
        "shell.mode": "light",
        "shell.light_theme": "paper-light",
        "shell.density": "invalid-density",
      }),
    );
    const initial = readInitialAppearance(root);
    assert.equal(initial.appearance.mode, "light");
    assert.equal(initial.appearance.light_theme, "paper-light");
    assert.equal(initial.appearance.density, APPEARANCE_DEFAULTS.density);
    assert.equal(
      shellBackgroundColor(initial.appearance, initial.themes, true),
      "#faf8f2",
    );
    assert.ok(initial.css.includes("#faf8f2"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("missing or malformed settings.json falls back cleanly to defaults", () => {
  assert.deepStrictEqual(parseStoredAppearance(undefined), APPEARANCE_DEFAULTS);
  assert.deepStrictEqual(
    parseStoredAppearance("not-an-object"),
    APPEARANCE_DEFAULTS,
  );
  assert.deepStrictEqual(parseStoredAppearance(["array"]), APPEARANCE_DEFAULTS);
});
