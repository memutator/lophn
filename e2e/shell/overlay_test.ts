// shell#T61: overlay 실제 Electron 확인. contracts#T10 harness로 실제 Electron
// shell을 임시 LOPHN_HOME으로 띄우고 확인한다.
// - shell/app-frame#R24: overlay view가 창 본문 전체를 bounds로 쓰고 아래 창
//   webContents를 숨기지 않는다. attach 뒤에도 맨 위로 다시 올라온다.
// - shell/app-frame#R24 + shell/design-system#R20: dialog 안 menu는 같은 overlay
//   root의 sibling section이고 popover 층(z 230)이 dialog(z 210) 위에 보인다.
// - shell/app-frame#R29: 경계 drag는 창 본문 전체 rect로 그리고 아래 view를
//   숨기거나 떼지 않는다. 연속 resize의 bounds 적용은 16ms마다 한 번으로 묶인다.
// - shell/design-system#R2: 조작 표면(dialog)을 열면 overlay view로 focus가
//   옮겨지고 닫으면 desktop renderer로 돌아온다.
// 화면이 없으면 건너뛴다.
import { assert, assertEquals } from "@std/assert";

import { e2eEnabled, READY_TIMEOUT_MS } from "../harness.ts";
import { launchShell, type PageSession, type RunningShell } from "../run.ts";

const repoRoot = new URL("../../", import.meta.url).pathname.replace(
  /\/$/,
  "",
);
const electronExecutable =
  `${repoRoot}/packages/shell/main/node_modules/electron/dist/electron`;
const shellApp = `${repoRoot}/packages/shell/main/dist/main.cjs`;

const TOP_BAR_HEIGHT = 48;

function freePort(): number {
  const listener = Deno.listen({ hostname: "127.0.0.1", port: 0 });
  const port = (listener.addr as Deno.NetAddr).port;
  listener.close();
  return port;
}

/** 표현식 결과가 기대값이 될 때까지 기다린다. */
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

interface OpenInput {
  requestId: string;
  kind: string;
  anchorRect: { x: number; y: number; width: number; height: number };
  model: {
    label: string;
    text?: string;
    choices: { id: string; label: string }[];
  };
}

/** desktop renderer가 shell api로 overlay 표면을 연다. */
async function openSurface(
  shell: RunningShell,
  input: OpenInput,
): Promise<{ ok: boolean; value?: { surfaceId: string; generation: number } }> {
  return await shell.evaluate(
    `(async () => await window.lophnShell.open(${JSON.stringify(input)}))()`,
  ) as { ok: boolean; value?: { surfaceId: string; generation: number } };
}

const menuInput = (requestId: string): OpenInput => ({
  requestId,
  kind: "menu",
  anchorRect: { x: 200, y: 100, width: 16, height: 16 },
  model: {
    label: "Actions",
    choices: [
      { id: "open", label: "Open" },
      { id: "close-item", label: "Close" },
    ],
  },
});

const dialogInput = (requestId: string): OpenInput => ({
  requestId,
  kind: "dialog",
  anchorRect: { x: 100, y: 100, width: 200, height: 100 },
  model: {
    label: "Confirm",
    text: "Save changes?",
    choices: [
      { id: "cancel", label: "Cancel" },
      { id: "save", label: "Save" },
    ],
  },
});

/** shell과 overlay renderer page를 띄워 돌려준다. */
async function launchWithOverlay(): Promise<{
  home: string;
  shell: RunningShell;
  overlay: PageSession;
}> {
  const home = await Deno.makeTempDir({ prefix: "lophn-e2e-overlay-" });
  const port = freePort();
  const shell = await launchShell({
    executable: electronExecutable,
    app: shellApp,
    home,
    port,
  });
  // desktop renderer가 준비될 때까지 기다린다.
  await waitFor(
    shell.evaluate,
    `document.querySelector("[data-space]")?.getAttribute("data-space") ?? ""`,
    "launcher",
  );
  // overlay view page는 lophn-shell://overlay/index.html target이다.
  const overlay = await shell.connect("lophn-shell://overlay/index.html");
  return { home, shell, overlay };
}

