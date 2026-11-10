import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createSettingsRegistry } from "./registry.ts";
import { shellSettingFolders, shellSettings } from "./shell-settings.ts";
import { createSettingsStore } from "./store.ts";

test("shell 설정은 뜻이 틀린 값을 거절한다: 없는 theme, 모드가 다른 theme, 쓸 수 없는 theme, 모르는 단축키, CSS로 새는 글꼴 이름", async () => {
  const root = await mkdtemp(join(tmpdir(), "lophn-shell-settings-"));
  const store = createSettingsStore({
    root,
    registry: createSettingsRegistry(shellSettings, shellSettingFolders),
    publish: () => {},
    log: () => {},
  });
  const set = (key: string, value: unknown) => {
    const result = store.update([{ key, action: "set", value }]);
    assert.ok(result.ok);
    return result.value;
  };
  try {
    // 버린 색과 모자란 대비는 쓰되 알린다.
    const made = set("shell.themes.mine", {
      mode: "dark",
      colors: {
        "color.surface.base": "#101010",
        "color.text.primary": "#111111",
        "color.nope": "#ffffff",
        "color.link": "blue",
      },
    });
    assert.deepStrictEqual(made.changed, ["shell.themes.mine"]);
    const notes = made.notes.map((one) => one.message).join("\n");
    assert.match(notes, /colors\.color\.nope is not a color token/);
    assert.match(notes, /colors\.color\.link is not a hex color/);
    assert.match(notes, /low contrast: color\.text\.primary/);

    assert.deepStrictEqual(set("shell.dark_theme", "mine").changed, [
      "shell.dark_theme",
    ]);
    assert.deepStrictEqual(set("shell.dark_theme", "tokyo-night").rejected, []);

    const refused: [string, unknown, RegExp][] = [
      ["shell.light_theme", "mine", /no light theme has the id mine/],
      ["shell.dark_theme", "nope", /no dark theme has the id nope/],
      ["shell.themes.bare", { colors: {} }, /give `mode`/],
      ["shell.themes.child", { extends: "nope" }, /does not exist/],
      ["shell.themes.tokyo-night", { mode: "dark" }, /built-in theme/],
      ["shell.themes.odd", { mode: "sepia" }, /shape is wrong/],
      [
        "shell.keybindings",
        { other: { "tab.nope": ["Ctrl+KeyT"] } },
        /other\.tab\.nope: there is no binding/,
      ],
      [
        "shell.keybindings",
        { mac: { "tab.close": ["Cmd+W"] } },
        /`Cmd\+W` is not a chord/,
      ],
      ["shell.font_custom", 'Inter"; } body { display: none', /font family/],
    ];
    for (const [key, value, message] of refused) {
      const result = set(key, value);
      assert.deepStrictEqual(result.changed, [], key);
      assert.deepStrictEqual(result.rejected[0]?.reason, "invalid_value", key);
      assert.match(result.rejected[0]?.message ?? "", message);
    }

    assert.deepStrictEqual(
      set("shell.keybindings", {
        other: { "tab.close": ["Ctrl+KeyQ", "Ctrl+KeyK Ctrl+KeyW"] },
      }).rejected,
      [],
    );
    assert.deepStrictEqual(
      set("shell.font_custom", "나눔고딕 Coding").rejected,
      [],
    );
  } finally {
    store.close();
    await rm(root, { recursive: true });
  }
});
