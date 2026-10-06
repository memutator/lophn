// shell#T17: 실제 shell과 실제 core에서 문서를 고치고 저장 버튼 없이 디스크에 쓴다. contracts#T10
// harness로 shell을 임시 LOPHN_HOME과 임시 프로젝트 폴더로 띄운다. 창은 화면에 보이지 않게
// `LOPHN_SHELL_HEADLESS=1`로 띄운다(offscreen). `LOPHN_SHELL_SHOT_DIR`을 주면 저장 뒤와 충돌
// 해결 화면의 screenshot을 그 폴더에 남긴다.
// - shell/editor#R12: 고침은 입력이 멈추면 main 파일 adapter로 원자 교체되어 디스크에 있다.
// - shell/editor#R1: CommandOrControl+S는 편집 종료로 version 준비 경계를 연다.
// - shell/editor#R11, R2: 저장 상태가 머리 메타 줄에 보이고 단계별 사실은 상세에서 펼친다.
// - shell/editor#R15: 바깥에서 바뀐 파일은 충돌 notice로 남고 해결 화면에서 고른 글만 쓴다.
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
const PROJECT = "prj_01kq12a1pha000000000000e2e";

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
  throw new Error(
    `기대한 상태가 오지 않았다(${expression.slice(0, 80)}): ${
      JSON.stringify(last)
    }`,
  );
}

async function waitForFile(path: string, expected: string): Promise<void> {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  let last = "";
  while (Date.now() < deadline) {
    last = await Deno.readTextFile(path);
    if (last === expected) return;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`파일이 기대한 글이 아니다: ${JSON.stringify(last)}`);
}

// renderer가 쓰는 core 통로(main의 allowlist)로 프로젝트를 만들고 추적을 켠 뒤, 관측으로 생긴
// 문서를 그 프로젝트 자리에 둔다. 사람 화면 조작과 같은 route다.
const SETUP = (folder: string) =>
  `(async () => {
  const core = globalThis.lophnCore;
  const call = (kind, resource, method, body) => core.call({ kind, resource, method, body });
  for (let i = 0; i < 300; i += 1) {
    const ready = await call("read", "platform", "status", {});
    if (ready.ok) break;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  const folders = [{ path: ${JSON.stringify(folder)}, description: "plans" }];
  const created = await call("command", "projects", "create", {
    input: { id: "${PROJECT}", name: "plans", title: "Plans", purpose: "",
      folders, tracking: { enabled: false, patterns: [], use_gitignore: false } },
    idempotency_key: "e2e-save-create", compare: {}, prepared: [],
  });
  if (!created.ok) return "create " + JSON.stringify(created);
  const tracking = { enabled: true, patterns: [{ effect: "include", glob: "**/*.md" }], use_gitignore: false };
  const preview = await call("worker", "projects", "preview_tracking", {
    project: "${PROJECT}", base_revision: created.value.revision, folders, tracking,
  });
  if (!preview.ok) return "preview " + JSON.stringify(preview);
  const on = await call("command", "projects", "set_tracking", {
    input: { project: "${PROJECT}", folders, tracking, preview: preview.value },
    idempotency_key: "e2e-save-track", compare: { base_revision: created.value.revision }, prepared: [],
  });
  if (!on.ok) return "track " + JSON.stringify(on);
  let doc;
  for (let i = 0; i < 300 && !doc; i += 1) {
    const listed = await call("read", "documents", "list", {});
    if (listed.ok && listed.value.documents.length > 0) doc = listed.value.documents[0].document;
    else await new Promise((resolve) => setTimeout(resolve, 200));
  }
  if (!doc) return "no document";
  const moved = await call("command", "documents", "move", {
    input: { document: doc.id, place: { kind: "project", id: "${PROJECT}" }, name: "plan" },
    idempotency_key: "e2e-save-move", compare: { base_revision: doc.revision }, prepared: [],
  });
  if (!moved.ok) return "move " + JSON.stringify(moved);
  return "ok:" + doc.id;
})()`;