Deno.test({
  name:
    "e2e shell/app-frame#R24: dialog를 열면 overlay view bounds가 창 본문 전체가 되고 아래 창 view가 보이며 닫은 뒤에도 붙어 있다",
  ignore: !e2eEnabled(),
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const { home, shell, overlay } = await launchWithOverlay();
    try {
      // overlay page가 registry를 준비한다.
      await waitFor(
        overlay.evaluate,
        `document.getElementById("root") instanceof HTMLElement`,
        true,
      );

      // dialog를 열어 overlay view bounds가 창 본문 전체가 되게 한다.
      const reply = await openSurface(shell, dialogInput("dialog-1"));
      assertEquals(
        reply.ok,
        true,
        `overlay open 실패: ${JSON.stringify(reply)}`,
      );

      // native view bounds가 창 본문 전체다(TOP_BAR 아래, 창 폭과 같다).
      await waitFor(
        shell.mainEvaluate,
        `(() => {
          const windows = electron.BrowserWindow.getAllWindows();
          const view = windows[0].contentView.children[0];
          if (!view || !view.webContents?.getURL?.().includes("overlay")) return "";
          const [width = 0, height = 0] = windows[0].getContentSize();
          const bounds = view.getBounds();
          return bounds.y === ${TOP_BAR_HEIGHT} &&
            Math.abs(width - bounds.width) < 2 &&
            Math.abs(height - ${TOP_BAR_HEIGHT} - bounds.height) < 2
            ? "full" : "partial";
        })()`,
        "full",
      );

      // 아래 창 webContents(desktop renderer)는 보이고 URL이 desktop이다.
      const below = await shell.mainEvaluate(`(() => {
        const windows = electron.BrowserWindow.getAllWindows();
        const window = windows[0];
        return {
          desktopUrl: window.webContents.getURL(),
          overlayVisible: window.contentView.children[0]?.getVisible?.() ?? null,
        };
      })()`);
      assert(
        typeof below === "object" && below !== null,
        `desktop view 읽기 실패: ${JSON.stringify(below)}`,
      );
      const under = below as { desktopUrl: string; overlayVisible: boolean };
      assert(
        under.desktopUrl.includes("desktop"),
        `창 webContents가 desktop이 아니다: ${under.desktopUrl}`,
      );
      assertEquals(
        under.overlayVisible,
        true,
        "dialog 중 overlay view가 보이지 않는다",
      );

      // overlay page DOM에 dialog 표면이 본문 전체 rect로 그려진다.
      await waitFor(
        overlay.evaluate,
        `document.querySelector('[data-kind="dialog"]') !== null`,
        true,
      );

      // 표면을 닫는다.
      const identity = reply.value!;
      const state = await shell.evaluate(
        `(async () => await window.lophnShell.close(${
          JSON.stringify(identity)
        }))()`,
      ) as { ok: boolean };
      assertEquals(state.ok, true, "close가 실패했다");

      // 닫은 뒤에도 overlay view는 붙어 있고 아래 창 view는 그대로다.
      const after = await shell.mainEvaluate(`(() => {
        const windows = electron.BrowserWindow.getAllWindows();
        const window = windows[0];
        const view = window.contentView.children[0];
        return {
          attached: !!view?.webContents?.getURL?.().includes("overlay"),
          visible: view?.getVisible?.() ?? null,
          desktopUrl: window.webContents.getURL(),
        };
      })()`);
      const afterState = after as {
        attached: boolean;
        visible: boolean | null;
        desktopUrl: string;
      };
      assertEquals(
        afterState.attached,
        true,
        "닫은 뒤 overlay view가 떨어졌다",
      );
      assertEquals(
        afterState.desktopUrl,
        under.desktopUrl,
        "닫은 뒤 창 view가 바뀌었다",
      );
    } finally {
      await shell.close();
      await Deno.remove(home, { recursive: true });
    }
  },
});

