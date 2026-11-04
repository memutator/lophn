// extension registry를 shell main에 올린다. 켜진 extension만 load하고, core가 준비되면 한 번, 설정이 바뀔 때마다 맞춘다.
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import {
  mkdir,
  readdir,
  readFile,
  rm,
  rmdir,
  writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import { app } from "electron";

import {
  createIdSource,
  cryptoRandom,
  systemClock,
} from "../../../../base/mod.ts";
import type { ExtensionSpawn } from "../../../../protocol/extensions/mod.ts";
import {
  createExtensionRegistry,
  type ExtensionFiles,
} from "../../extensions/registry.ts";
import { packagedInstall } from "../paths.ts";
import type { Registered, ShellContext } from "./context.ts";

const nodeFiles: ExtensionFiles = {
  read: (path) => readFile(path, "utf8").catch(() => null),
  write: async (path, text) => {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, text);
  },
  list: (dir) => readdir(dir).catch(() => null),
  // rmdir는 빈 폴더만 지운다. file은 rm이 지운다.
  remove: async (path) => {
    try {
      await rm(path);
    } catch (cause) {
      const code = (cause as NodeJS.ErrnoException).code;
      if (code === "ENOENT") return;
      if (code !== "EISDIR" && code !== "EPERM") throw cause;
      await rmdir(path);
    }
  },
};

const nodeSpawn: ExtensionSpawn = (command, args, options) => {
  const child = spawn(command, [...args], {
    cwd: options?.cwd,
    env: { ...process.env, ...options?.env },
  });
  // 시작하지 못하면 'error'가 오고, 처리하지 않으면 main이 죽는다.
  const exits: Array<(code: number | null) => void> = [];
  child.on("error", () => exits.forEach((listener) => listener(null)));
  child.on("exit", (code) => exits.forEach((listener) => listener(code)));
  return {
    pid: child.pid,
    write: (text) => void child.stdin.write(text),
    kill: () => void child.kill(),
    onData(listener) {
      child.stdout.setEncoding("utf8").on("data", listener);
      child.stderr.setEncoding("utf8").on("data", listener);
    },
    onExit: (listener) => void exits.push(listener),
  };
};

export function register(ctx: ShellContext): Registered {
  const repoRoot = join(ctx.here, "..", "..", "..", "..");
  // packaged는 설치 root의 extensions/다. 아직 packaging이 채우지 않아 비어 있을 수 있다.
  const bundled = app.isPackaged
    ? join(packagedInstall(process.resourcesPath).root, "extensions")
    : join(ctx.here, "..", "extensions", "bundled");
  const clock = systemClock;
  const registry = createExtensionRegistry({
    roots: [bundled],
    dataRoot: ctx.dataRoot,
    productVersion: app.isPackaged
      ? app.getVersion()
      : JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8"))
          .version,
    files: nodeFiles,
    load: (path) => Promise.resolve(require(path)),
    core: {
      call: (kind, resource, method, input) =>
        ctx.coreInternal(kind, resource, method, input) as never,
    },
    settings: {
      async get(key) {
        const listed = await ctx.coreInternal("memory", "settings", "list", {
          keys: [key],
        });
        if (!listed.ok) return listed as never;
        const entries = (
          listed.value as {
            settings: { key: string; chosen?: unknown; default?: unknown }[];
          }
        ).settings;
        const entry = entries.find((e) => e.key === key);
        return {
          ok: true,
          value:
            entry === undefined
              ? undefined
              : "chosen" in entry
                ? entry.chosen
                : entry.default,
        };
      },
    },
    spawn: nodeSpawn,
    clock,
    ids: createIdSource({ clock, random: cryptoRandom }),
    log: ctx.log,
  });
  const sync = () =>
    void registry
      .sync()
      .catch((cause) => ctx.log(`extensions: ${String(cause)}`));

  ctx.relay.conditions.push({ types: ["SettingsChanged"] });
  ctx.relay.events.push((event) => {
    if (
      event.type === "SettingsChanged" &&
      event.payload.keys.some((key) => key.startsWith("extensions."))
    ) {
      sync();
    }
  });
  // core가 준비되면 한 번 맞춘다. 준비 신호를 main이 받는 길이 없어 상태를 본다(agent.ts와 같다).
  const startup = setInterval(() => {
    if (ctx.core.state.state === "starting") return;
    clearInterval(startup);
    if (ctx.core.state.state === "ready") sync();
  }, 1000);

  return {
    stop() {
      clearInterval(startup);
      void registry.stop();
    },
  };
}
