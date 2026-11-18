// extension이 띄우는 CLI의 spawn. core의 자식이라 core와 수명을 같이한다.
// env는 사람의 env(login shell에서 읽은 것) < (`lophn` launcher 폴더를 앞에 둔 PATH) < 넘긴 env다(`cliEnv`가 data root를 넣고 상위
// session 표지를 지운다). CLI는 자기 process group으로 띄우고 group째 끈다: CLI가 띄운 명령(tool, background task)이 CLI가 죽은
// 뒤에도 남지 않게 한다. 살아 있는 process는 `stopAll`이 core가 끝날 때 끈다.
import { spawn } from "node:child_process";
import { dirname, isAbsolute } from "node:path";
import { nodeTreeDeps, prependPath, signalTree } from "../../base/os/mod.ts";
import type { ExtensionSpawn } from "../../protocol/extensions/manifest.ts";
import { SESSION_ENV_NAME } from "../../protocol/lophn-agent/session-tag.ts";
import { SESSION_MARKER_NAME } from "../terminals/host/env.ts";
import type { PersonEnv } from "../terminals/ports.ts";

// SIGTERM 뒤 group에 남은 process를 SIGKILL하기까지 기다리는 시간이다.
const KILL_GRACE_MS = 3000;
// `exit` 뒤 `close`(stdio가 다 닫힘)를 기다리는 시간이다. CLI가 띄운 손자가 pipe를 물려받으면 `close`가 오지 않는다.
const DRAIN_MS = 250;

/**
 * extension이 띄우는 CLI(Agent SDK, `codex app-server`, headless harness)의 env. `given`은 extension이 넘긴 값(탭의 hook env,
 * adapter가 바꾸는 칸)이다. 상위 session 표지는 지운다. API key 같은 사용자 설정은 지우지 않는다.
 */
export function cliEnv(input: {
  base: Readonly<Record<string, string | undefined>>;
  dataRoot: string;
  given?: Readonly<Record<string, string>>;
}): Record<string, string> {
  // core가 물려받은 session 표지는 이 CLI의 것이 아니다. 탭의 표지는 `given`(탭의 env)으로만 들어온다.
  const { [SESSION_ENV_NAME]: _inherited, ...base } = input.base;
  const merged = {
    ...base,
    // 띄운 process의 `lophn`이 이 core에 닿게 data root를 늘 넣는다.
    LOPHN_HOME: input.dataRoot,
    ...input.given,
  };
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(merged)) {
    if (value === undefined || SESSION_MARKER_NAME.has(name)) continue;
    out[name] = value;
  }
  return out;
}

export function createSpawner(deps: { dataRoot: string; person: PersonEnv }) {
  const live = new Set<() => void>();
  let person: Record<string, string> | undefined;

  const start: ExtensionSpawn = (command, args, options) => {
    // `ready` 뒤에만 extension이 켜지므로 비어 있을 일은 없다.
    const base = person ?? {};
    const cli = deps.person.cli;
    const path =
      cli !== null && isAbsolute(cli)
        ? prependPath(base, dirname(cli), process.platform)
        : undefined;
    const child = spawn(command, [...args], {
      cwd: options?.cwd,
      env: cliEnv({
        base: path === undefined ? base : { ...base, [path.name]: path.value },
        dataRoot: deps.dataRoot,
        given: options?.env,
      }),
      detached: process.platform !== "win32",
    });
    // 죽는 사이 쓰면 EPIPE 같은 'error'가 오고, 처리하지 않으면 core가 죽는다.
    for (const stream of [child.stdin, child.stdout, child.stderr]) {
      stream.on("error", () => {});
    }
    const exits: Array<(code: number | null) => void> = [];
    const stderrs: Array<(text: string) => void> = [];
    let exited = false;
    const exit = (code: number | null) => {
      if (exited) return;
      exited = true;
      live.delete(kill);
      exits.forEach((listener) => listener(code));
    };
    // 시작하지 못하면 'error'가 오고, 원인(ENOENT, EACCES)은 stderr로 먼저 보낸다. 시작한 뒤의 'error'(kill 실패 등)는 exit가 아니다.
    child.on("error", (error) => {
      if (child.pid !== undefined) return;
      stderrs.forEach((listener) => listener(error.message));
      exit(null);
    });
    // `exit`는 stdout을 다 읽기 전에 올 수 있어 `close`(다 읽음)나 DRAIN_MS 중 먼저 온 때에 알린다.
    child.on("exit", (code) => {
      const timer = setTimeout(() => exit(code), DRAIN_MS);
      child.once("close", () => {
        clearTimeout(timer);
        exit(code);
      });
    });
    child.stderr.setEncoding("utf8").on("data", (text: string) => {
      if (!exited) stderrs.forEach((listener) => listener(text));
    });
    function kill() {
      if (child.pid === undefined) {
        child.kill("SIGTERM");
        return;
      }
      if (process.platform === "win32") {
        void signalTree(child.pid, "SIGTERM", "win32", nodeTreeDeps(spawn));
        return;
      }
      // CLI는 자기 process group의 leader라 group째 끊는다(CLI가 띄운 명령까지). SIGTERM을 무시하거나 멈춘 process가 남지 않게
      // 유예 뒤에도 group에 살아 있는 것이 있으면 SIGKILL을 보낸다.
      const group = -child.pid;
      try {
        process.kill(group, "SIGTERM");
      } catch {
        return; // 이미 끝난 group이다.
      }
      setTimeout(() => {
        try {
          process.kill(group, 0);
          process.kill(group, "SIGKILL");
        } catch {
          // 다 끝났다.
        }
      }, KILL_GRACE_MS).unref();
    }
    live.add(kill);
    return {
      pid: child.pid,
      write(text) {
        if (child.stdin.writable) child.stdin.write(text);
      },
      end() {
        if (child.stdin.writable) child.stdin.end();
      },
      kill,
      onStdout(listener) {
        child.stdout.setEncoding("utf8").on("data", (text: string) => {
          if (!exited) listener(text);
        });
      },
      onStderr: (listener) => void stderrs.push(listener),
      onExit: (listener) => void exits.push(listener),
    };
  };

  return {
    spawn: start,
    // spawn은 기다릴 수 없어 extension을 켜기 전에 사람의 env를 읽어 둔다.
    async ready(): Promise<void> {
      person ??= await deps.person.env();
    },
    // core가 끝나기 전에 동기로 보낸다.
    stopAll() {
      for (const kill of [...live]) kill();
    },
  };
}
