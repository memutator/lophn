// shell#T61: shell·overlay renderer sandbox 확인. contracts#T10 harness로 실제
// Electron을 임시 LOPHN_HOME으로 띄우고 두 renderer page에서 확인한다.
// - shell/desktop#R16: shell renderer는 sandbox·context isolation이고 Node·DB·비밀·
//   사람 token을 직접 읽을 수 없다.
// - shell/app-frame#R24: overlay renderer도 같은 sandbox이고 임의 IPC channel·method를
//   부를 수 없다. guardIpc가 임의 channel을 거절한다.
// sandbox를 끄는 우회(--no-sandbox 등) 없이 검사한다. 화면이 없으면 건너뛴다.
import { assert, assertEquals } from "@std/assert";

import { e2eEnabled, READY_TIMEOUT_MS } from "../harness.ts";
import { launchShell } from "../run.ts";

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

/** shell과 overlay renderer page를 띄워 돌려준다. */
async function launchWithOverlay() {
  const home = await Deno.makeTempDir({ prefix: "lophn-e2e-sandbox-" });
  const port = freePort();
  const shell = await launchShell({
    executable: electronExecutable,
    app: shellApp,
    home,
    port,
  });
  await waitFor(
    shell.evaluate,
    `document.querySelector("[data-space]")?.getAttribute("data-space") ?? ""`,
    "launcher",
  );
  const overlay = await shell.connect("lophn-shell://overlay/index.html");
  return { home, shell, overlay };
}

/** renderer page의 sandbox 상태와 Node 접근을 본다. */
const PROBE = `(() => {
  const probe = {
    typeofRequire: typeof require,
    typeofGlobalRequire: typeof globalThis.require,
    typeofProcess: typeof process,
    processKeys: typeof process === "object" && process !== null
      ? Object.keys(process).length
      : -1,
    processEnv: typeof process === "object" && process !== null &&
      process.env !== undefined,
    typeofModule: typeof module,
    typeofExports: typeof exports,
    nodeIntegration: typeof globalThis.__electron_require === "function",
  };
  return probe;
})()`;

Deno.test({
  name:
    "e2e shell/desktop#R16: desktop renderer에서 require·process·Node 모듈에 직접 접근할 수 없다",
  ignore: !e2eEnabled(),
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const { home, shell } = await launchWithOverlay();
    try {
      const probe = await shell.evaluate(PROBE);
      assert(
        typeof probe === "object" && probe !== null,
        `sandbox probe 실패: ${JSON.stringify(probe)}`,
      );
      const result = probe as {
        typeofRequire: string;
        typeofProcess: string;
        processEnv: boolean;
        typeofModule: string;
        typeofExports: string;
        nodeIntegration: boolean;
      };
      // sandboxed renderer에는 require가 없다.
      assertEquals(
        result.typeofRequire,
        "undefined",
        "renderer에서 require에 접근할 수 있다",
      );
      assertEquals(
        result.nodeIntegration,
        false,
        "Node integration이 켜져 있다",
      );
      // context isolation이면 main world의 process는 undefined다(preload가 노출하지 않는 한).
      assertEquals(
        result.typeofProcess,
        "undefined",
        "renderer main world에서 process에 접근할 수 있다",
      );
      assertEquals(
        result.processEnv,
        false,
        "renderer에서 process.env에 접근할 수 있다",
      );
      // node: 스킴 모듈을 부를 수 없다.
      const nodeImport = await shell.evaluate(
        `(async () => {
          try {
            const fs = await import("node:fs");
            return typeof fs;
          } catch {
            return "blocked";
          }
        })()`,
      );
      assertEquals(
        nodeImport,
        "blocked",
        "renderer에서 node: 모듈을 import할 수 있다",
      );
    } finally {
      await shell.close();
      await Deno.remove(home, { recursive: true });
    }
  },
});

