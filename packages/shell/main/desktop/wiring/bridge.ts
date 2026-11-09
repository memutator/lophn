// browser bridge를 앱에 올린다. per-run 폴더와 endpoint, `$BROWSER` shim, socket 서버를 만들고
// terminal IPC에 줄 TerminalBridge를 돌려준다. 폴더 준비만 `run`을 확정하고, shim·listen 실패는
// bridge만 끈다(hook은 그 폴더와 자기 endpoint를 계속 쓴다. shell 탭은 OS browser를 쓴다).
import { app, shell } from "electron";
import { execFile } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { checkExternalUrl } from "../../app-frame/external-link.ts";
import { createBridge } from "../../browser-bridge/bridge.ts";
import {
  isRelayableUrl,
  LINK_SETTING_KEYS,
  linkPrefsOf,
} from "../../browser-bridge/policy.ts";
import { prepareRunDir, type ShellRun } from "../../browser-bridge/run-dir.ts";
import { winLauncherFiles, writeShim } from "../../browser-bridge/shim.ts";
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

const execFileAsync = promisify(execFile);

// Windows 10·11에는 .NET Framework 4가 OS에 들어 있어 그 C# compiler로 launcher를 만든다.
function cscPath(): string | null {
  const windir = process.env.WINDIR ?? process.env.SystemRoot ?? "C:\\Windows";
  for (const framework of ["Framework64", "Framework"]) {
    const path = join(
      windir,
      "Microsoft.NET",
      framework,
      "v4.0.30319",
      "csc.exe",
    );
    if (existsSync(path)) return path;
  }
  return null;
}

/**
 * `<run>\browser-<hash>\browser.exe`를 돌려준다. 없으면 build하고, 다른 hash의 옛 launcher는 지운다.
 * exe는 마지막에 rename으로 놓으므로 exe가 있으면 browser.js도 다 쓰인 것이다.
 */
async function buildWinLauncher(parent: string): Promise<string> {
  const files = winLauncherFiles(process.execPath, (text) =>
    createHash("sha256").update(text).digest("hex"),
  );
  for (const name of readdirSync(parent)) {
    if (/^browser-[0-9a-f]{12}$/.test(name) && name !== files.name) {
      try {
        rmSync(join(parent, name), { recursive: true, force: true });
      } catch {
        /* 다른 터미널이 아직 쓰는 중이면 다음 실행이 지운다 */
      }
    }
  }
  const dir = join(parent, files.name);
  const exe = join(dir, "browser.exe");
  if (existsSync(exe)) return exe;
  const csc = cscPath();
  if (csc === null) throw new Error(".NET Framework csc.exe was not found");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "browser.js"), files.script);
  writeFileSync(join(dir, "browser.cs"), files.source);
  const built = join(dir, "browser.build.exe");
  await execFileAsync(
    csc,
    [
      "/nologo",
      "/target:exe",
      "/optimize+",
      `/out:${built}`,
      join(dir, "browser.cs"),
    ],
    { windowsHide: true },
  );
  renameSync(built, exe);
  return exe;
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

  async function setup() {
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

    let shim: string;
    try {
      if (process.platform === "win32") {
        shim = await buildWinLauncher(join(ctx.dataRoot, "run"));
      } else {
        writeShim(
          { write: (path, text, mode) => writeFileSync(path, text, { mode }) },
          { shim: run.shim, script: run.script },
          process.execPath,
        );
        shim = run.shim;
      }
    } catch (cause) {
      ctx.log(
        `browser bridge is off: cannot write the shim (${String(cause)})`,
      );
      return;
    }
    if (stopped) return;

    const bridge = createBridge({
      paths: { socket: run.bridgeSocket, shim },
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