Deno.test({
  name:
    "e2e shell/app-frame#R24 + shell/design-system#R20: dialog 안 menu는 같은 overlay root의 sibling section이고 popover 층이 dialog 위에 보인다",
  ignore: !e2eEnabled(),
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const { home, shell, overlay } = await launchWithOverlay();
    try {
      // dialog를 열고 그 위에 menu를 연다.
      const replies = await shell.evaluate(`(async () => ({
        dialog: await window.lophnShell.open(${
        JSON.stringify(dialogInput("dialog-2"))
      }),
        menu: await window.lophnShell.open(${
        JSON.stringify(menuInput("menu-2"))
      }),
      }))()`) as {
        dialog: { ok: boolean };
        menu: { ok: boolean };
      };
      assertEquals(replies.dialog.ok, true, `dialog open 실패`);
      assertEquals(replies.menu.ok, true, `menu open 실패`);

      await waitFor(
        overlay.evaluate,
        `document.querySelector('[data-kind="menu"]') !== null`,
        true,
      );

      // 두 표면은 root의 직접 section 자식이고 menu z가 dialog z보다 크다.
      const stacking = await overlay.evaluate(`(() => {
        const root = document.getElementById("root");
        const dialog = root.querySelector('section[data-kind="dialog"]');
        const menu = root.querySelector('section[data-kind="menu"]');
        if (!dialog || !menu) return "";
        return {
          sameParent: dialog.parentElement === menu.parentElement &&
            menu.parentElement === root,
          dialogZ: Number(getComputedStyle(dialog).zIndex),
          menuZ: Number(getComputedStyle(menu).zIndex),
        };
      })()`);
      assert(
        typeof stacking === "object" && stacking !== null,
        `쌓임 읽기 실패: ${JSON.stringify(stacking)}`,
      );
      const stack = stacking as {
        sameParent: boolean;
        dialogZ: number;
        menuZ: number;
      };
      assertEquals(stack.sameParent, true, "dialog와 menu가 sibling이 아니다");
      // token 층: dialog 210, menu(popover) 230(design-system#R20).
      assertEquals(stack.dialogZ, 210, "dialog 층이 token과 다르다");
      assertEquals(stack.menuZ, 230, "menu 층이 token과 다르다");
      assert(
        stack.menuZ > stack.dialogZ,
        `menu(${stack.menuZ})가 dialog(${stack.dialogZ}) 위에 없다`,
      );
    } finally {
      await shell.close();
      await Deno.remove(home, { recursive: true });
    }
  },
});

Deno.test({
  name:
    "e2e shell/app-frame#R29: 경계 drag가 창 본문 전체 rect로 그리고 아래 view를 숨기거나 떼지 않는다",
  ignore: !e2eEnabled(),
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const { home, shell, overlay } = await launchWithOverlay();
    try {
      const dragInput: OpenInput = {
        requestId: "drag-1",
        kind: "drag",
        anchorRect: { x: 100, y: 100, width: 1, height: 1 },
        model: { label: "Resize", choices: [] },
      };
      const reply = await openSurface(shell, dragInput);
      assertEquals(reply.ok, true, `drag open 실패: ${JSON.stringify(reply)}`);

      await waitFor(
        overlay.evaluate,
        `document.querySelector('[data-kind="drag"]') !== null`,
        true,
      );

      // drag 표면은 본문 전체 rect(left 0, top 0, 본문 크기)를 받는다.
      const rect = await overlay.evaluate(`(() => {
        const node = document.querySelector('[data-kind="drag"]');
        if (!node) return "";
        return {
          left: node.style.left,
          top: node.style.top,
          hasRect: node.style.width !== "" && node.style.height !== "",
        };
      })()`);
      const drag = rect as
        | { left: string; top: string; hasRect: boolean }
        | string;
      assert(
        typeof drag === "object" && drag !== null,
        `drag rect 읽기 실패: ${JSON.stringify(drag)}`,
      );
      assertEquals(drag.left, "0px", "drag 표면이 본문 왼쪽 가장자리에 없다");
      assertEquals(drag.top, "0px", "drag 표면이 본문 위 가장자리에 없다");
      assertEquals(drag.hasRect, true, "drag 표면에 크기가 없다");

      // native view bounds가 본문 전체이고 아래 창 view는 보인다.
      const native = await shell.mainEvaluate(`(() => {
        const windows = electron.BrowserWindow.getAllWindows();
        const window = windows[0];
        const view = window.contentView.children[0];
        const [width = 0, height = 0] = window.getContentSize();
        const bounds = view.getBounds();
        return {
          visible: view.getVisible(),
          fullBody: bounds.y === ${TOP_BAR_HEIGHT} && bounds.width === width &&
            bounds.height === height - ${TOP_BAR_HEIGHT},
        };
      })()`);
      const state = native as { visible: boolean; fullBody: boolean };
      assertEquals(state.visible, true, "drag 중 아래 view가 숨겨졌다");
      assertEquals(
        state.fullBody,
        true,
        "drag 중 overlay view bounds가 본문 전체가 아니다",
      );

      // overlay view를 detach하지 않는다: children에 여전히 들어 있다.
      const attached = await shell.mainEvaluate(`(() => {
        const windows = electron.BrowserWindow.getAllWindows();
        const view = windows[0].contentView.children[0];
        return !!view?.webContents?.getURL?.().includes("overlay");
      })()`);
      assertEquals(attached, true, "drag 중 overlay view가 detach됐다");
    } finally {
      await shell.close();
      await Deno.remove(home, { recursive: true });
    }
  },
});

