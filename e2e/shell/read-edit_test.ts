// shell#T16: 문서 읽기와 편집 전환을 실제 Electron 배치로 잰다. contracts#T10 harness로
// 실제 shell을 임시 LOPHN_HOME으로 띄우고 개발 시드(?dev-seed) 작업대의 문서 탭을 쓴다.
// - shell/editor#R8: 읽기↔편집 전환 전후 첫 블록 위치 차이가 4px 이하다.
// - shell/design-system#R23: 문서 메뉴(overlay menu)로 읽기 폭을 바꾸면 다른 문서도 같은 폭이다.
//   개발 시드는 폭을 메모리에 두므로 재시작 뒤 반영은 제품 core settings로 save_test.ts가 본다.
// 화면이 없으면 건너뛴다.
import { assert, assertEquals } from "@std/assert";

import { e2eEnabled, READY_TIMEOUT_MS } from "../harness.ts";
import { launchShell, type RunningShell } from "../run.ts";

const repoRoot = new URL("../../", import.meta.url).pathname.replace(
  /\/$/,
  "",
);
const electronExecutable =
  `${repoRoot}/apps/shell/main/node_modules/electron/dist/electron`;
const shellApp = `${repoRoot}/apps/shell/main/dist/main.cjs`;

function freePort(): number {
  const listener = Deno.listen({ hostname: "127.0.0.1", port: 0 });
  const port = (listener.addr as Deno.NetAddr).port;
  listener.close();
  return port;
}

async function waitFor(
  evaluate: (expression: string) => Promise<unknown>,
  expression: string,
  expected: unknown,
): Promise<unknown> {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  let last: unknown;
  while (Date.now() < deadline) {
    last = await evaluate(expression);
    if (last === expected) return last;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`기대한 상태가 오지 않았다: ${JSON.stringify(last)}`);
}

/** 문서 본문 첫 블록의 화면 y. 읽기는 첫 요소, 편집은 첫 CodeMirror 줄이다. */
const FIRST_BLOCK = `(() => {
  const body = document.querySelector("[data-document-body]");
  const first = body?.querySelector(".cm-content .cm-line") ??
    body?.querySelector("h1, h2, h3, p, ul, ol, blockquote, pre");
  return first ? first.getBoundingClientRect().top : null;
})()`;

async function openSeed(shell: RunningShell): Promise<void> {
  await waitFor(
    shell.evaluate,
    `document.querySelector("[data-space]")?.getAttribute("data-space") ?? ""`,
    "launcher",
  );
  await shell.evaluate(
    `(() => { location.search = "?dev-seed"; return true; })()`,
  );
  await waitFor(
    shell.evaluate,
    `document.querySelector("[data-document-view]")?.getAttribute("data-document-view") ?? ""`,
    "read",
  );
}

Deno.test({
  name:
    "e2e shell/editor#R8 shell/design-system#R23: 읽기·편집 전환의 첫 블록 차이는 4px 이하이고 메뉴로 고른 폭이 다른 문서에도 같다",
  ignore: !e2eEnabled(),
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const home = await Deno.makeTempDir({ prefix: "lophn-e2e-read-edit-" });
    const shell = await launchShell({
      executable: electronExecutable,
      app: shellApp,
      home,
      port: freePort(),
    });
    try {
      await openSeed(shell);
      const read = await shell.evaluate(FIRST_BLOCK) as number;
      await shell.evaluate(
        `(() => { document.querySelector("[data-edit-toggle]").click(); return true; })()`,
      );
      await waitFor(
        shell.evaluate,
        `document.querySelector("[data-document-view]")?.getAttribute("data-document-view") ?? ""`,
        "edit",
      );
      const edit = await shell.evaluate(FIRST_BLOCK) as number;
      assert(
        Math.abs(edit - read) <= 4,
        `첫 블록 위치 차이 ${Math.abs(edit - read)}px`,
      );
      await shell.evaluate(
        `(() => { document.querySelector("[data-edit-toggle]").click(); return true; })()`,
      );
      await waitFor(
        shell.evaluate,
        `document.querySelector("[data-document-view]")?.getAttribute("data-document-view") ?? ""`,
        "read",
      );
      const back = await shell.evaluate(FIRST_BLOCK) as number;
      assert(Math.abs(back - read) <= 4, `되돌아온 차이 ${back - read}px`);

      // 문서 메뉴는 overlay view의 menu다. 넓은 폭을 고른다.
      await shell.evaluate(
        `(() => { document.querySelector("[data-document-menu]").click(); return true; })()`,
      );
      const overlay = await shell.connect("lophn-shell://overlay/index.html");
      await waitFor(
        overlay.evaluate,
        `[...document.querySelectorAll("[role=menuitem]")].some((item) => item.textContent === "Wide, 800px")`,
        true,
      );
      await overlay.evaluate(
        `(() => { [...document.querySelectorAll("[role=menuitem]")].find((item) => item.textContent === "Wide, 800px").click(); return true; })()`,
      );
      await waitFor(
        shell.evaluate,
        `document.querySelector("[data-document-view]")?.getAttribute("data-reading-width") ?? ""`,
        "wide",
      );
      // 다른 문서도 같은 전역 폭이다.
      await shell.evaluate(
        `(() => { document.querySelector('[data-document="doc_plan"]').click(); return true; })()`,
      );
      await waitFor(
        shell.evaluate,
        `document.querySelector("[data-document-title]")?.textContent ?? ""`,
        "Plan",
      );
      assertEquals(
        await shell.evaluate(
          `document.querySelector("[data-document-view]")?.getAttribute("data-reading-width")`,
        ),
        "wide",
      );
    } finally {
      await shell.close();
      await Deno.remove(home, { recursive: true });
    }
  },
});
