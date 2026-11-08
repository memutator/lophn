// browser bridge를 앱에 올린다. per-run 폴더와 endpoint, `$BROWSER` shim, socket 서버를 만들고
// terminal IPC에 줄 TerminalBridge를 돌려준다. 폴더 준비만 `run`을 확정하고, shim·listen 실패는
// bridge만 끈다(hook은 그 폴더와 자기 endpoint를 계속 쓴다. shell 탭은 OS browser를 쓴다).
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
import { prepareRunDir, type ShellRun } from "../../browser-bridge/run-dir.ts";
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

export function createBridgeWiring(ctx: ShellContext): {
  bridge: TerminalBridge;
  /** per-run 폴더와 hook·bridge endpoint. 폴더가 준비되면 확정하고 꺼졌으면 null. */
  run: Promise<ShellRun | null>;
  stop(): void;
} {
  // URL을 잃지 않으려고 bridge가 꺼져도 link 클릭은 OS browser로 연다.
  function openExternal(url: string) {
    if (checkExternalUrl(url) === undefined || ctx.headless.headless) return;
    shell
      .openExternal(url)
      .catch(() => ctx.log("cannot hand the link to the OS"));
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
    run: Promise.resolve(null),
    stop() {},
  };

  // 두 번째 instance는 lock을 못 얻고 will-quit 없이 끝나므로, lock이 확정된 ready 뒤에야 폴더를 만든다.
  let folder: string | null = null;
  let live: TerminalBridge | null = null;
  let stopped = false;
  let server: Promise<{ stop(): Promise<void> | void } | null> | null = null;
  let settleRun: (run: ShellRun | null) => void = () => {};
  const runReady = new Promise<ShellRun | null>(
    (resolve) => (settleRun = resolve),
  );
  const removeDir = () => {
    if (folder === null) return;
    try {
      rmSync(folder, { recursive: true, force: true });
    } catch {
      /* 지우지 못해도 다음 실행이 정리한다 */
    }
  };

  function setup() {
    if (stopped || !app.hasSingleInstanceLock()) return settleRun(null);
    const prepared = prepareRunDir({
      platform: process.platform,
      dataRoot: ctx.dataRoot,
      env: process.env,
      tmpdir: tmpdir(),
      uid: process.getuid?.() ?? 0,
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
    if (!prepared.ok) {
      ctx.log(`browser bridge is off: ${prepared.error.message}`);
      return settleRun(null);
    }
    const run = prepared.value;
    folder = run.dir;
    // 폴더와 두 endpoint가 정해졌다. hook은 여기서부터 선다(bridge의 shim·listen을 기다리지 않는다).
    settleRun(run);

    try {
      writeShim(
        { write: (path, text, mode) => writeFileSync(path, text, { mode }) },
        { shim: run.shim, script: run.script },
        process.execPath,
        process.platform,
      );
    } catch (cause) {
      ctx.log(
        `browser bridge is off: cannot write the shim (${String(cause)})`,
      );
      return;
    }

    const bridge = createBridge({
      paths: { socket: run.bridgeSocket, shim: run.shim },
      env: process.env,
      ids: { key: () => randomBytes(32).toString("hex"), request: randomUUID },
      readPrefs: async () => {
        const listed = await ctx.coreInternal("memory", "settings", "list", {
          keys: Object.values(LINK_SETTING_KEYS),
        });
        return linkPrefsOf(listed.ok ? listed.value : undefined);
      },
      windows: () =>
        [...ctx.windows]
          .filter((window) => !window.isDestroyed())
          .map((window) => window.webContents),
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
      socket: run.bridgeSocket,
      platform: process.platform,
      handleLine: bridge.handleLine,
      log: ctx.log,
    }).then(
      (started) => {
        live = bridge;
        return started;
      },
      (cause) => {
        ctx.log(`browser bridge is off: cannot listen (${String(cause)})`);
        // shim·listen 실패는 hook이 쓰는 폴더와 endpoint를 건드리지 않는다.
        return null;
      },
    );
  }
  app
    .whenReady()
    .then(setup)
    .catch((cause) => {
      ctx.log(`browser bridge is off: ${String(cause)}`);
      settleRun(null);
    });

  const current = () => live ?? off.bridge;
  return {
    bridge: {
      issue: () => (live && !stopped ? live.issue() : null),
      bind: (key, terminalRef) => current().bind(key, terminalRef),
      revoke: (terminalRef) => current().revoke(terminalRef),
      openLink: (input) => current().openLink(input),
      ack: (request, opened) => current().ack(request, opened),
    },
    run: runReady,
    stop() {
      stopped = true;
      // quit 직후 process가 바로 끝나서 비동기 정리가 돌지 못하므로 자기 폴더부터 동기로 지운다.
      removeDir();
      void server?.then((started) => started?.stop()).catch(() => {});
    },
  };
}
