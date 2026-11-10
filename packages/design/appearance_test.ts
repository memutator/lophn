import assert from "node:assert/strict";
import { test } from "node:test";

import {
  APPEARANCE_DEFAULTS,
  appearanceCss,
  isFontName,
  modeColors,
  parseAppearance,
} from "./appearance.ts";
import { BUILT_IN_THEMES, contrastProblems, loadThemes } from "./themes.ts";

// Custom 글꼴 이름은 모든 문서(앱 view 포함)에 넣는 CSS 안으로 들어간다. 그 문자열이 따옴표나 규칙을 열 수 없어야 한다.
const DANGEROUS = [
  '"; } body { display: none } /*',
  'a"b',
  "a\\b",
  "a;b",
  "a}b",
  "a{b",
  "a(b)",
  "a/**/b",
  "a\nb",
  "a</style><script>",
  "url(https://evil.example/x)",
  "a:b",
  "'a'",
  "x".repeat(65),
  "",
];

test("Custom 글꼴 이름의 위험한 글자는 CSS에 들어가지 않는다", () => {
  for (const name of DANGEROUS) {
    assert.ok(!isFontName(name), JSON.stringify(name));
    const chosen = {
      ...APPEARANCE_DEFAULTS,
      font: "custom",
      code_font: "custom",
    };
    const parsed = parseAppearance({
      ...chosen,
      font_custom: name,
      code_font_custom: name,
    });
    assert.deepStrictEqual(parsed?.font_custom, "");
    assert.deepStrictEqual(parsed?.code_font_custom, "");
    // parse를 거치지 않고 바로 만들어도 이름은 CSS에 쓰이지 않는다.
    const css = appearanceCss({
      ...APPEARANCE_DEFAULTS,
      font: "custom",
      font_custom: name,
      code_font: "custom",
      code_font_custom: name,
    });
    assert.deepStrictEqual(css, "", JSON.stringify(name));
  }
  for (const name of ["Fira Sans", "나눔고딕", "JetBrains_Mono-2"]) {
    assert.ok(isFontName(name), name);
    const css = appearanceCss({
      ...APPEARANCE_DEFAULTS,
      font: "custom",
      font_custom: name,
    });
    assert.ok(css.includes(`--font-sans: "${name}", `), css);
  }
});

test("목록 밖 선택은 appearance 전체가 거절된다", () => {
  assert.deepStrictEqual(
    parseAppearance({ ...APPEARANCE_DEFAULTS, accent: "red" }),
    undefined,
  );
  assert.deepStrictEqual(
    parseAppearance({ ...APPEARANCE_DEFAULTS, density: "9" }),
    undefined,
  );
  // accent와 theme id도 모든 문서의 CSS를 만드는 데 쓰인다.
  for (const accent of ["#fff; }", "red", "#12345", "url(x)"]) {
    assert.deepStrictEqual(
      parseAppearance({ ...APPEARANCE_DEFAULTS, accent }),
      undefined,
    );
  }
  assert.deepStrictEqual(
    parseAppearance({ ...APPEARANCE_DEFAULTS, dark_theme: "a/../b" }),
    undefined,
  );
  // 굵기도 모든 문서의 CSS에 그대로 들어간다.
  assert.deepStrictEqual(
    parseAppearance({ ...APPEARANCE_DEFAULTS, code_font_weight: "400; }" }),
    undefined,
  );
  assert.deepStrictEqual(parseAppearance(null), undefined);
  assert.deepStrictEqual(
    parseAppearance(APPEARANCE_DEFAULTS),
    APPEARANCE_DEFAULTS,
  );
});

// theme file은 사람·agent가 쓴 file이고 그 값이 앱 view를 포함한 모든 문서의 CSS가 된다. hex 말고는 들어가지 않는다.
test("theme file의 값은 hex 색만 CSS에 들어간다", () => {
  const { list } = loadThemes([
    {
      id: "evil",
      text: JSON.stringify({
        name: '"} body { display: none } /*',
        mode: "dark",
        colors: {
          "color.surface.base": "red; } body { display: none",
          "color.text.primary": "#fff;}",
          "color.link": "url(https://evil.example/x)",
          "--color-link": "#ffffff",
          "color.surface.muted": "#123456",
        },
      }),
    },
  ]);
  const css = appearanceCss(
    { ...APPEARANCE_DEFAULTS, dark_theme: "evil", accent: "#1d5bbf" },
    list,
  );
  assert.ok(css.includes("--color-surface-muted: #123456;"), css);
  for (const line of css.split("\n")) {
    const declaration = line.trim();
    if (!declaration.startsWith("--")) continue;
    assert.match(declaration, /^--[a-z0-9-]+: #[0-9a-fA-F]{3,8};$/, line);
  }
});

// accent를 아무 색이나 받는 대신 대비는 lophn이 지킨다고 약속했다. 내장 theme도 같은 기준을 지킨다.
test("내장 theme과 고른 accent로 만든 색은 대비 기준을 지킨다", () => {
  const seeds = [
    "#000000",
    "#ffffff",
    "#808080",
    "#ffff00",
    "#00ffff",
    "#ff0000",
    "#1d5bbf",
    "#e0af68",
  ];
  for (const theme of BUILT_IN_THEMES) {
    assert.deepStrictEqual(contrastProblems(theme.colors), [], theme.id);
    for (const accent of seeds) {
      const appearance = {
        ...APPEARANCE_DEFAULTS,
        [`${theme.mode}_theme`]: theme.id,
        accent,
      };
      const colors = modeColors(appearance, theme.mode);
      assert.deepStrictEqual(
        contrastProblems(colors),
        [],
        `${theme.id} ${accent}`,
      );
    }
  }
});