Deno.test({
  name:
    "e2e shell/desktop#R16: overlay renderer에서도 require·process·Node 모듈에 직접 접근할 수 없다",
  ignore: !e2eEnabled(),
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const { home, shell, overlay } = await launchWithOverlay();
    try {
      await waitFor(
        overlay.evaluate,
        `document.getElementById("root")?.classList.length > 0`,
        true,
      );
      const probe = await overlay.evaluate(PROBE);
      assert(
        typeof probe === "object" && probe !== null,
        `overlay sandbox probe 실패: ${JSON.stringify(probe)}`,
      );
      const result = probe as {
        typeofRequire: string;
        typeofProcess: string;
        processEnv: boolean;
        nodeIntegration: boolean;
      };
      assertEquals(
        result.typeofRequire,
        "undefined",
        "overlay renderer에서 require에 접근할 수 있다",
      );
      assertEquals(
        result.nodeIntegration,
        false,
        "overlay renderer에서 Node integration이 켜져 있다",
      );
      assertEquals(
        result.typeofProcess,
        "undefined",
        "overlay renderer main world에서 process에 접근할 수 있다",
      );
      assertEquals(
        result.processEnv,
        false,
        "overlay renderer에서 process.env에 접근할 수 있다",
      );
      const nodeImport = await overlay.evaluate(
        `(async () => {
          try {
            const fs = await import("node:fs");
            return typeof fs;
          } catch {
            return "blocked";
          }
        })()`,
      );
      assertEquals(
        nodeImport,
        "blocked",
        "overlay renderer에서 node: 모듈을 import할 수 있다",
      );
    } finally {
      await shell.close();
      await Deno.remove(home, { recursive: true });
    }
  },
});

Deno.test({
  name:
    "e2e shell/app-frame#R24: desk renderer에서 임의 IPC channel을 부를 수 없고 overlay api만 노출된다",
  ignore: !e2eEnabled(),
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const { home, shell } = await launchWithOverlay();
    try {
      // contextBridge로 노출된 API 모양만 본다. 임의 channel은 preload closure 안에 남는다.
      const shape = await shell.evaluate(`(() => {
        return {
          shell: Object.keys(window.lophnShell ?? {}),
          shellFrozen: Object.isFrozen(window.lophnShell ?? {}),
          core: Object.keys(window.lophnCore ?? {}),
          ipcRenderer: typeof window.ipcRenderer,
          electron: typeof window.electron,
        };
      })()`);
      assert(
        typeof shape === "object" && shape !== null,
        `bridge shape 실패: ${JSON.stringify(shape)}`,
      );
      const result = shape as {
        shell: string[];
        shellFrozen: boolean;
        core: string[];
        ipcRenderer: string;
        electron: string;
      };
      assertEquals(
        result.shell,
        ["open", "close", "result", "subscribe"],
        "lophnShell이 고정된 overlay api만 노출하지 않는다",
      );
      assertEquals(
        result.shellFrozen,
        true,
        "lophnShell이 freeze되어 있지 않다",
      );
      assertEquals(
        result.core,
        ["subscribe", "call"],
        "lophnCore가 고정된 core api만 노출하지 않는다",
      );
      assertEquals(
        result.ipcRenderer,
        "undefined",
        "renderer에서 ipcRenderer에 접근할 수 있다",
      );
      assertEquals(
        result.electron,
        "undefined",
        "renderer에서 electron에 접근할 수 있다",
      );

      // lophnShell은 임의 channel 이름을 받지 않는다. 4개 method 외에는 없다.
      const arbitrary = await shell.evaluate(
        `typeof window.lophnShell?.arbitraryMethod`,
      );
      assertEquals(arbitrary, "undefined");
    } finally {
      await shell.close();
      await Deno.remove(home, { recursive: true });
    }
  },
});