const SAVE_STATUS =
  `document.querySelector("[data-save-status]")?.getAttribute("data-save-status") ?? ""`;

async function shot(
  shell: RunningShell,
  dir: string | undefined,
  name: string,
): Promise<void> {
  if (!dir) return;
  // settled 그림은 paint가 1.5초 멈춘 뒤 쓰인다. 편집기 커서가 깜빡이면 멈추지 않으므로
  // focus를 잠시 빼고, 그 뒤에 새로 쓰인 그림을 이름 붙여 남긴다.
  const settled = `${dir}/window-1-settled.png`;
  const before = await Deno.stat(settled).then(
    (info) => info.mtime?.getTime() ?? 0,
    () => 0,
  );
  await shell.evaluate(
    `(() => { document.activeElement?.blur?.(); return true; })()`,
  );
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    const now = await Deno.stat(settled).then(
      (info) => info.mtime?.getTime() ?? 0,
      () => 0,
    );
    if (now > before) break;
  }
  await new Promise((resolve) => setTimeout(resolve, 2000));
  await Deno.copyFile(settled, `${dir}/${name}.png`);
}

async function typeInEditor(shell: RunningShell, text: string): Promise<void> {
  await shell.evaluate(
    `(() => { document.querySelector(".cm-content").focus(); return true; })()`,
  );
  // 사람 입력처럼 CDP로 글을 넣는다. CodeMirror가 DOM 입력으로 받는다.
  const page = await shell.connect("lophn-shell://desktop");
  await page.command("Input.insertText", { text });
}

