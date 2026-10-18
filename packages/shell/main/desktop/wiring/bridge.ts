// browser bridge를 앱에 올린다. per-run 폴더, `$BROWSER` shim, unix socket 서버를 만들고
// terminal IPC에 줄 TerminalBridge를 돌려준다. 어느 단계든 실패하면 bridge 없이 뜬다
// (shell 탭은 OS browser를 쓴다).
import { shell } from "electron";
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
import { LINK_SETTING_KEYS, linkPrefsOf } from "../../browser-bridge/policy.ts";
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
): { bridge: TerminalBridge | null; stop(): void } {
  if (process.platform === "win32") return { bridge: null, stop() {} };

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
    return { bridge: null, stop() {} };
  }
  const { dir, socket, shim, script } = run.value;
  const removeDir = () => {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch { /* 지우지 못해도 다음 실행이 정리한다 */ }
  };

  try {
    writeShim(
      { write: (path, text, mode) => writeFileSync(path, text, { mode }) },
      { shim, script },
      process.execPath,
    );
  } catch (cause) {
    ctx.log(`browser bridge is off: cannot write the shim (${String(cause)})`);
    removeDir();
    return { bridge: null, stop() {} };
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
    openExternal(url) {
      if (checkExternalUrl(url) === undefined || ctx.headless.headless) return;
      shell.openExternal(url).catch(() =>
        ctx.log("cannot hand the link to the OS")
      );
    },
    timers: {
      after: (ms, runLater) => {
        const timer = setTimeout(runLater, ms);
        return () => clearTimeout(timer);
      },
    },
    log: ctx.log,
  });

  // listen은 비동기라서 서버가 서기 전과 실패한 뒤에는 issue()가 null이다.
  let listening = false;
  let stopped = false;
  const server = listenBridge({
    socket,
    handleLine: bridge.handleLine,
    log: ctx.log,
  }).then((started) => {
    listening = true;
    return started;
  }, (cause) => {
    ctx.log(`browser bridge is off: cannot listen (${String(cause)})`);
    removeDir();
    return null;
  });

  return {
    bridge: {
      ...bridge,
      issue: () => listening && !stopped ? bridge.issue() : null,
    },
    stop() {
      stopped = true;
      void server.then((started) => started?.stop()).catch(() => {}).then(
        removeDir,
      );
    },
  };
}
