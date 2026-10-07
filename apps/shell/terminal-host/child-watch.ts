// lophn이 띄운 coding TUI 아래의 MCP·CLI process 관측(platform#T34 후속, platform/identity#R15).
// host는 TUI의 process tree를 짧은 간격으로 훑어 설치된 lophn MCP·CLI process가 나타나면 그 process
// generation(`<pid>.<시작 tick>`)과 loader identity(helper 절대 경로)를 main에 알린다. 사라지면 끝났다고,
// TUI가 끝나면 모두 끝났다고 알린다. main이 core에 등록·해제한다(host는 core에 닿지 않는다).
// 등록 대상은 이 TUI의 자손이면서 설치된 lophn 실행 모양과 정확히 같은 process뿐이다. 다른 TUI·일반 shell·
// 모델이 연 임의 process는 자손이어도 모양이 다르면, 자손이 아니면 모양이 같아도 등록하지 않는다.
// Linux(/proc)만 안다. 다른 OS는 table이 비어 아무것도 등록하지 않고 token 전달은 닫혀 있다.

import { readdirSync, readFileSync, readlinkSync } from "node:fs";
import { dirname } from "node:path";

export type ProcessEntry = { ppid: number; start_ticks: string | undefined };

export type ProcessIdentity = { exe: string | undefined; argv: string[] };

/** process table 읽기 port. 시험이 fake를 끼운다. */
export type ProcessTree = {
  /** 지금 있는 모든 process의 부모와 시작 tick. */
  entries(): ReadonlyMap<number, ProcessEntry>;
  /** 한 process의 실행 파일과 argv. 없어졌으면 undefined. */
  identity(pid: number): ProcessIdentity | undefined;
};

/** host가 main으로 먼저 보내는 child 줄이다. connection은 TUI를 연 plan의 값이다. */
export type ChildEvent =
  | {
    event: "child_started";
    runtime_ref: string;
    connection: string;
    process_generation: string;
    loader_identity: string;
  }
  | {
    event: "child_ended";
    runtime_ref: string;
    connection: string;
    process_generation: string;
  }
  | { event: "tui_ended"; runtime_ref: string; connection: string };

// 설치 launcher가 거는 deno flag 이름이다(packages/platform/install-and-update/linux-install.ts). 이 밖의
// flag(`--import-map`·`--eval`·`-A`·`--no-config` 등)가 붙은 process는 설치된 코드를 그대로 돌린다고 믿을 수 없다.
const DENO_FLAGS = new Set([
  "--cached-only",
  "--frozen",
  "--no-prompt",
  "--config",
  "--allow-read",
  "--allow-write",
  "--allow-env",
  "--allow-net",
  "--allow-run",
]);

/**
 * 설치된 lophn MCP·CLI process인지 본다. 실행 파일이 `<설치 root>/deno`이고 argv가 launcher의 모양
 * (`deno run <허용 flag…> <설치 root>/platform/apps/{mcp,cli}/main.ts …`)이어야 한다. 설치 root는 helper
 * 경로의 폴더다.
 */
export function isInstalledLoaderChild(
  identity: ProcessIdentity,
  loader: string,
): boolean {
  const root = dirname(loader);
  if (identity.exe !== `${root}/deno`) return false;
  const { argv } = identity;
  if (argv[1] !== "run") return false;
  let index = 2;
  for (; index < argv.length; index++) {
    const arg = argv[index]!;
    if (!arg.startsWith("--")) break;
    const name = arg.split("=", 1)[0]!;
    if (!DENO_FLAGS.has(name)) return false;
    if (name === "--config" && arg !== `--config=${root}/platform/deno.json`) {
      return false;
    }
  }
  const entry = argv[index];
  return entry === `${root}/platform/apps/mcp/main.ts` ||
    entry === `${root}/platform/apps/cli/main.ts`;
}

/** `<pid>.<시작 tick>`. 시작 tick을 읽지 못하면 pid만이다(coding-agent/connection/credential/helper.ts와 같은 값). */
export function processGeneration(
  pid: number,
  startTicks: string | undefined,
): string {
  return startTicks === undefined ? `${pid}` : `${pid}.${startTicks}`;
}

export type ChildWatch = {
  /** 한 번 훑는다. 시험과 주기 timer가 부른다. */
  poll(): void;
  /** 알려진 child를 모두 끝내고 TUI 종료를 알린다. 한 번만 일한다. */
  stop(): void;
};

