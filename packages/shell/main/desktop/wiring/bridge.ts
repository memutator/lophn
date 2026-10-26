// browser bridge를 앱에 올린다. per-run 폴더, `$BROWSER` shim, unix socket 서버를 만들고
// terminal IPC에 줄 TerminalBridge를 돌려준다. 어느 단계든 실패하면 bridge 없이 뜬다
// (shell 탭은 OS browser를 쓴다).
import { app, shell } from "electron";
import { randomBytes, randomUUID } from "node:crypto";
import {
  chmodSync,
  mkdirSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";

import { checkExternalUrl } from "../../app-frame/external-link.ts";
import { createBridge } from "../../browser-bridge/bridge.ts";
import {
  isRelayableUrl,
  LINK_SETTING_KEYS,
  linkPrefsOf,
} from "../../browser-bridge/policy.ts";
import { prepareRunDir } from "../../browser-bridge/run-dir.ts";
import { writeShim } from "../../browser-bridge/shim.ts";
import { listenBridge } from "../../browser-bridge/socket.ts";
import type { TerminalBridge } from "../../browser-bridge/types.ts";
import type { ShellContext } from "./context.ts";

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (cause) {
    return (cause as NodeJS.ErrnoException).code === "EPERM";
  }
}

export function createBridgeWiring(
  ctx: ShellContext,
): {
  bridge: TerminalBridge;
  /** bridge가 선 per-run 폴더. hook socket이 같은 폴더에 선다. 꺼졌으면 null. */
  runDir: Promise<string | null>;
  stop(): void;
} {
  // URL을 잃지 않으려고 bridge가 꺼져도 link 클릭은 OS browser로 연다.
  function openExternal(url: string) {
    if (checkExternalUrl(url) === undefined || ctx.headless.headless) return;
    shell.openExternal(url).catch(() =>
      ctx.log("cannot hand the link to the OS")
    );
  }
  const off = {
    bridge: {
      issue: () => null,
      bind() {},
      revoke() {},
      ack() {},
      openLink: ({ url }: { url: string }) => {
        if (isRelayableUrl(url)) openExternal(url);
        return Promise.resolve();
      },
    },
    runDir: Promise.resolve(null),
    stop() {},
  };
  if (process.platform === "win32") return off;

  // 두 번째 instance는 lock을 못 얻고 will-quit 없이 끝나므로, lock이 확정된 ready 뒤에야 폴더를 만든다.
  let runDir: string | null = null;
  let live: TerminalBridge | null = null;
  let stopped = false;
  let server: Promise<{ stop(): Promise<void> | void } | null> | null = null;
  let settleDir: (dir: string | null) => void = () => {};
  const runDirReady = new Promise<string | null>((resolve) =>
    settleDir = resolve
  );
  const removeDir = () => {
    if (runDir === null) return;
    try {
      rmSync(runDir, { recursive: true, force: true });
    } catch { /* 지우지 못해도 다음 실행이 정리한다 */ }
  };

  function setup() {
    if (stopped || !app.hasSingleInstanceLock()) return settleDir(null);
    const run = prepareRunDir({
      dataRoot: ctx.dataRoot,
      env: process.env,
      tmpdir: tmpdir(),
      uid: process.getuid!(),
      pid: process.pid,
      fs: {
        mkdir: (path, mode) => void mkdirSync(path, { recursive: true, mode }),
        chmod: chmodSync,
        list: (path) => {
          try {
            return readdirSync(path);
          } catch {
            return [];
          }
        },
        remove: (path) => rmSync(path, { recursive: true, force: true }),
      },
      isAlive,
    });
    if (!run.ok) {
      ctx.log(`browser bridge is off: ${run.error.message}`);
      return settleDir(null);
    }
    const { dir, socket, shim, script } = run.value;
    runDir = dir;

    try {
      writeShim(
        { write: (path, text, mode) => writeFileSync(path, text, { mode }) },
        { shim, script },
        process.execPath,
      );
    } catch (cause) {
      ctx.log(
        `browser bridge is off: cannot write the shim (${String(cause)})`,
      );
      removeDir();
      return settleDir(null);
    }

    const bridge = createBridge({
      paths: { socket, shim },
      env: process.env,
      ids: { key: () => randomBytes(32).toString("hex"), request: randomUUID },
      readPrefs: async () => {
        const listed = await ctx.coreInternal("memory", "settings", "list", {
          keys: Object.values(LINK_SETTING_KEYS),
        });
        return linkPrefsOf(listed.ok ? listed.value : undefined);
      },
      windows: () =>
        [...ctx.windows].filter((window) => !window.isDestroyed()).map((
          window,
        ) => window.webContents),
      openExternal,
      timers: {
        after: (ms, runLater) => {
          const timer = setTimeout(runLater, ms);
          return () => clearTimeout(timer);
        },
      },
      log: ctx.log,
    });

    // listen은 비동기라서 서버가 서기 전과 실패한 뒤에는 issue()가 null이다.
    server = listenBridge({
      socket,
      handleLine: bridge.handleLine,
      log: ctx.log,
    }).then((started) => {
      live = bridge;
      settleDir(dir);
      return started;
    }, (cause) => {
      ctx.log(`browser bridge is off: cannot listen (${String(cause)})`);
      removeDir();
      settleDir(null);
      return null;
    });
  }
  app.whenReady().then(setup).catch((cause) => {
    ctx.log(`browser bridge is off: ${String(cause)}`);
    settleDir(null);
  });

  const current = () => live ?? off.bridge;
  return {
    bridge: {
      issue: () => live && !stopped ? live.issue() : null,
      bind: (key, terminalRef) => current().bind(key, terminalRef),
      revoke: (terminalRef) => current().revoke(terminalRef),
      openLink: (input) => current().openLink(input),
      ack: (request, opened) => current().ack(request, opened),
    },
    runDir: runDirReady,
    stop() {
      stopped = true;
      // quit 직후 process가 바로 끝나서 비동기 정리가 돌지 못하므로 폴더부터 동기로 지운다.
      removeDir();
      void server?.then((started) => started?.stop()).catch(() => {});
    },
  };
}
