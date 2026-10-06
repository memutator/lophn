// shell#T14: project-workspace 틀이 실제 창에서 치수를 지킨다.
// 개발 시드(LOPHN_DEV_SEED)로 프로젝트 공간을 열고 sidebar·상단 바·탭 줄·두 칸을
// 측정한다. 시드는 core를 부르지 않으므로 제품 데이터와 무관하다.
// 화면이 없으면(DISPLAY 없음) 건너뛴다.
import { assert, assertEquals } from "@std/assert";

import { e2eEnabled, READY_TIMEOUT_MS } from "../harness.ts";
import { launchShell, type RunningShell } from "../run.ts";
import {
  documentTitled,
  mustCall,
  openFlowShell,
  PROJECT,
  registerTrackedProject,
  removeHome,
  untilDocuments,
} from "../flow-support.ts";

const repoRoot = new URL("../../", import.meta.url).pathname.replace(/\/$/, "");
const electronExecutable =
  `${repoRoot}/apps/shell/main/node_modules/electron/dist/electron`;
const shellApp = `${repoRoot}/apps/shell/main/dist/main.cjs`;

async function runBuild(args: string[], failure: string): Promise<void> {
  const build = new Deno.Command(args[0], {
    args: args.slice(1),
    stdout: "inherit",
    stderr: "inherit",
  });
  assertEquals((await build.output()).code, 0, failure);
}

function freePort(): number {
  const listener = Deno.listen({ hostname: "127.0.0.1", port: 0 });
  const port = (listener.addr as Deno.NetAddr).port;
  listener.close();
  return port;
}

async function waitFor(
  shell: RunningShell,
  expression: string,
  expected: unknown,
): Promise<void> {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  let last: unknown;
  while (Date.now() < deadline) {
    last = await shell.evaluate(expression);
    if (last === expected) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`기대한 화면 상태가 오지 않았다: ${JSON.stringify(last)}`);
}

Deno.test({
  name:
    "shell/workspace#R1: 프로젝트 작업대는 sidebar·상단 바·탭 줄·두 칸을 정한 치수로 그린다",
  ignore: !e2eEnabled(),
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await runBuild(
      ["npm", "--prefix", `${repoRoot}/apps/shell/main`, "run", "build"],
      "shell main build 실패",
    );
    await runBuild(
      [
        "deno",
        "run",
        "--allow-all",
        `${repoRoot}/apps/shell/renderer/build.ts`,
      ],
      "shell renderer build 실패",
    );

    const home = await Deno.makeTempDir({ prefix: "lophn-e2e-" });
    const shell = await launchShell({
      executable: electronExecutable,
      app: shellApp,
      home,
      port: freePort(),
      env: { LOPHN_DEV_SEED: "1" },
    });
    try {
      await waitFor(
        shell,
        "document.querySelector('[data-space]')?.getAttribute('data-space')",
        "project",
      );
      const measured = await shell.evaluate(`(() => {
        const q = (sel) => document.querySelector(sel);
        const cs = (el) => el ? getComputedStyle(el) : null;
        const sidebar = q('[data-sidebar]');
        const body = q('[data-pane-body]');
        return JSON.stringify({
          sidebar: sidebar && { mode: sidebar.getAttribute('data-sidebar'), width: cs(sidebar).width },
          bar: cs(q('header'))?.height,
          strip: cs(q('[data-tab-strip]'))?.height,
          row: cs(q('[data-document]'))?.height,
          padLeft: cs(body)?.paddingLeft,
          padTop: cs(body)?.paddingTop,
          panes: q('[data-panes]')?.getAttribute('data-panes'),
          launcherInHeader: !!document.querySelector('header [data-launcher-back]'),
          iconControls: [...document.querySelectorAll('[data-sidebar-toggle], [data-launcher-back], [data-close], [data-info-toggle]')]
            .map((el) => ({ text: el.textContent, stroke: el.querySelector('svg')?.getAttribute('stroke-width') ?? null })),
          pageScrollX: document.documentElement.scrollWidth > innerWidth + 1,
          width: innerWidth,
        });
      })()`) as string;
      const frame = JSON.parse(measured) as {
        sidebar: { mode: string; width: string };
        bar: string;
        strip: string;
        row: string;
        padLeft: string;
        padTop: string;
        panes: string;
        launcherInHeader: boolean;
        iconControls: { text: string; stroke: string | null }[];
        pageScrollX: boolean;
        width: number;
      };
      // 기본 창 960px. sidebar는 접히고 런처 복귀는 상단 바에 있다(desktop#R26).
      assert(frame.width < 1024, `창이 1024px 이상이다: ${frame.width}`);
      assertEquals(frame.sidebar.mode, "collapsed");
      assertEquals(frame.sidebar.width, "56px");
      assertEquals(frame.launcherInHeader, true);
      // 아이콘 조작은 글자 없이 Lucide 선 1.5 아이콘만 그린다(design-system#R43).
      assert(frame.iconControls.length >= 4, "아이콘 조작이 모자란다");
      for (const control of frame.iconControls) {
        assertEquals(control, { text: "", stroke: "1.5" });
      }
      assertEquals(frame.bar, "48px");
      assertEquals(frame.strip, "36px");
      assertEquals(frame.row, "32px");
      // 1024px 미만 본문 여백은 16px, 위는 24px(desktop#R22).
      assertEquals(frame.padLeft, "16px");
      assertEquals(frame.padTop, "24px");
      // 두 칸 최소 폭이 부족하면 한 칸 보기다(workspace#R4).
      assertEquals(frame.panes, "1");
      assertEquals(frame.pageScrollX, false);
    } finally {
      await shell.close();
      await Deno.remove(home, { recursive: true });
    }
  },
});

