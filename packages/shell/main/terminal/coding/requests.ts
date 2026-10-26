// core가 Gateway frame으로 보낸 coding 터미널 요청(open·input·stop)을 실행하고 결과와 끝을 core에 알린다.
// 이 frame은 renderer로 중계하지 않는다. plan의 env에 coding token이 있으므로 log와 오류에 plan을 넣지 않는다.
// 이 module은 frame 수신도 core client도 모른다. 호출하는 쪽(desktop wiring)이 `reportResult`·`reportExited`를
// 사람 token의 core client로 잇는다.
//
// harness의 전역 hook·skill은 열 때 `dry_run`으로 있는지만 보고, 없으면 사람에게 한 번 물은 뒤 등록한다
// (`terminal/agent/hook-install.ts`). 거절하면 hook 없이 연다. 묻거나 등록하다 실패해도 session 열기는 막지 않는다.
// 그 터미널의 hook은 shell main의 hook socket으로 온다. 여기서는 key를 plan env에 더하고 session에 묶는다.
//
// 첫 prompt는 plan이 argv면 이미 argv로 넘어갔고, paste_after_hook이면 core가 session 시작 hook을 받은 뒤
// 일반 `input`으로 보낸다. 화면 출력으로 준비를 짐작하지 않고 재전송·재spawn·resume도 없다.

import { accessSync, constants, statSync } from "node:fs";

import {
  type CodingTerminalRequest,
  codingTerminalRequestSchema,
} from "../../../../protocol/coding-agent/terminal-requests.ts";
import type { TerminalRuntime } from "../../../ipc/terminal.ts";
import type { HookInstaller } from "../agent/hook-install.ts";
import type { TerminalHooks } from "../agent/ingress.ts";
import type { Supervisor } from "../supervisor.ts";

type Failure = "spawn_failed" | "no_terminal" | "folder_missing" | "host_lost";

type ResultBody =
  | { request: string; ok: true; terminal_ref?: string }
  | { request: string; ok: false; reason: Failure };

type ExitedBody = {
  session: string;
  exit_code: number | null;
  reason: "exited" | "killed" | "host_lost";
};

type CodingTerminalDeps = {
  supervisor: Pick<Supervisor, "request" | "on" | "runtimes">;
  /** 사람이 그 탭에 focus해 있지 않을 때 풀린다. */
  focus: { whenFree(terminalRef: string): Promise<void> };
  reportResult(body: ResultBody): Promise<unknown>;
  reportExited(body: ExitedBody): Promise<unknown>;
  /** 전역 skill·hook 등록. 설치 경로를 모르거나 묻지 못하면 아무것도 하지 않는다. */
  installer: Pick<HookInstaller, "ensureRegistered">;
  /** 터미널 hook 길. 꺼져 있으면 없다. */
  hooks?: TerminalHooks;
  /** 터미널이 열렸다. 상태를 따라갈 제품을 알려 준다. */
  opened?(terminalRef: string, harness: string): void;
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
    deps.hooks?.revoke(entry.terminalRef);
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
      await deps.installer.ensureRegistered(plan.harness_id);
      // hook key는 shell main이 plan env에 더한다. core는 key를 모르고 plan은 log에 남지 않는다.
      const issued = deps.hooks?.issue() ?? null;
      const reply = await deps.supervisor.request({
        type: "open-coding",
        plan: issued === null
          ? plan
          : { ...plan, env: { ...plan.env, ...issued.env } },
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
      if (issued !== null) {
        deps.hooks?.bind(issued.key, reply.runtime.terminal_ref, plan.session);
      }
      deps.opened?.(reply.runtime.terminal_ref, plan.harness_id);
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