export function createChildWatch(options: {
  tree: ProcessTree;
  /** TUI의 pid. 자손 판단의 뿌리다. */
  root: number;
  runtime_ref: string;
  connection: string;
  loader: string;
  emit(event: ChildEvent): void;
}): ChildWatch {
  const { runtime_ref, connection } = options;
  /** 등록한 child: pid → process generation. */
  const known = new Map<number, string>();
  let stopped = false;

  function descendants(
    entries: ReadonlyMap<number, ProcessEntry>,
  ): Set<number> {
    const found = new Set<number>();
    for (const pid of entries.keys()) {
      // 부모를 따라 올라가 root에 닿으면 자손이다. 고리·끊김은 자손이 아니다.
      const seen = new Set<number>();
      let at = pid;
      while (!seen.has(at)) {
        seen.add(at);
        const parent = entries.get(at)?.ppid;
        if (parent === undefined) break;
        if (parent === options.root) {
          found.add(pid);
          break;
        }
        at = parent;
      }
    }
    return found;
  }

  function end(pid: number): void {
    const generation = known.get(pid);
    known.delete(pid);
    if (generation === undefined) return;
    options.emit({
      event: "child_ended",
      runtime_ref,
      connection,
      process_generation: generation,
    });
  }

  const watch: ChildWatch = {
    poll() {
      if (stopped) return;
      const entries = options.tree.entries();
      if (!entries.has(options.root)) {
        watch.stop();
        return;
      }
      const alive = descendants(entries);
      for (const [pid, generation] of [...known]) {
        const entry = entries.get(pid);
        if (
          !alive.has(pid) || entry === undefined ||
          processGeneration(pid, entry.start_ticks) !== generation
        ) end(pid);
      }
      for (const pid of alive) {
        const entry = entries.get(pid)!;
        const generation = processGeneration(pid, entry.start_ticks);
        if (known.get(pid) === generation) continue;
        const identity = options.tree.identity(pid);
        // 매번 다시 읽는다: 같은 pid가 launcher shell에서 exec로 deno가 되므로 한 번 본 모양이 끝이 아니다.
        if (
          identity === undefined ||
          !isInstalledLoaderChild(identity, options.loader)
        ) continue;
        known.set(pid, generation);
        options.emit({
          event: "child_started",
          runtime_ref,
          connection,
          process_generation: generation,
          loader_identity: options.loader,
        });
      }
    },
    stop() {
      if (stopped) return;
      stopped = true;
      for (const pid of [...known.keys()]) end(pid);
      options.emit({ event: "tui_ended", runtime_ref, connection });
    },
  };
  return watch;
}

function startTicksOf(stat: string): string | undefined {
  // comm이 괄호 안이라 마지막 `)` 뒤에서 센다. starttime은 22번째 field다.
  const close = stat.lastIndexOf(")");
  if (close < 0) return undefined;
  const value = stat.slice(close + 2).split(" ")[19];
  return value !== undefined && /^\d+$/.test(value) ? value : undefined;
}

function ppidOf(stat: string): number | undefined {
  const close = stat.lastIndexOf(")");
  if (close < 0) return undefined;
  const value = Number(stat.slice(close + 2).split(" ")[1]);
  return Number.isInteger(value) ? value : undefined;
}

/** Linux /proc 기반 process table. 다른 OS는 비어 있다. */
export function procTree(
  platform: NodeJS.Platform = process.platform,
): ProcessTree {
  return {
    entries() {
      const out = new Map<number, ProcessEntry>();
      if (platform !== "linux") return out;
      let names: string[];
      try {
        names = readdirSync("/proc");
      } catch {
        return out;
      }
      for (const name of names) {
        if (!/^\d+$/.test(name)) continue;
        try {
          const stat = readFileSync(`/proc/${name}/stat`, "utf8");
          const ppid = ppidOf(stat);
          if (ppid !== undefined) {
            out.set(Number(name), { ppid, start_ticks: startTicksOf(stat) });
          }
        } catch {
          // 읽는 사이 끝난 process다.
        }
      }
      return out;
    },
    identity(pid) {
      if (platform !== "linux") return undefined;
      try {
        const argv = readFileSync(`/proc/${pid}/cmdline`, "utf8").split("\0");
        if (argv[argv.length - 1] === "") argv.pop();
        let exe: string | undefined;
        try {
          exe = readlinkSync(`/proc/${pid}/exe`);
        } catch {
          exe = undefined;
        }
        return { exe, argv };
      } catch {
        return undefined;
      }
    },
  };
}