Deno.test({
  name:
    "e2e shell/app-frame#R24: overlay renderer에서 스푸핑한 IPC caller는 거절된다(guardIpc가 임의 sender를 막는다)",
  ignore: !e2eEnabled(),
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const { home, shell, overlay } = await launchWithOverlay();
    try {
      await waitFor(
        overlay.evaluate,
        `document.getElementById("root")?.classList.length > 0`,
        true,
      );
      // overlay page에서 열기는 shell role만 받는다. overlay role의 lophnShell.open은
      // shell:overlay-open을 부르지만 sender가 overlay webContents라 guardIpc caller
      // 검사에 걸린다(등록 origin은 desktop 페이지다).
      const spoofed = await overlay.evaluate(`(async () => {
        try {
          const reply = await window.lophnShell.open({
            requestId: "spoofed-open",
            kind: "menu",
            anchorRect: { x: 10, y: 10, width: 10, height: 10 },
            model: { label: "Spoofed", choices: [{ id: "item", label: "Item" }] },
          });
          return reply;
        } catch {
          return { ok: false, error: { code: "unavailable", message: "thrown" } };
        }
      })()`);
      assert(
        typeof spoofed === "object" && spoofed !== null,
        `spoofed open 실패: ${JSON.stringify(spoofed)}`,
      );
      const result = spoofed as { ok: boolean; error?: { code: string } };
      assertEquals(
        result.ok,
        false,
        "overlay renderer의 spoofed open이 통과했다",
      );
      // caller가 아니다: forbidden이거나 전송 오류다.
      assert(
        result.error !== undefined,
        `거절에 오류가 없다: ${JSON.stringify(spoofed)}`,
      );

      // 역으로 desktop page에서 overlay result를 부르면 거절된다(authorize가 overlay
      // sender만 받는다).
      const spoofedResult = await shell.evaluate(`(async () => {
        try {
          return await window.lophnShell.result({
            surfaceId: "spoofed",
            generation: 1,
            type: "closed",
          });
        } catch {
          return { ok: false, error: { code: "unavailable", message: "thrown" } };
        }
      })()`);
      assert(
        typeof spoofedResult === "object" && spoofedResult !== null &&
          "ok" in spoofedResult,
        `spoofed result 실패: ${JSON.stringify(spoofedResult)}`,
      );
      assertEquals(
        (spoofedResult as { ok: boolean }).ok,
        false,
        "desktop renderer의 spoofed result가 통과했다",
      );
    } finally {
      await shell.close();
      await Deno.remove(home, { recursive: true });
    }
  },
});

Deno.test({
  name:
    "e2e shell/desktop#R16: shell·overlay renderer에서 사람 token과 DB 파일에 직접 접근할 수 없다",
  ignore: !e2eEnabled(),
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const { home, shell, overlay } = await launchWithOverlay();
    try {
      await waitFor(
        overlay.evaluate,
        `document.getElementById("root")?.classList.length > 0`,
        true,
      );
      // renderer에서 fetch로 lophn-shell 밖 origin을 부를 수 없다(CSP connect-src 'self').
      const fetchProbe = await shell.evaluate(`(async () => {
        try {
          const response = await fetch("http://127.0.0.1:9/lophn-token");
          return response.ok ? "reachable" : "blocked";
        } catch {
          return "failed";
        }
      })()`);
      assertEquals(
        fetchProbe,
        "failed",
        "renderer에서 밖 origin fetch가 통과했다",
      );

      // lophnShell·lophnCore에서 token 모양은 없다. preload가 노출한 함수만 있다.
      const tokenProbe = await overlay.evaluate(`(() => {
        const collect = (object) => {
          try {
            return Object.getOwnPropertyNames(object ?? {}).flat();
          } catch {
            return [];
          }
        };
        return {
          shellKeys: collect(window.lophnShell),
          coreKeys: collect(window.lophnCore),
          token: typeof window.token,
          accessToken: typeof window.accessToken,
          persons: typeof window.persons,
          database: typeof window.database,
          db: typeof window.db,
        };
      })()`);
      assert(
        typeof tokenProbe === "object" && tokenProbe !== null,
        `token probe 실패: ${JSON.stringify(tokenProbe)}`,
      );
      const result = tokenProbe as {
        shellKeys: string[];
        coreKeys: string[];
        token: string;
        accessToken: string;
        persons: string;
        database: string;
        db: string;
      };
      assertEquals(result.shellKeys, ["open", "close", "result", "subscribe"]);
      assertEquals(result.coreKeys, ["subscribe", "call"]);
      assertEquals(result.token, "undefined");
      assertEquals(result.accessToken, "undefined");
      assertEquals(result.persons, "undefined");
      assertEquals(result.database, "undefined");
      assertEquals(result.db, "undefined");
    } finally {
      await shell.close();
      await Deno.remove(home, { recursive: true });
    }
  },
});