// documents#T21: project-workspace 2(문서 읽기·고치기)와 edit-document 1·2·5·6·7·8·충돌 갈래.
// 프로젝트 등록·추적은 launcher 화면 몫이 아니라 같은 사람 command를 core 통로로 낸다
// (first-project가 화면 조작을 따로 본다). 그 project의 작업대를 실제 core 위에서 연다.
async function pressSave(flow: { evaluate(e: string): Promise<unknown> }) {
  await flow.evaluate(
    `(() => { document.querySelector("[data-document-view]").dispatchEvent(new KeyboardEvent("keydown", { key: "s", ctrlKey: true, bubbles: true, cancelable: true })); return true; })()`,
  );
}

Deno.test({
  name:
    "shell/editor#R1 shell/editor#R2 shell/editor#R12 documents/versions#R2 documents/versions#R8 documents/file-tracking#R12 flow project-workspace 2: project 작업대에서 문서를 열어 고치면 저장과 판 확정이 따로 실제 core에서 일어난다",
  ignore: !e2eEnabled(),
  sanitizeOps: false,
  sanitizeResources: false,
  async fn(t) {
    const folder = await Deno.realPath(
      await Deno.makeTempDir({ prefix: "lophn-e2e-ws-" }),
    );
    const file = `${folder}/notes.md`;
    const first = "# Notes\n\nFirst line.\n";
    await Deno.writeTextFile(file, first);
    // 첫 실행: 사람이 프로젝트를 등록하고 추적을 켠다.
    const setup = await openFlowShell();
    const home = setup.home;
    let documentId: string;
    try {
      await registerTrackedProject(setup, {
        folder,
        name: "notes",
        title: "Notes",
      });
      await untilDocuments(
        setup,
        ["notes"],
        "추적한 파일이 문서가 되지 않았다",
      );
      documentId = (await documentTitled(setup, "notes")).id;
    } finally {
      await setup.close();
    }
    // 두 번째 실행: 그 project 작업대부터 연다.
    const flow = await openFlowShell({ home, start: `project:${PROJECT}` });
    const versions = async () =>
      ((await mustCall(flow, {
        kind: "read",
        resource: "documents",
        method: "history",
        body: { document: documentId },
      })).versions as { number: number; saved_by: string }[])
        .toSorted((a, b) => b.number - a.number);
    let restore: (() => Promise<void>) | undefined;
    try {
      await t.step(
        "1: sidebar의 문서를 열면 읽기 화면이 서고 본문이 보인다",
        async () => {
          await flow.until(
            `document.querySelector("[data-space]")?.getAttribute("data-space") === "project"`,
            "project 작업대가 서지 않았다",
          );
          await flow.until(
            `document.querySelector('[data-document="${documentId}"]') !== null`,
            "sidebar에 문서가 없다",
          );
          await flow.click(`[data-document="${documentId}"]`);
          await flow.until(
            `document.querySelector("[data-document-view]")?.getAttribute("data-document-view") === "read"`,
            "읽기 화면이 열리지 않았다",
          );
          await flow.until(
            `document.querySelector("[data-document-body]")?.textContent?.includes("First line.")`,
            "본문이 읽히지 않았다",
          );
          assertEquals((await versions()).map((v) => v.number), [1]);
        },
      );
      await t.step(
        "2: 편집으로 바꿔 쓰면 파일만 원자 교체되고 판은 편집 종료를 기다린다",
        async () => {
          await flow.until(
            `document.querySelector("[data-edit-toggle]")?.disabled === false`,
            "편집 전환이 켜지지 않았다",
          );
          await flow.click("[data-edit-toggle]");
          await flow.until(
            `document.querySelector("[data-document-view]")?.getAttribute("data-document-view") === "edit"`,
            "편집 화면이 열리지 않았다",
          );
          await flow.evaluate(
            `(() => { const line = [...document.querySelectorAll(".cm-line")].at(-1); const range = document.createRange(); range.selectNodeContents(line); range.collapse(false); const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range); document.querySelector(".cm-content").focus(); return true; })()`,
          );
          const page = await flow.shell.connect("://desktop/");
          await page.command("Input.insertText", { text: "Second line." });
          // 입력이 멈추면 자동 저장이 파일을 원자 교체한다.
          await waitForFile(file, `${first}Second line.`);
          await flow.until(
            `document.querySelector("[data-save-status]")?.getAttribute("data-save-status") === "saved"`,
            "파일 저장됨 상태가 오지 않았다",
          );
          // 판은 아직 그대로다(자동 저장은 판을 확정하지 않는다).
          assertEquals((await versions()).map((v) => v.number), [1]);
        },
      );
      await t.step("2: 편집 종료(저장 키)는 고정 판 2를 확정한다", async () => {
        await pressSave(flow);
        await flow.until(
          `document.querySelector("[data-save-status]")?.getAttribute("data-save-status") === "version-saved"`,
          "판 확정 상태가 오지 않았다",
        );
        const rows = await versions();
        assertEquals(rows.map((v) => v.number), [2, 1]);
        assertEquals(rows[0].saved_by, "machine");
      });

      await t.step(
        "edit-document 3·4: 바깥이 먼저 파일을 바꿨으면 저장을 멈추고 충돌을 알리며 사람이 고른 글만 쓴다",
        async () => {
          const outside = "# Notes\n\nOutside.\n";
          await Deno.writeTextFile(file, outside);
          await focusEnd(flow);
          const page = await flow.shell.connect("://desktop/");
          await page.command("Input.insertText", { text: " Mine." });
          await flow.until(
            `document.querySelector("[data-save-status]")?.getAttribute("data-save-status") === "conflict"`,
            "충돌 상태가 오지 않았다",
          );
          // 바깥 파일은 덮이지 않았다.
          assertEquals(await Deno.readTextFile(file), outside);
          await flow.click(`[data-save-action="compare"]`);
          await flow.until(
            `document.querySelector('[data-conflict-view="disk"]')?.textContent?.includes("Outside.")`,
            "바깥 파일과 비교하는 화면이 열리지 않았다",
          );
          assertEquals(await Deno.readTextFile(file), outside);
          await flow.click("[data-conflict-mine]");
          await waitForFile(file, `${first}Second line. Mine.`);
          await flow.until(
            `document.querySelector("[data-save-status]")?.getAttribute("data-save-status") === "saved"`,
            "충돌을 푼 뒤 저장됨 상태가 오지 않았다",
          );
        },
      );
      await t.step(
        "edit-document 5 다른 갈래: 파일을 쓸 수 없으면 실패와 다시 시도를 알리고 풀리면 이어서 저장한다",
        async () => {
          await focusEnd(flow);
          await Deno.chmod(folder, 0o555);
          restore = () => Deno.chmod(folder, 0o755);
          const page = await flow.shell.connect("://desktop/");
          await page.command("Input.insertText", { text: " Lost." });
          await flow.until(
            `document.querySelector("[data-save-status]")?.getAttribute("data-save-status") === "failed"`,
            "저장 실패 상태가 오지 않았다",
          );
          assertEquals(
            await Deno.readTextFile(file),
            `${first}Second line. Mine.`,
          );
          await flow.until(
            `document.querySelector("[data-save-action='retry']") !== null`,
            "다시 시도 항목이 없다",
          );
          await restore();
          restore = undefined;
          await flow.click("[data-save-action='retry']");
          // 풀린 뒤 다시 시도하면 사람의 글이 파일에 쓰인다.
          await waitForFile(file, `${first}Second line. Mine. Lost.`);
          // 쓴 뒤 편집기가 바깥 변경으로 읽으면 충돌 해결 길로 끝낸다(해결 뒤에는 저장됨이다).
          await flow.until(
            `/^(saved|conflict)$/.test(document.querySelector("[data-save-status]")?.getAttribute("data-save-status") ?? "")`,
            "다시 시도한 뒤 결과가 오지 않았다",
          );
          if (await flow.count(`[data-save-status="conflict"]`) > 0) {
            await flow.click(`[data-save-action="compare"]`);
            await flow.until(
              `document.querySelector("[data-conflict-view]") !== null`,
              "충돌 해결 화면이 열리지 않았다",
            );
            await flow.click("[data-conflict-mine]");
          }
          await flow.until(
            `document.querySelector("[data-save-status]")?.getAttribute("data-save-status") === "saved"`,
            "저장됨 상태가 오지 않았다",
          );
          assertEquals(
            await Deno.readTextFile(file),
            `${first}Second line. Mine. Lost.`,
          );
        },
      );
    } finally {
      await restore?.();
      await flow.close();
      await removeHome(home);
      await Deno.remove(folder, { recursive: true });
    }
  },
});

async function focusEnd(
  flow: { evaluate(e: string): Promise<unknown> },
): Promise<void> {
  await flow.evaluate(
    `(() => { const line = [...document.querySelectorAll(".cm-line")].at(-1); const range = document.createRange(); range.selectNodeContents(line); range.collapse(false); const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range); document.querySelector(".cm-content").focus(); return true; })()`,
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
