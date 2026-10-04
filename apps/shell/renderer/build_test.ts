import { assert, assertEquals } from "@std/assert";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { Window } from "happy-dom";
import { installDom } from "@lophn/design/component-tests";
import type { OverlayEvent } from "../ipc/overlay.ts";

import { build, mergeImports } from "./build.ts";
import { createShellHandler } from "../main/desktop/shell-protocol.ts";

const outputs = ["desktop", "overlay", "confirmation"];

Deno.test("shell/app-frame#R24: default entry HTML script stylesheet and font URLs are actual shell protocol resources", async () => {
  const dir = await mkdtemp(join(tmpdir(), "shell-entry-assets-"));
  try {
    await build(dir);
    const handler = createShellHandler({ distDir: dir });
    for (const name of ["desktop", "overlay"]) {
      const base = `lophn-shell://${name}/index.html`;
      const html = await handler(new Request(base));
      assertEquals(html.status, 200);
      const text = new TextDecoder().decode(html.body!);
      for (const match of text.matchAll(/(?:src|href)="([^"]+)"/g)) {
        const resource = await handler(new Request(new URL(match[1], base)));
        assertEquals(resource.status, 200);
      }
      const css = await readFile(join(dir, name, `${name}.css`), "utf8");
      for (const match of css.matchAll(/url\(["']?([^\)"']+)["']?\)/g)) {
        const resource = await handler(
          new Request(new URL(match[1], `lophn-shell://${name}/${name}.css`)),
        );
        assertEquals(resource.status, 200);
      }
    }
    const overlay = await readFile(join(dir, "overlay", "overlay.js"), "utf8");
    assert(overlay.includes("overlayRegistry"));
    assert(!/require\("electron"\)/.test(overlay));
    const dom = new Window({ url: "http://localhost/" });
    dom.document.body.innerHTML = '<div id="root"></div>';
    const target = globalThis as unknown as Record<string, unknown>;
    let listener: (event: OverlayEvent) => void = () => {};
    let failure: (error: { code: "unavailable"; message: string }) => void =
      () => {};
    let subscriptions = 0;
    let releases = 0;
    const results: unknown[] = [];
    // entry는 Deno의 globalThis에 pagehide를 듣는다. DOM global을 올리기 전 Event를 잡아 둔다.
    const PageEvent = Event;
    // React와 Radix가 쓰는 DOM global을 이 probe 동안만 올린다.
    const restore = installDom(dom);
    target.IS_REACT_ACT_ENVIRONMENT = false;
    Object.defineProperty(target, "lophnShell", {
      configurable: true,
      value: {
        subscribe: (callback: typeof listener, onError: typeof failure) => {
          listener = callback;
          failure = onError;
          subscriptions++;
          return () => {
            releases++;
          };
        },
        result: (input: unknown) => {
          results.push(input);
          return Promise.resolve({ ok: true, value: null });
        },
      },
    });
    const rendered = async () => {
      for (let round = 0; round < 5; round++) {
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    };
    try {
      await import(pathToFileURL(join(dir, "overlay", "overlay.js")).href);
      listener({
        generation: 1,
        bounds: { x: 10, y: 48, width: 200, height: 100 },
        surfaces: [{
          requestId: "entry",
          surfaceId: "entry",
          generation: 1,
          kind: "menu",
          anchorRect: { x: 10, y: 48, width: 200, height: 100 },
          rect: { x: 0, y: 0, width: 200, height: 100 },
          model: {
            label: "Owner label",
            choices: [{ id: "yes", label: "Owner choice" }],
          },
        }],
      });
      await rendered();
      const root = dom.document.getElementById("root")!;
      assert(root.className !== "root" && root.className.length > 0);
      const host = root.querySelector("[data-kind=menu]")!;
      assertEquals(host.getAttribute("style")?.includes("--z-popover"), true);
      const menu = host.querySelector("[role=menu]")!;
      assertEquals(
        menu.querySelector("[role=menuitem]")?.textContent,
        "Owner choice",
      );
      assert(menu.contains(dom.document.activeElement));
      (menu.querySelector("[role=menuitem]") as unknown as { click(): void })
        .click();
      await rendered();
      assertEquals(results, [{
        surfaceId: "entry",
        generation: 1,
        type: "selected",
        choiceId: "yes",
      }]);
      const status = dom.document.querySelector("aside")!;
      assert(status.hidden);
      failure({ code: "unavailable", message: "Overlay is unavailable" });
      assert(!status.hidden);
      assertEquals(
        status.querySelector("p")?.textContent,
        "This action couldn't be completed. Try again.",
      );
      status.querySelector("button")!.click();
      assert(status.hidden);
      assertEquals(subscriptions, 2);
      assertEquals(releases, 1);
      globalThis.dispatchEvent(new PageEvent("pagehide"));
      await rendered();
      assertEquals(root.children.length, 0);
      assertEquals(releases, 2);
      assertEquals(dom.document.querySelector("aside"), null);
      assertEquals(results.length, 1);
    } finally {
      delete target.lophnShell;
      restore();
      await dom.happyDOM.close();
    }
  } finally {
    await rm(dir, { recursive: true });
  }
});

