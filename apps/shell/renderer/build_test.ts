import { assert, assertEquals } from "@std/assert";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { build } from "./build.ts";

const outputs = ["desktop", "overlay", "confirmation"];

Deno.test("shell/design-system#R15: renderer CSS가 design token을 묶고 woff2 두 개를 bundle 옆으로 복사한다", async () => {
  const dir = await mkdtemp(join(tmpdir(), "shell-renderer-fonts-"));
  try {
    await build(dir);
    for (const name of outputs) {
      const css = await readFile(join(dir, `${name}.css`), "utf8");
      assert(css.includes("--color-surface-base: #ffffff"));
      assert(css.includes("--color-surface-base: #161615"));
      assert(css.includes("--font-sans:"));
      assert(css.includes("PretendardVariable.woff2"));
      assert(css.includes("JetBrainsMonoVariable.woff2"));
      assert(!/https?:\/\//.test(css));
    }
    for (const font of ["PretendardVariable", "JetBrainsMonoVariable"]) {
      const actual = await readFile(join(dir, `${font}.woff2`));
      const source = await readFile(
        new URL(
          `../../../packages/design/fonts/${font}.woff2`,
          import.meta.url,
        ),
      );
      assertEquals(actual, source);
    }
  } finally {
    await rm(dir, { recursive: true });
  }
});

Deno.test("shell/desktop#R17: renderer build가 entry 세 개와 scope된 CSS Modules class를 만든다", async () => {
  const dir = await mkdtemp(join(tmpdir(), "shell-renderer-"));
  try {
    await build(dir);
    const html = await readFile(join(dir, "desktop", "index.html"), "utf8");
    assert(
      html.includes("./desktop.js"),
      "desktop index.html이 entry를 가리키지 않는다",
    );
    for (const name of outputs) {
      const js = await readFile(join(dir, `${name}.js`), "utf8");
      const css = await readFile(join(dir, `${name}.css`), "utf8");
      const scoped = css.match(/^\.([a-zA-Z0-9_-]*root[a-zA-Z0-9_-]*)/m)?.[1];
      assert(scoped, `${name}.css에 scope된 class가 없다`);
      assert(scoped !== "root", `${name}.css의 class가 원문 그대로다`);
      assert(
        js.includes(scoped),
        `${name}.js의 클래스 맵이 ${scoped}을 가리키지 않는다`,
      );
    }
  } finally {
    await rm(dir, { recursive: true });
  }
});

Deno.test("shell/design-system#R43: renderer build가 @lophn/design/components의 Radix·Lucide·wording을 React 한 벌로 묶는다", async () => {
  const dir = await mkdtemp(join(tmpdir(), "shell-renderer-components-"));
  try {
    await build(dir, [{
      in: join("testdata", "components-entry.tsx"),
      out: "components",
    }]);
    const js = await readFile(join(dir, "components.js"), "utf8");
    const css = await readFile(join(dir, "components.css"), "utf8");
    const react = js.match(
      /exports\.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE =/g,
    );
    assertEquals(react?.length, 1);
    assert(js.includes("Reload"), "wording catalog is not bundled");
    assert(js.includes("lucide-react"), "Lucide is not bundled");
    const scoped = css.match(/^\.(button_[A-Za-z]+)/m)?.[1];
    assert(scoped, "component CSS Modules class is missing");
    assert(js.includes(`"${scoped}"`), "component class map is missing");
    // 읽기 renderer의 Lezer Markdown parser와 공유 reading CSS Modules도 같은 bundle에 들어간다.
    assert(js.includes("ATXHeading1"), "Lezer Markdown is not bundled");
    const reading = css.match(/^\.(reading_markdown[A-Za-z0-9_]*)/m)?.[1];
    assert(reading, "reading CSS Modules class is missing");
    assert(js.includes(`"${reading}"`), "reading class map is missing");
  } finally {
    await rm(dir, { recursive: true });
  }
});