Deno.test({
  name:
    "e2e shell/editor#R1 shell/editor#R2 shell/editor#R11 shell/editor#R12 shell/editor#R15: 고침은 저장 버튼 없이 디스크에 쓰이고, 저장 상태가 메타 줄에 보이며, 바깥 변경은 충돌로 멈춘다",
  ignore: !e2eEnabled(),
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const home = await Deno.makeTempDir({ prefix: "lophn-e2e-save-" });
    const folder = await Deno.realPath(
      await Deno.makeTempDir({ prefix: "lophn-e2e-save-folder-" }),
    );
    const file = `${folder}/plan.md`;
    await Deno.writeTextFile(file, "# Plan\n\nFirst line.\n");
    const shots = Deno.env.get("LOPHN_SHELL_SHOT_DIR");
    // 첫 실행: 런처에서 프로젝트를 만들고 추적을 켠다.
    const first = await launchShell({
      executable: electronExecutable,
      app: shellApp,
      home,
      port: freePort(),
      env: { LOPHN_SHELL_HEADLESS: "1" },
    });
    let documentId: string;
    try {
      await waitFor(
        first.evaluate,
        `document.querySelector("[data-space]")?.getAttribute("data-space") ?? ""`,
        "launcher",
      );
      const setup = await first.evaluate(SETUP(folder)) as string;
      assert(setup.startsWith("ok:"), setup);
      documentId = setup.slice(3);
    } finally {
      await first.close();
    }
    // 두 번째 실행: 그 프로젝트 작업대부터 연다(개발 확인 시작 자리).
    const shell = await launchShell({
      executable: electronExecutable,
      app: shellApp,
      home,
      port: freePort(),
      env: {
        LOPHN_SHELL_HEADLESS: "1",
        LOPHN_SHELL_START: `project:${PROJECT}`,
      },
    });
    try {
      await waitFor(
        shell.evaluate,
        `document.querySelector("[data-space]")?.getAttribute("data-space") ?? ""`,
        "project",
      );
      await waitFor(
        shell.evaluate,
        `!!document.querySelector('[data-document="${documentId}"]')`,
        true,
      );
      await shell.evaluate(
        `(() => { document.querySelector('[data-document="${documentId}"]').click(); return true; })()`,
      );
      await waitFor(
        shell.evaluate,
        `document.querySelector("[data-document-view]")?.getAttribute("data-document-view") ?? ""`,
        "read",
      );
      // 편집 단추는 문서 머리를 읽은 뒤 켜진다.
      await waitFor(
        shell.evaluate,
        `document.querySelector("[data-edit-toggle]")?.disabled === false`,
        true,
      );
      await shell.evaluate(
        `(() => { document.querySelector("[data-edit-toggle]").click(); return true; })()`,
      );
      await waitFor(
        shell.evaluate,
        `document.querySelector("[data-document-view]")?.getAttribute("data-document-view") ?? ""`,
        "edit",
      );

      // 저장 버튼 없이 입력이 멈추면 디스크에 쓴다.
      await shell.evaluate(
        `(() => { const line = [...document.querySelectorAll(".cm-line")].at(-1); const range = document.createRange(); range.selectNodeContents(line); range.collapse(false); const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range); document.querySelector(".cm-content").focus(); return true; })()`,
      );
      await typeInEditor(shell, "Second-edit.");
      await waitForFile(file, "# Plan\n\nFirst line.\nSecond-edit.");
      await waitFor(shell.evaluate, SAVE_STATUS, "saved");

      // CommandOrControl+S는 편집 종료다. version 준비를 보내고 메타 줄이 그 결과를 보인다.
      await shell.evaluate(
        `(() => { document.querySelector("[data-document-view]").dispatchEvent(new KeyboardEvent("keydown", { key: "s", ctrlKey: true, bubbles: true, cancelable: true })); return true; })()`,
      );
      const after = await waitForOne(shell, SAVE_STATUS, [
        "version-pending",
        "version-saved",
      ]);
      assert(after === "version-pending" || after === "version-saved");
      await shell.evaluate(
        `(() => { document.querySelector("[data-save-details-toggle]").click(); return true; })()`,
      );
      assertEquals(
        await shell.evaluate(
          `document.querySelector("[data-save-stage='file']")?.getAttribute("data-save-value")`,
        ),
        "saved",
      );
      // documents가 관측해 판을 만들면 그대로 보인다(shell timer 없음).
      await waitFor(shell.evaluate, SAVE_STATUS, "version-saved");
      await shot(shell, shots, "editor-saved");

      // 바깥에서 고치면 다음 쓰기는 충돌로 멈추고 notice가 남는다.
      await Deno.writeTextFile(file, "# Plan\n\nChanged outside.\n");
      await typeInEditor(shell, "Mine.");
      await waitFor(
        shell.evaluate,
        `document.querySelector("[data-notice]")?.getAttribute("data-notice") ?? ""`,
        "conflict",
      );
      assertEquals(
        await Deno.readTextFile(file),
        "# Plan\n\nChanged outside.\n",
      );
      await shell.evaluate(
        `(() => { document.querySelector("[data-notice-compare]").click(); return true; })()`,
      );
      await waitFor(
        shell.evaluate,
        `document.querySelector("[data-conflict-view]")?.getAttribute("data-conflict-view") ?? ""`,
        "disk",
      );
      await shot(shell, shots, "editor-conflict");
      await shell.evaluate(
        `(() => { document.querySelector("[data-conflict-mine]").click(); return true; })()`,
      );
      await waitForFile(file, "# Plan\n\nFirst line.\nSecond-edit.Mine.");
      await waitFor(
        shell.evaluate,
        `document.querySelector("[data-notice='conflict']") === null`,
        true,
      );
    } finally {
      await shell.close();
      await Deno.remove(home, { recursive: true });
      await Deno.remove(folder, { recursive: true });
    }
  },
});

async function waitForOne(
  shell: RunningShell,
  expression: string,
  expected: readonly unknown[],
): Promise<unknown> {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  let last: unknown;
  while (Date.now() < deadline) {
    last = await shell.evaluate(expression);
    if (expected.includes(last)) return last;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`기대한 상태가 오지 않았다: ${JSON.stringify(last)}`);
}
