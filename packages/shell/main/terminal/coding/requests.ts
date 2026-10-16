// core가 Gateway frame으로 보낸 coding 터미널 요청(open·input·stop)을 실행하고 결과와 끝을 core에 알린다.
// 이 frame은 renderer로 중계하지 않는다. plan의 env에 coding token이 있으므로 log와 오류에 plan을 넣지 않는다.
// 이 module은 frame 수신도 core client도 모른다. 호출하는 쪽(desktop wiring)이 `reportResult`·`reportExited`를
// 사람 token의 core client로 잇는다.
//
// 첫 prompt는 plan이 argv면 이미 argv로 넘어갔고, paste_after_hook이면 core가 session 시작 hook을 받은 뒤
// 일반 `input`으로 보낸다. 화면 출력으로 준비를 짐작하지 않고 재전송·재spawn·resume도 없다.

import { accessSync, constants, statSync } from "node:fs";

import {
  type CodingTerminalRequest,
  codingTerminalRequestSchema,
} from "../../../../protocol/coding-agent/terminal-requests.ts";
import type { TerminalRuntime } from "../../../ipc/terminal.ts";
import type { Supervisor } from "../supervisor.ts";

type Failure = "spawn_failed" | "no_terminal" | "folder_missing" | "host_lost";

export type ResultBody =
  | { request: string; ok: true; terminal_ref?: string }
  | { request: string; ok: false; reason: Failure };

export type ExitedBody = {
  session: string;
  exit_code: number | null;
  reason: "exited" | "killed" | "host_lost";
};

export type CliRun = (
  args: string[],
) => Promise<{ ok: true; data: unknown } | { ok: false; message: string }>;

export type CodingTerminalDeps = {
  supervisor: Pick<Supervisor, "request" | "on" | "runtimes">;
  /** 사람이 그 탭에 focus해 있지 않을 때 풀린다. */
  focus: { whenFree(terminalRef: string): Promise<void> };
  reportResult(body: ResultBody): Promise<unknown>;
  reportExited(body: ExitedBody): Promise<unknown>;
  /** `lophn` CLI. 설치 경로를 모르면 null이고 skill·hook 설치는 건너뛴다. */
  runCli: CliRun | null;
  /** 새 coding 탭과 상태 변화를 창에 알린다. */
  publish?(runtime: TerminalRuntime): void;
  /** 앱 source 폴더가 디렉터리이고 읽을 수 있는지. 기본은 fs로 본다. */
  checkFolder?(path: string): boolean;
};

export type CodingTerminalRequests = {
  /** frame의 `request` 하나를 처리한다. 결과는 `reportResult`로 알린다. */
  handle(request: unknown): Promise<void>;
  /** session의 탭 runtime을 창에 다시 알리고 돌려준다. 탭이 없으면 undefined다. */
  reveal(session: string): TerminalRuntime | undefined;
};

type Entry = {
  terminalRef: string;
  generation: number;
  stopping: boolean;
  reported: boolean;
  ended: Promise<void>;
  end(): void;
};

// 붙여 넣기 구간으로 한 번에 쓰면 글 안의 줄바꿈이 제출이 되지 않는다. 제출은 마지막 CR 하나다.
const PASTE_START = "\u001b[200~";
const PASTE_END = "\u001b[201~";

