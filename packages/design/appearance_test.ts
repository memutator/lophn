import { assert, assertEquals, assertFalse } from "@std/assert";

import {
  APPEARANCE_DEFAULTS,
  appearanceCss,
  isFontName,
  parseAppearance,
} from "./appearance.ts";

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

Deno.test("Custom 글꼴 이름의 위험한 글자는 CSS에 들어가지 않는다", () => {
  for (const name of DANGEROUS) {
    assertFalse(isFontName(name), JSON.stringify(name));
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
    assertEquals(parsed?.font_custom, "");
    assertEquals(parsed?.code_font_custom, "");
    // parse를 거치지 않고 바로 만들어도 이름은 CSS에 쓰이지 않는다.
    const css = appearanceCss({
      ...APPEARANCE_DEFAULTS,
      font: "custom",
      font_custom: name,
      code_font: "custom",
      code_font_custom: name,
    });
    assertEquals(css, "", JSON.stringify(name));
  }
  for (const name of ["Fira Sans", "나눔고딕", "JetBrains_Mono-2"]) {
    assert(isFontName(name), name);
    const css = appearanceCss({
      ...APPEARANCE_DEFAULTS,
      font: "custom",
      font_custom: name,
    });
    assert(css.includes(`--font-sans: "${name}", `), css);
  }
});

Deno.test("목록 밖 선택은 appearance 전체가 거절된다", () => {
  assertEquals(
    parseAppearance({ ...APPEARANCE_DEFAULTS, accent: "red" }),
    undefined,
  );
  assertEquals(
    parseAppearance({ ...APPEARANCE_DEFAULTS, density: "9" }),
    undefined,
  );
  assertEquals(parseAppearance(null), undefined);
  assertEquals(parseAppearance(APPEARANCE_DEFAULTS), APPEARANCE_DEFAULTS);
});