Deno.test({
  name:
    "e2e shell/app-frame#R29: 연속 resize 때 overlay view bounds 적용이 16ms 이상 간격으로 묶인다",
  ignore: !e2eEnabled(),
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const { home, shell } = await launchWithOverlay();
    try {
      // overlay view의 setBounds를 기록 wrapper로 바꾼다.
      const setup = await shell.mainEvaluate(`(() => {
        const windows = electron.BrowserWindow.getAllWindows();
        const view = windows[0].contentView.children[0];
        if (!view?.webContents?.getURL?.().includes("overlay")) return "no-view";
        if (!globalThis.__boundsLog) {
          globalThis.__boundsLog = [];
          const original = view.setBounds.bind(view);
          view.setBounds = (bounds) => {
            globalThis.__boundsLog.push(Date.now());
            original(bounds);
          };
        }
        return "wrapped";
      })()`);
      assertEquals(setup, "wrapped");

      // 10번 크기를 8ms 간격으로 바꾼다(총 약 80ms, 16ms 묶음이면 5번 적용).
      await shell.mainEvaluate(`(async () => {
        const win = electron.BrowserWindow.getAllWindows()[0];
        for (let i = 0; i < 10; i++) {
          win.setSize(960 + i * 5, 600 + i * 3);
          await new Promise((resolve) => setTimeout(resolve, 8));
        }
      })()`);

      // 적용 기록을 읽는다. 16ms 묶음이면 적용 횟수가 resize 횟수보다 적다.
      const applied = await shell.mainEvaluate(`globalThis.__boundsLog`);
      assert(
        Array.isArray(applied),
        `bounds 기록이 배열이 아니다: ${JSON.stringify(applied)}`,
      );
      const times = applied as number[];
      assert(
        times.length >= 2,
        `resize 중 bounds가 한 번도 적용되지 않았다: ${JSON.stringify(times)}`,
      );
      assert(
        times.length < 10,
        `bounds 적용이 묶이지 않았다: ${times.length}번 적용`,
      );
      for (let i = 1; i < times.length; i++) {
        assert(
          times[i] - times[i - 1] >= 15,
          `bounds 적용이 16ms보다 촘촘하다: ${times[i] - times[i - 1]}ms`,
        );
      }
    } finally {
      await shell.close();
      await Deno.remove(home, { recursive: true });
    }
  },
});

Deno.test({
  name:
    "e2e shell/design-system#R2: dialog를 열면 overlay view로 focus가 옮겨지고 닫으면 desktop renderer로 돌아온다",
  ignore: !e2eEnabled(),
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const { home, shell } = await launchWithOverlay();
    try {
      // desktop renderer의 webContents로 focus를 준다.
      await shell.mainEvaluate(`(() => {
        electron.BrowserWindow.getAllWindows()[0].webContents.focus();
      })()`);
      const started = await shell.mainEvaluate(`(() => {
        const window = electron.BrowserWindow.getAllWindows()[0];
        const view = window.contentView.children[0];
        return {
          desktop: window.webContents.isFocused(),
          overlay: view.webContents.isFocused(),
        };
      })()`);
      const start = started as { desktop: boolean; overlay: boolean };
      assertEquals(
        start.desktop,
        true,
        "시작 focus가 desktop renderer에 있지 않다",
      );

      // dialog를 연다. 조작 표면이라 overlay view로 focus가 옮겨진다.
      const reply = await openSurface(shell, dialogInput("dialog-focus"));
      assertEquals(
        reply.ok,
        true,
        `dialog open 실패: ${JSON.stringify(reply)}`,
      );
      await waitFor(
        shell.mainEvaluate,
        `(() => {
          const window = electron.BrowserWindow.getAllWindows()[0];
          const view = window.contentView.children[0];
          return view.webContents.isFocused() ? "moved" : "waiting";
        })()`,
        "moved",
      );

      // 표면을 닫는다. 마지막 조작 표면이 닫히면 main이 shell을 다시 focus한다.
      const identity = reply.value!;
      await shell.evaluate(
        `(async () => await window.lophnShell.close(${
          JSON.stringify(identity)
        }))()`,
      );
      await waitFor(
        shell.mainEvaluate,
        `(() => {
          const window = electron.BrowserWindow.getAllWindows()[0];
          return window.webContents.isFocused() ? "restored" : "elsewhere";
        })()`,
        "restored",
      );

      // 닫은 뒤 overlay view는 focus를 가지지 않는다.
      const after = await shell.mainEvaluate(`(() => {
        const window = electron.BrowserWindow.getAllWindows()[0];
        const view = window.contentView.children[0];
        return view.webContents.isFocused();
      })()`);
      assertEquals(after, false, "닫은 뒤에도 overlay view가 focus를 가진다");
    } finally {
      await shell.close();
      await Deno.remove(home, { recursive: true });
    }
  },
});