function folderReadable(path: string): boolean {
  try {
    if (!statSync(path).isDirectory()) return false;
    accessSync(path, constants.R_OK | constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export function createCodingTerminalRequests(
  deps: CodingTerminalDeps,
): CodingTerminalRequests {
  // session → 터미널 탭 표. 탭은 끝나도 host가 살아 있는 동안 남는다.
  const sessions = new Map<string, Entry>();
  const opening = new Set<string>();
  const checkFolder = deps.checkFolder ?? folderReadable;

  function say(body: ResultBody): Promise<void> {
    return Promise.resolve(deps.reportResult(body)).then(() => undefined)
      .catch(() => undefined);
  }

  function fail(request: string, reason: Failure): Promise<void> {
    return say({ request, ok: false, reason });
  }

  function finish(
    session: string,
    entry: Entry,
    reason: ExitedBody["reason"],
    exitCode: number | null,
  ): void {
    if (entry.reported) return;
    entry.reported = true;
    entry.end();
    void Promise.resolve(
      deps.reportExited({ session, exit_code: exitCode, reason }),
    ).catch(() => undefined);
  }

  deps.supervisor.on({
    runtime(runtime) {
      const info = runtime.coding_session;
      if (info === undefined) return;
      deps.publish?.(runtime);
      const entry = sessions.get(info.session);
      if (entry === undefined || entry.terminalRef !== runtime.terminal_ref) {
        return;
      }
      if (runtime.state === "unknown") {
        finish(info.session, entry, "host_lost", null);
      } else if (runtime.state === "exited") {
        // 닫기 확인에서 온 runtime은 exit code가 아직 없다. 멈춘 것이다.
        const killed = entry.stopping || runtime.exit_code === null;
        finish(
          info.session,
          entry,
          killed ? "killed" : "exited",
          runtime.exit_code,
        );
      }
    },
    hostLost() {
      for (const [session, entry] of sessions) {
        finish(session, entry, "host_lost", null);
      }
    },
  });

  // skill과 hook이 없을 때 놓는다. 사람이 고친 파일은 CLI가 안 덮는다. 실패해도 TUI는 연다.
  async function install(harness: string, folder: string): Promise<void> {
    if (deps.runCli === null) return;
    try {
      await deps.runCli([
        "harness",
        "install",
        "--input",
        JSON.stringify({ harness, folder }),
      ]);
    } catch {
      // 설치 실패가 맡기기를 막지 않는다.
    }
  }

  async function open(
    request: string,
    plan: Extract<CodingTerminalRequest, { kind: "open" }>["plan"],
  ): Promise<void> {
    const known = sessions.get(plan.session);
    if (known !== undefined) {
      return await say({ request, ok: true, terminal_ref: known.terminalRef });
    }
    if (opening.has(plan.session)) return await fail(request, "spawn_failed");
    opening.add(plan.session);
    try {
      if (!checkFolder(plan.cwd)) return await fail(request, "folder_missing");
      await install(plan.harness_id, plan.cwd);
      const reply = await deps.supervisor.request({
        type: "open-coding",
        plan,
        columns: 80,
        rows: 24,
      });
      if (!reply.ok) {
        const reason = reply.reason;
        return await fail(
          request,
          reason === "host_lost"
            ? "host_lost"
            : reason === "not_directory" || reason === "unreadable" ||
                reason === "no_folder"
            ? "folder_missing"
            : "spawn_failed",
        );
      }
      let end = () => {};
      const ended = new Promise<void>((resolve) => end = resolve);
      sessions.set(plan.session, {
        terminalRef: reply.runtime.terminal_ref,
        generation: reply.runtime.generation,
        stopping: false,
        reported: false,
        ended,
        end,
      });
      await say({
        request,
        ok: true,
        terminal_ref: reply.runtime.terminal_ref,
      });
    } finally {
      opening.delete(plan.session);
    }
  }

  async function input(
    request: string,
    session: string,
    text: string,
  ): Promise<void> {
    const entry = sessions.get(session);
    if (entry === undefined || entry.reported) {
      return await fail(request, "no_terminal");
    }
    // 사람이 그 탭에 focus해 있으면 풀릴 때까지 쥐고 있다. 기한은 없다. 탭이 끝나면 풀린다.
    await Promise.race([deps.focus.whenFree(entry.terminalRef), entry.ended]);
    if (entry.reported) return await fail(request, "no_terminal");
    const reply = await deps.supervisor.request({
      type: "input",
      terminal_ref: entry.terminalRef,
      generation: entry.generation,
      text: `${PASTE_START}${text}${PASTE_END}\r`,
      from_core: true,
    });
    if (reply.ok) return await say({ request, ok: true });
    await fail(
      request,
      reply.reason === "host_lost" ? "host_lost" : "no_terminal",
    );
  }

  async function stop(request: string, session: string): Promise<void> {
    const entry = sessions.get(session);
    if (entry === undefined) return await fail(request, "no_terminal");
    entry.stopping = true;
    const reply = await deps.supervisor.request({
      type: "close",
      terminal_ref: entry.terminalRef,
      generation: entry.generation,
    });
    if (reply.ok && reply.runtime.state === "exited") {
      return await say({ request, ok: true });
    }
    await fail(request, "host_lost");
  }

  return {
    async handle(raw) {
      const parsed = codingTerminalRequestSchema.safeParse(raw);
      if (!parsed.success) {
        const id = (raw as { request?: unknown } | null)?.request;
        if (typeof id === "string" && id.length > 0) {
          await fail(id, "spawn_failed");
        }
        return;
      }
      const value = parsed.data;
      try {
        if (value.kind === "open") await open(value.request, value.plan);
        else if (value.kind === "input") {
          await input(value.request, value.session, value.text);
        } else await stop(value.request, value.session);
      } catch {
        await fail(
          value.request,
          value.kind === "open" ? "spawn_failed" : "no_terminal",
        );
      }
    },
    reveal(session) {
      const entry = sessions.get(session);
      if (entry === undefined) return undefined;
      const runtime = deps.supervisor.runtimes().find((item) =>
        item.terminal_ref === entry.terminalRef
      );
      if (runtime !== undefined) deps.publish?.(runtime);
      return runtime;
    },
  };
}
