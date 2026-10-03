import { assert, assertEquals } from "@std/assert";
import { checkRepositoryStyles, checkStyles } from "./style-check/mod.ts";

Deno.test("shell/design-system#R40: fixture는 색·길이·시간·굵기·z-index·breakpoint·없는 token을 거절한다", async () => {
  const fixtures = new URL("./style-check/testdata/", import.meta.url);
  for await (const entry of Deno.readDir(fixtures)) {
    const issues = checkStyles(
      await Deno.readTextFile(new URL(entry.name, fixtures)),
      entry.name,
    );
    assert(issues.length > 0, entry.name);
    assertEquals(issues[0].file, entry.name);
    assertEquals(issues[0].line, entry.name === "breakpoint.css" ? 1 : 2);
    assert(issues.every((issue) => issue.reason.startsWith("invalid_input:")));
  }
});

Deno.test("shell/design-system#R40: var fallback·calc·색 함수·단위·숫자 안의 우회도 거절한다", () => {
  for (
    const declaration of [
      "color: var(--color-text-primary, #ffffff)",
      "padding: calc(var(--space-4) + 3px)",
      "color: hsl(0 0% 0%)",
      "color: oklch(0.5 0.1 30)",
      "border: 1px solid currentColor",
      "width: 1rem",
      "width: 2vw",
      "transition: all 0s",
      "font-weight: calc(var(--font-weight-medium) + 100)",
      "z-index: 0",
      "color: var(--local)",
    ]
  ) {
    assert(
      checkStyles(`.test { ${declaration}; }`, "test.css").length > 0,
      declaration,
    );
  }
  for (
    const params of [
      "(width >= 777px)",
      "(min-width: 64rem)",
      "(max-width: 639px)",
    ]
  ) {
    assert(checkStyles(`@media ${params} {}`, "test.css").length > 0, params);
  }
});

Deno.test("shell/design-system#R40: token·Radix·허용 keyword·0 길이·정한 breakpoint는 통과한다", () => {
  assertEquals(
    checkStyles(
      `
    .test {
      color: var(--color-text-primary);
      background: transparent;
      border-color: currentColor;
      padding: 0 0px;
      width: var(--radix-popover-trigger-width);
      font-weight: inherit;
      z-index: var(--z-dialog);
      transition: opacity var(--motion-duration-short);
      font-family: "Black";
    }
    @media (min-width: 640px) and (max-width: 1024px) {}
    @media (width >= 1280px) {}
  `,
      "test.css",
    ),
    [],
  );
});

Deno.test("shell/design-system#R36: raw 값은 정확한 token 정의 파일과 base font-face만 허용한다", () => {
  const tokenDefinition =
    ":root { --color-text-primary: #abcdef; --space-4: 8px; }";
  assertEquals(
    checkStyles(tokenDefinition, "packages/design/generated/tokens.css"),
    [],
  );
  assert(checkStyles(tokenDefinition, "other/tokens.css").length > 0);
  const font =
    '@font-face { font-family: "Test"; font-weight: 400 600; font-display: swap; src: url("font.woff2"); }';
  assertEquals(checkStyles(font, "packages/design/base.css"), []);
  assert(checkStyles(font, "other/base.css").length > 0);
  assert(
    checkStyles(
      "@font-face { color: #abcdef; margin: 4px; }",
      "packages/design/base.css",
    ).length > 0,
  );
  assert(
    checkStyles(".test { color: #abcdef; }", "packages/design/base.css")
      .length > 0,
  );
  assert(
    checkStyles(
      ":root { --x: var(--missing); }",
      "packages/design/generated/tokens.css",
    ).length > 0,
  );
  assert(checkStyles(".broken {", "broken.css").length > 0);
});

Deno.test("shell/design-system#R36: 저장소 renderer·design·SDK UI CSS에 token 밖 스타일이 없다", async () => {
  assertEquals(
    await checkRepositoryStyles(new URL("../../", import.meta.url)),
    [],
  );
});

Deno.test("shell/design-system#R40: SDK ui-*를 검사하고 fixture·없는 폴더는 지나간다", async () => {
  const directory = await Deno.makeTempDir();
  const root = new URL(`file://${directory}/`);
  try {
    await Deno.mkdir(new URL("packages/sdk/ui-control/", root), {
      recursive: true,
    });
    await Deno.mkdir(new URL("packages/design/style-check/testdata/", root), {
      recursive: true,
    });
    await Deno.mkdir(new URL("packages/sdk/other/", root), { recursive: true });
    await Deno.writeTextFile(
      new URL("packages/sdk/ui-control/button.css", root),
      ".test { color: #abcdef; }",
    );
    await Deno.writeTextFile(
      new URL("packages/design/style-check/testdata/ignored.css", root),
      ".test { padding: 3px; }",
    );
    await Deno.writeTextFile(
      new URL("packages/sdk/other/ignored.css", root),
      ".test { padding: 3px; }",
    );
    const issues = await checkRepositoryStyles(root);
    assertEquals(issues.length, 1);
    assertEquals(issues[0].file, "packages/sdk/ui-control/button.css");
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});