Deno.test("shell/design-system#R15: renderer CSS가 design token을 묶고 woff2 두 개를 bundle 옆으로 복사한다", async () => {
  const dir = await mkdtemp(join(tmpdir(), "shell-renderer-fonts-"));
  try {
    await build(dir);
    for (const name of outputs) {
      const css = await readFile(join(dir, name, `${name}.css`), "utf8");
      assert(css.includes("--color-surface-base: #ffffff"));
      assert(css.includes("--color-surface-base: #161615"));
      assert(css.includes("--font-sans:"));
      assert(css.includes("PretendardVariable.woff2"));
      assert(css.includes("JetBrainsMonoVariable.woff2"));
      assert(!/https?:\/\//.test(css));
    }
    for (const font of ["PretendardVariable", "JetBrainsMonoVariable"]) {
      const actual = await readFile(join(dir, "overlay", `${font}.woff2`));
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
      const js = await readFile(join(dir, name, `${name}.js`), "utf8");
      const css = await readFile(join(dir, name, `${name}.css`), "utf8");
      // overlay는 공통 컴포넌트 CSS도 묶으므로 root 이름의 class 가운데 entry가 쓰는 것을 찾는다.
      const scoped = [
        ...css.matchAll(/^\.([a-zA-Z0-9_-]*root[a-zA-Z0-9_-]*)/gm),
      ].map((match) => match[1]);
      assert(scoped.length > 0, `${name}.css에 scope된 class가 없다`);
      assert(!scoped.includes("root"), `${name}.css의 class가 원문 그대로다`);
      assert(
        scoped.some((item) => js.includes(item)),
        `${name}.js의 클래스 맵이 scope된 root class를 가리키지 않는다`,
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

Deno.test("apps/sdk#R4: 공개 table·여섯 chart 예제는 React 한 벌·정본 CSS·로컬 fonts로 실제 renderer에서 동작한다", async () => {
  const dir = await mkdtemp(join(tmpdir(), "shell-renderer-sdk-"));
  const dom = new Window({ url: "http://localhost/" });
  const restore = installDom(dom);
  (globalThis as unknown as Record<string, unknown>)
    .IS_REACT_ACT_ENVIRONMENT = false;
  let unmount = () => {};
  try {
    await build(dir, [{ in: join("testdata", "sdk-entry.tsx"), out: "sdk" }]);
    const js = await readFile(join(dir, "sdk.js"), "utf8");
    const css = await readFile(join(dir, "sdk.css"), "utf8");
    assertEquals(
      js.match(
        /exports\.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE =/g,
      )
        ?.length,
      1,
    );
    assert(css.includes("--chart-line: 2px"));
    assert(css.includes("--chart-series-0: #3987e5"));
    assert(css.includes("--color-surface-base: #161615"));
    assert(css.includes("PretendardVariable.woff2"));
    assert(css.includes("JetBrainsMonoVariable.woff2"));
    assert(!/https?:\/\//.test(css));
    for (const font of ["PretendardVariable", "JetBrainsMonoVariable"]) {
      assertEquals(
        await readFile(join(dir, `${font}.woff2`)),
        await readFile(
          new URL(
            `../../../packages/design/fonts/${font}.woff2`,
            import.meta.url,
          ),
        ),
      );
    }
    const sheet = dom.document.createElement("style");
    sheet.textContent = css;
    dom.document.head.append(sheet);
    const host = dom.document.createElement("div");
    dom.document.body.append(host);
    const entry = await import(pathToFileURL(join(dir, "sdk.js")).href);
    unmount = entry.mount(host as unknown as HTMLElement);
    for (let round = 0; round < 10; round++) {
      if (host.querySelectorAll("svg[data-chart]").length === 6) break;
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    assertEquals(
      [...host.querySelectorAll("svg[data-chart]")].map((svg) =>
        svg.getAttribute("data-chart")
      ).sort(),
      ["bar", "distribution", "graph", "line", "scatter", "stacked"],
    );
    assert(
      host.querySelector("table")?.textContent?.includes("Example customer"),
    );
    assert(!/NaN|Infinity/.test(host.innerHTML));
    const toggle = [...host.querySelectorAll("button")].find((button) =>
      button.textContent === "Show table"
    );
    assert(toggle);
    toggle.click();
    for (let round = 0; round < 5; round++) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    assertEquals(host.querySelectorAll("table").length, 2);
  } finally {
    unmount();
    restore();
    await dom.happyDOM.close();
    await rm(dir, { recursive: true });
  }
});

Deno.test("shell/app-frame#R24: import maps preserve each config relative base and reject conflicts", () => {
  const imports: Record<string, string> = {};
  mergeImports(
    imports,
    { root: "./root.ts", same: "npm:zod@4.6.5" },
    new URL("file:///project/deno.json"),
  );
  mergeImports(
    imports,
    { renderer: "./renderer.ts", same: "npm:zod@4.6.5" },
    new URL("file:///project/apps/shell/renderer/deno.json"),
  );
  mergeImports(
    imports,
    { package: "../shared.ts" },
    new URL("file:///project/packages/design/deno.json"),
  );
  assertEquals(imports.root, "file:///project/root.ts");
  assertEquals(
    imports.renderer,
    "file:///project/apps/shell/renderer/renderer.ts",
  );
  assertEquals(imports.package, "file:///project/packages/shared.ts");
  let threw = false;
  try {
    mergeImports(
      imports,
      { same: "npm:zod@other" },
      new URL("file:///project/other.json"),
    );
  } catch {
    threw = true;
  }
  assert(threw);
});
