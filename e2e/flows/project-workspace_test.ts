// shell#T14: project-workspace 틀이 실제 창에서 치수를 지킨다.
// 개발 시드(LOPHN_DEV_SEED)로 프로젝트 공간을 열고 sidebar·상단 바·탭 줄·두 칸을
// 측정한다. 시드는 core를 부르지 않으므로 제품 데이터와 무관하다.
// 화면이 없으면(DISPLAY 없음) 건너뛴다.
import { assert, assertEquals } from "@std/assert";

import { buildReply } from "../../tools/fake-provider/semantic.ts";
import { e2eEnabled, READY_TIMEOUT_MS } from "../harness.ts";
import { launchShell, type RunningShell } from "../run.ts";
import {
  commandBody,
  type FlowShell,
  mustCall,
  openProjectWorkspace,
  removeHome,
  typeAtEnd,
  untilFile,
  versionHistory,
} from "../flow-support.ts";
import type { PageSession } from "../run.ts";

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
    const { flow, documentId } = await openProjectWorkspace({
      folder,
      name: "notes",
      title: "Notes",
      document: "notes",
    });
    const home = flow.home;
    const versions = () => versionHistory(flow, documentId);
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
          await typeAtEnd(flow, "Second line.");
          // 입력이 멈추면 자동 저장이 파일을 원자 교체한다.
          await untilFile(file, `${first}Second line.`);
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
          await typeAtEnd(flow, " Mine.");
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
          await untilFile(file, `${first}Second line. Mine.`);
          await flow.until(
            `document.querySelector("[data-save-status]")?.getAttribute("data-save-status") === "saved"`,
            "충돌을 푼 뒤 저장됨 상태가 오지 않았다",
          );
        },
      );
      await t.step(
        "edit-document 5 다른 갈래: 파일을 쓸 수 없으면 실패와 다시 시도를 알리고 풀리면 이어서 저장한다",
        async () => {
          await Deno.chmod(folder, 0o555);
          restore = () => Deno.chmod(folder, 0o755);
          await typeAtEnd(flow, " Lost.");
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
          await untilFile(file, `${first}Second line. Mine. Lost.`);
          // 다시 시도가 쓴 글은 바깥 변경이 아니라 저장으로 끝난다. 그 뒤 documents의 유휴 종료가 판을
          // 만들면 판 확정으로 넘어갈 수 있으나 충돌은 아니다.
          await flow.until(
            `/^(saved|version-saved)$/.test(document.querySelector("[data-save-status]")?.getAttribute("data-save-status") ?? "")`,
            "다시 시도한 뒤 저장됨 상태가 오지 않았다",
          );
          // 겹친 쓰기의 늦은 충돌 응답까지 기다려도 충돌로 바뀌지 않는다.
          await new Promise((resolve) => setTimeout(resolve, 1500));
          assertEquals(await flow.count(`[data-save-status="conflict"]`), 0);
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

// shell.connect는 url마다 CDP session을 캐시한다. 여기서 닫으면 다음 읽기가 죽은
// session을 받아 overlay dialog를 못 본다. 창을 닫을 때 shell이 session을 정리한다.
const LEAVE_DIALOG = `(() => {
  const dialog = document.querySelector('[role="dialog"]');
  const host = document.querySelector('[data-kind="dialog"]');
  if (!dialog) {
    return JSON.stringify({
      open: false,
      host: host !== null,
      text: (document.body.innerText || "").slice(0, 400),
    });
  }
  return JSON.stringify({
    open: true,
    host: host !== null,
    title: dialog.textContent ?? "",
    buttons: [...dialog.querySelectorAll("button")].map((el) => el.textContent ?? ""),
  });
})()`;

type LeaveDialog = {
  open: boolean;
  host: boolean;
  title?: string;
  buttons?: string[];
  text?: string;
};

async function untilLeaveDialog(
  flow: FlowShell,
  overlay: PageSession,
): Promise<LeaveDialog> {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  let last = "";
  while (Date.now() < deadline) {
    last = String(await overlay.evaluate(LEAVE_DIALOG));
    const parsed = JSON.parse(last) as LeaveDialog;
    if (parsed.open) return parsed;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  const desktop = await flow.evaluate(`JSON.stringify({
    status: document.querySelector("[data-save-status]")?.getAttribute("data-save-status") ?? null,
    view: document.querySelector("[data-document-view]")?.getAttribute("data-document-view") ?? null,
    kind: document.querySelector("[data-tab-strip] [data-tab]")?.getAttribute("data-kind") ?? null,
    close: document.querySelector("[data-tab-strip] [data-close]") !== null,
  })`);
  throw new Error(
    `닫기 guard dialog가 열리지 않았다: overlay=${last} desktop=${desktop}`,
  );
}

async function pressLeaveChoice(
  overlay: PageSession,
  label: string,
): Promise<void> {
  const pressed = await overlay.evaluate(
    `(() => { const button = [...document.querySelectorAll('[role="dialog"] button')].find((el) => el.textContent === ${
      JSON.stringify(label)
    }); if (!button) return false; button.click(); return true; })()`,
  );
  assertEquals(pressed, true, `${label} 버튼이 없다`);
}

async function untilDialogClosed(overlay: PageSession): Promise<void> {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  let last: unknown;
  while (Date.now() < deadline) {
    last = await overlay.evaluate(
      `document.querySelector('[role="dialog"]') === null`,
    );
    if (last === true) return;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`guard dialog가 닫히지 않았다: ${JSON.stringify(last)}`);
}

Deno.test({
  name:
    "shell/editor#R1 shell/editor#R2 documents/file-tracking#R15 flow edit-document 8: 저장되지 않은 글이 남은 탭을 닫으면 guard dialog가 묻고 계속 편집이나 버리고 닫기를 사람이 고른다",
  ignore: !e2eEnabled(),
  sanitizeOps: false,
  sanitizeResources: false,
  async fn(t) {
    const folder = await Deno.realPath(
      await Deno.makeTempDir({ prefix: "lophn-e2e-guard-" }),
    );
    const file = `${folder}/notes.md`;
    const first = "# Notes\n\nFirst line.\n";
    await Deno.writeTextFile(file, first);
    const { flow, documentId } = await openProjectWorkspace({
      folder,
      name: "notes",
      title: "Notes",
      document: "notes",
    });
    const home = flow.home;
    const closeTab = `[data-tab-strip] [data-tab="${documentId}"] [data-close]`;
    let restore: (() => Promise<void>) | undefined;
    let overlay: PageSession | undefined;
    try {
      await flow.until(
        `document.querySelector('[data-document="${documentId}"]') !== null`,
        "sidebar에 문서가 없다",
      );
      await flow.click(`[data-document="${documentId}"]`);
      await flow.until(
        `document.querySelector("[data-edit-toggle]")?.disabled === false`,
        "편집 전환이 켜지지 않았다",
      );
      await flow.click("[data-edit-toggle]");
      await flow.until(
        `document.querySelector("[data-document-view]")?.getAttribute("data-document-view") === "edit"`,
        "편집 화면이 열리지 않았다",
      );
      // 폴더를 막은 채 고치면 원자 교체용 임시 파일을 만들지 못해 저장되지 않은 글이 남는다.
      await Deno.chmod(folder, 0o555);
      restore = () => Deno.chmod(folder, 0o755);
      await typeAtEnd(flow, "Unsaved line.");
      await flow.until(
        `document.querySelector("[data-save-status]")?.getAttribute("data-save-status") === "failed"`,
        "저장 실패 상태가 오지 않았다",
      );
      overlay = await flow.shell.connect("lophn-shell://overlay/index.html");

      await t.step(
        "shell/editor#R1 8: 탭을 닫으면 저장 결과를 확인하고 남은 글을 두고 사람에게 묻는다",
        async () => {
          await flow.click(closeTab);
          const dialog = await untilLeaveDialog(flow, overlay!);
          assert(
            dialog.host,
            "overlay dialog host가 없다",
          );
          assert(
            (dialog.title ?? "").includes("Changes aren't saved yet"),
            `guard dialog 제목이 다르다: ${dialog.title}`,
          );
          assertEquals(
            (dialog.buttons ?? []).filter((label) =>
              ["Keep editing", "Check again", "Discard changes"].includes(
                label,
              )
            ).sort(),
            ["Check again", "Discard changes", "Keep editing"],
          );
          // 묻는 동안 탭은 남아 있고 저장된 것처럼 보이지 않으며 파일은 그대로다.
          assertEquals(await flow.count(`[data-document-view="edit"]`), 1);
          assertEquals(
            await flow.evaluate(
              `document.querySelector("[data-save-status]")?.getAttribute("data-save-status")`,
            ),
            "failed",
          );
          assertEquals(await Deno.readTextFile(file), first);
        },
      );

      await t.step(
        "shell/editor#R1 8: 계속 편집을 고르면 탭과 저장되지 않은 글이 남는다",
        async () => {
          await pressLeaveChoice(overlay!, "Keep editing");
          await untilDialogClosed(overlay!);
          await flow.until(
            `document.querySelector("[data-document-view]")?.getAttribute("data-document-view") === "edit"`,
            "계속 편집을 골랐는데 편집 화면이 사라졌다",
          );
          assertEquals(
            await flow.evaluate(
              `document.querySelector("[data-save-status]")?.getAttribute("data-save-status")`,
            ),
            "failed",
          );
          assertEquals(await Deno.readTextFile(file), first);
        },
      );

      await t.step(
        "shell/editor#R1 documents/file-tracking#R15 8: 버리고 닫기는 사람이 고르며 파일에 쓰지도 판을 만들지도 않는다",
        async () => {
          await flow.click(closeTab);
          await untilLeaveDialog(flow, overlay!);
          await pressLeaveChoice(overlay!, "Discard changes");
          await flow.until(
            `document.querySelector("[data-document-view]") === null`,
            "버리고 닫았는데 문서 탭이 남아 있다",
          );
          assertEquals(await Deno.readTextFile(file), first);
          assertEquals(
            (await versionHistory(flow, documentId)).map((version) =>
              version.number
            ),
            [1],
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

// lophn-agent slice: project-workspace 8(현재 보기 상태). 실제 shell(headless)·core(제품 runtime
// child)를 임시 LOPHN_HOME으로 띄우고 model은 이 시험의 loopback 응답 server가 낸다. project
// 작업대에서 문서를 연 채 도크로 일을 청하면, lophn은 그 창의 탭·초점과 관측 시각을 짧은 turn
// context로 조립해 model 입력에 싣는다. 보기가 바뀐 뒤의 요청은 새로 모은 보기를 싣고 옛 보기를
// 대신 쓰지 않는다. 터미널은 열지 않으며(node-pty 미빌드) 터미널 출력은 turn context에 없다.

const VIEW_PROVIDER = "pvd_01arz3ndektsv4rrffq69g5fav";
const VIEW_MODEL = "claude-sonnet-4-5";

function startViewProvider() {
  const bodies: string[] = [];
  const server = Deno.serve(
    { hostname: "127.0.0.1", port: 0, onListen: () => {} },
    async (request) => {
      const text = await request.text();
      if (
        request.method !== "POST" ||
        !new URL(request.url).pathname.endsWith("/messages")
      ) {
        return Response.json({ error: "unexpected" }, { status: 500 });
      }
      bodies.push(text);
      const built = buildReply("messages", {
        text: `Noted ${bodies.length}.`,
        usage: { input: 30, output: 4 },
        stop: "end",
      });
      return new Response(built.body ?? "", {
        status: built.status,
        headers: built.headers,
      });
    },
  );
  return {
    url: `http://127.0.0.1:${server.addr.port}`,
    calls: () => bodies.length,
    body: (index: number) => bodies[index] ?? "",
    close: () => server.shutdown(),
  };
}

Deno.test({
  name:
    "lophn-agent/harness/prompt-assemble#R25 lophn-agent/harness/prompt-assemble#R26 shell/workspace#R9 shell/workspace#R10 flow project-workspace 8: 작업대에서 일을 청하면 그 창의 탭·초점·관측 시각을 현재 보기로 조립하고 바뀐 보기는 새로 모은다",
  // 미검증 WIP — 실행 전
  ignore: true,
  sanitizeOps: false,
  sanitizeResources: false,
  async fn(t) {
    const folder = await Deno.realPath(
      await Deno.makeTempDir({ prefix: "lophn-e2e-ws-view-" }),
    );
    await Deno.writeTextFile(`${folder}/notes.md`, "# Notes\n\nFirst line.\n");
    const provider = startViewProvider();
    const { flow, documentId } = await openProjectWorkspace({
      folder,
      name: "notes",
      title: "Notes",
      document: "notes",
    });
    const home = flow.home;
    try {
      await mustCall(flow, {
        kind: "command",
        resource: "providers",
        method: "register",
        body: commandBody({
          id: VIEW_PROVIDER,
          name: "fixture",
          definition: {
            key: "anthropic",
            display_name: "Anthropic",
            protocols: ["anthropic-messages"],
            auth_kinds: ["none"],
            models_endpoint: null,
            oauth: null,
            revision: "2026-01-01",
          },
          endpoint: provider.url,
          protocol: "anthropic-messages",
        }),
      });
      const defaults = await mustCall(flow, {
        kind: "read",
        resource: "agent-model-defaults",
        method: "read",
        body: {},
      });
      const seq = (defaults.defaults as { settings_seq: string }).settings_seq;
      await mustCall(flow, {
        kind: "command",
        resource: "agent-model-defaults",
        method: "change",
        body: commandBody(
          {
            judgment: {
              provider: VIEW_PROVIDER,
              credentials: [],
              model_name: VIEW_MODEL,
              reasoning_level: "provider_default",
              options: {},
            },
            organizing: null,
            settings_seq: seq,
          },
          { settings_seq: seq },
        ),
      });
      const untilCalls = async (count: number) => {
        const deadline = Date.now() + 180_000;
        while (provider.calls() < count) {
          assert(
            Date.now() < deadline,
            `model call이 ${count}번 오지 않았다: ${provider.calls()} dock=${
              String(
                await flow.evaluate(
                  `document.querySelector("[data-dock]")?.innerText ?? null`,
                ),
              ).slice(0, 400)
            }`,
          );
          await new Promise((resolve) => setTimeout(resolve, 250));
        }
      };
      const ask = async (text: string, count: number) => {
        await flow.type("[data-composer-input]", text);
        await flow.click("[data-send]");
        await untilCalls(count);
        await flow.until(
          `document.querySelector("[data-dock]")?.innerText.includes("Noted ${count}.")`,
          "도크에 답이 없다",
        );
      };

      await t.step(
        "lophn-agent/harness/prompt-assemble#R25 lophn-agent/harness/prompt-assemble#R26 shell/workspace#R9: 8 열린 문서 탭과 초점·관측 시각이 짧은 현재 보기로 model 입력에 실린다",
        async () => {
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
            `document.querySelector("[data-dock-toggle]") !== null`,
            "도크 토글이 없다",
          );
          await flow.click("[data-dock-toggle]");
          await flow.until(
            `document.querySelector("[data-new-session]") !== null || document.querySelector("[data-composer-input]") !== null`,
            "새 세션 단추가 서지 않았다",
          );
          if (
            await flow.evaluate(
              `document.querySelector("[data-composer-input]") === null`,
            ) === true
          ) {
            await flow.click("[data-new-session]");
          }
          await flow.until(
            `document.querySelector("[data-composer-input]") !== null`,
            "입력칸이 서지 않았다",
          );
          await ask("What am I looking at?", 1);
          const body = provider.body(0);
          for (
            const word of [
              "[turn context]",
              "화면 관측:",
              `* document_viewer`,
              documentId,
            ]
          ) {
            assert(body.includes(word), `turn context에 ${word}가 없다`);
          }
          assert(!body.includes("화면: 없음"), "현재 보기가 없는 것으로 왔다");
          // 터미널을 열지 않았으니 터미널 탭도 출력도 없다.
          const turn = body.split("[turn context]").at(-1) ?? "";
          assert(
            !/- (\* )?terminal /.test(turn),
            "터미널이 turn context에 있다",
          );
          assert(!turn.includes(folder), "폴더 경로가 turn context에 있다");
        },
      );

      await t.step(
        "lophn-agent/harness/prompt-assemble#R27 lophn-agent/harness/prompt-assemble#R28 shell/workspace#R10: 보기가 바뀐 뒤의 요청은 새로 모은 보기를 싣고 옛 보기를 대신 쓰지 않는다",
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
          // 창의 보기 generation이 publish될 시간을 준다.
          await new Promise((resolve) => setTimeout(resolve, 1_500));
          await ask("And now?", 2);
          const before = provider.body(0).match(/generation (\d+)/)?.[1];
          const turn = provider.body(1).split("[turn context]").at(-1) ?? "";
          const after = turn.match(/generation (\d+)/)?.[1];
          assert(
            before !== undefined && after !== undefined,
            "generation이 없다",
          );
          assert(Number(after) > Number(before), `${before} → ${after}`);
          assert(
            turn.includes("* document_editor"),
            "새 보기가 편집 탭이 아니다",
          );
        },
      );
    } finally {
      await flow.close();
      await removeHome(home);
      await provider.close();
      await Deno.remove(folder, { recursive: true });
    }
  },
});
