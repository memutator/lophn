// deno-lint-ignore-file no-control-regex -- 터미널 출력의 escape sequence를 지우려면 제어 문자를 세야 한다.
// eval에는 desktop shell이 없다. core가 Gateway로 보낸 `coding_terminal` frame으로 진짜 Claude Code를 PTY에서 띄우고,
// App Engineer의 답을 넣고, 끝나면 core에 알린다. 상태는 hook과 process exit로만 안다. 화면 글은 진단(`tail`)과 사람에게 보이는 데만 쓴다.
import type { Clock } from "../../../../packages/base/mod.ts";
import type { CodingTerminalRequest } from "../../../../packages/protocol/coding-agent/mod.ts";
import type { GatewayServerFrame } from "../../../../packages/protocol/events/mod.ts";
import { ticketShow } from "../../../../packages/protocol/coding-agent/ticket/mod.ts";
import { connectGateway, type Gateway } from "../../../support/gateway/mod.ts";
import type { Core } from "../../../support/core/mod.ts";
import type { CodingEnd, CodingTrace } from "../../types.ts";
import { evalPlan } from "./env.ts";
import { createFocusGate } from "./focus.ts";
import { createEvalTerminal } from "./host.ts";
import {
  DEFAULT_SOCKET_DIR,
  type Screen,
  serveScreen,
  socketPathOf,
} from "./screen.ts";

export type DriverDeps = {
  core: Core;
  clock: Clock;
  binDir: string;
  outDir: string;
  root: string;
  socketDir?: string;
  log: (line: string) => void;
  timeoutMs?: number;
  noSessionStartMs?: number;
};

export type CodingDriver = {
  active(): number;
  traces(): CodingTrace[];
  stop(): Promise<CodingTrace[]>;
};

const TICK_MS = 200;
const POLL_TICKET_MS = 2_000;
const EXIT_AFTER_REPORT_MS = 10_000; // Stop hook이 core에 닿을 시간
const KILL_AFTER_EXIT_MS = 15_000;
const TAIL_CHARS = 4000;

type LaunchPlan = Extract<CodingTerminalRequest, { kind: "open" }>["plan"];

type Live = {
  trace: CodingTrace;
  ref: string | null;
  generation: number;
  screen: Screen | null;
  openedMs: number | null;
  reportedMs: number | null;
  exitSentMs: number | null;
  lastPollMs: number;
  startSeen: boolean;
  busy: boolean;
  finished: Promise<void>;
};

// 제어 문자와 escape sequence를 뺀 글.
function plain(text: string): string {
  return text
    .replace(/\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)/g, "")
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/\u001b[()][A-Za-z0-9]/g, "")
    .replace(/\u001b./g, "")
    .replace(/\r/g, "")
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "");
}

export function startCodingDriver(deps: DriverDeps): CodingDriver {
  const { core, clock } = deps;
  const socketDir = deps.socketDir ?? DEFAULT_SOCKET_DIR;
  const timeoutMs = deps.timeoutMs ?? 90 * 60_000;
  const noSessionStartMs = deps.noSessionStartMs ?? 120_000;
  const gate = createFocusGate();
  const lives = new Map<string, Live>();
  const openRequests = new Map<string, string>(); // 요청 id → session
  const chains = new Map<string, Promise<void>>(); // session마다 frame을 순서대로 처리한다
  let failure: Error | undefined;
  let gateway: Gateway | undefined;
  let cursor = 0;

  const fail = (error: unknown) => {
    failure ??= error instanceof Error ? error : new Error(String(error));
    deps.log(`coding driver 오류: ${failure.message}`);
  };

  const terminal = createEvalTerminal({
    core,
    gate,
    onResult(body) {
      const session = openRequests.get(body.request);
      if (session === undefined) return;
      openRequests.delete(body.request);
      const live = lives.get(session)!;
      if (!body.ok) {
        live.trace.end ??= "open_failed";
        return;
      }
      live.trace.opened_at = clock.now();
      live.openedMs = clock.nowMs();
      try {
        live.screen = serveScreen({
          path: socketPathOf(socketDir, session),
          terminal,
          ref: live.ref!,
          generation: live.generation,
          gate,
          onKey() {
            if (live.trace.human_input) return;
            live.trace.human_input = true;
            deps.log(`사람이 coding agent에 키를 넣었다: ${session}`);
          },
        });
        live.trace.attach_socket = live.screen.path;
        deps.log(
          `coding agent 화면: deno task eval:attach ${session} (키 입력은 --write)`,
        );
      } catch (error) {
        fail(error);
      }
    },
  });

  async function tailOf(live: Live): Promise<string> {
    if (live.ref === null) return "";
    const reply = await terminal.host.handle({
      id: "driver",
      type: "snapshot",
      terminal_ref: live.ref,
      after_seq: 0,
    });
    if (!reply.ok || !("output" in reply)) return "";
    return plain(reply.output.map((item) => item.chunk).join(""))
      .slice(-TAIL_CHARS);
  }

  async function finish(live: Live): Promise<void> {
    live.trace.tail ||= await tailOf(live);
    await live.screen?.end(live.trace.end ?? "closed");
  }

  terminal.onRuntime((runtime) => {
    const info = runtime.coding_session;
    const live = info && lives.get(info.session);
    if (!live) return;
    live.ref = runtime.terminal_ref;
    live.generation = runtime.generation;
    if (live.trace.ended_at !== null) return;
    if (runtime.state === "exited") {
      live.trace.exit_code = runtime.exit_code;
      live.trace.end ??= runtime.exit_code === null ? "killed" : "exited";
    } else if (runtime.state === "unknown") {
      live.trace.end ??= "host_lost";
    } else return;
    live.trace.ended_at = clock.now();
    live.finished = finish(live);
  });

  // 끝난 이유를 먼저 적고 닫는다. 닫으면 buffer가 비므로 tail도 먼저 잡는다.
  async function closeSession(live: Live, end: CodingEnd): Promise<void> {
    if (live.ref === null || live.trace.ended_at !== null) return;
    live.trace.end ??= end;
    live.trace.tail ||= await tailOf(live);
    await terminal.request({
      type: "close",
      terminal_ref: live.ref,
      generation: live.generation,
    });
  }

  async function watch(live: Live): Promise<void> {
    const { trace } = live;
    if (
      live.busy || live.ref === null || live.openedMs === null ||
      trace.ended_at !== null || trace.end !== null
    ) return;
    live.busy = true;
    try {
      const now = clock.nowMs();
      if (now - live.openedMs >= timeoutMs) {
        return await closeSession(live, "timeout");
      }
      // trust 화면, login 화면, 잘못된 model flag 모두 hook이 안 도는 모양이다. 90분을 기다리지 않는다.
      if (!live.startSeen && now - live.openedMs >= noSessionStartMs) {
        const log = await Deno.readTextFile(trace.command_log).catch(() => "");
        live.startSeen = log.includes("\thook\tclaude\tSessionStart");
        if (!live.startSeen) {
          return await closeSession(live, "no_session_start");
        }
      }
      if (
        trace.reported_at === null && now - live.lastPollMs >= POLL_TICKET_MS
      ) {
        live.lastPollMs = now;
        const shown = await core.call(ticketShow, { ticket: trace.ticket });
        if (
          shown.ticket.state === "reported" || shown.ticket.state === "verified"
        ) {
          trace.reported_at = clock.now();
          live.reportedMs = now;
        }
      }
      // 완료 보고 뒤 사람이 /exit을 치는 것과 같다. 끝나야 core가 session을 정산한다.
      if (
        live.reportedMs !== null && live.exitSentMs === null &&
        now - live.reportedMs >= EXIT_AFTER_REPORT_MS
      ) {
        live.exitSentMs = now;
        await terminal.request({
          type: "input",
          terminal_ref: live.ref,
          generation: live.generation,
          text: "/exit\r",
        });
      }
      if (
        live.exitSentMs !== null && now - live.exitSentMs >= KILL_AFTER_EXIT_MS
      ) await closeSession(live, "killed");
    } catch (error) {
      fail(error);
    } finally {
      live.busy = false;
    }
  }

  function openLive(plan: LaunchPlan): Live {
    Deno.mkdirSync(deps.outDir, { recursive: true });
    const trace: CodingTrace = {
      session: plan.session,
      app: plan.app,
      ticket: plan.ticket,
      harness: plan.harness_id,
      cwd: plan.cwd,
      command_log: `${deps.outDir}/commands-${plan.session}.log`,
      attach_socket: "",
      human_input: false,
      opened_at: null,
      reported_at: null,
      ended_at: null,
      end: null,
      exit_code: null,
      tail: "",
    };
    const live: Live = {
      trace,
      ref: null,
      generation: 1,
      screen: null,
      openedMs: null,
      reportedMs: null,
      exitSentMs: null,
      lastPollMs: 0,
      startSeen: false,
      busy: false,
      finished: Promise.resolve(),
    };
    lives.set(plan.session, live);
    return live;
  }

  function route(
    frame: Extract<GatewayServerFrame, { type: "coding_terminal" }>,
  ): void {
    const request = frame.request;
    let session: string;
    let next: unknown = request;
    if (request.kind === "open") {
      session = request.plan.session;
      const live = openLive(request.plan);
      openRequests.set(request.request, session);
      // plan.env에 coding token이 있다. plan은 log·오류·trace에 넣지 않는다.
      next = {
        ...request,
        plan: evalPlan(request.plan, {
          daemonUrl: core.baseUrl,
          commandLog: live.trace.command_log,
          binDir: deps.binDir,
          path: Deno.env.get("PATH") ?? "",
        }),
      };
    } else {
      session = request.session;
      // 멈춤은 core가 시킨 것이다. SIGHUP으로 끝난 process가 exit code를 남겨도 exited로 적지 않는다.
      const live = lives.get(session);
      if (request.kind === "stop" && live) live.trace.end ??= "killed";
    }
    const previous = chains.get(session) ?? Promise.resolve();
    chains.set(
      session,
      previous.then(() => terminal.requests.handle(next)).catch(fail),
    );
  }

  const ready = connectGateway(core).then((connected) => {
    gateway = connected;
  }, fail);

  const timer = setInterval(() => {
    try {
      const frames = gateway?.frames() ?? [];
      while (cursor < frames.length) {
        const frame = frames[cursor++]!;
        if (frame.type === "coding_terminal") route(frame);
      }
      for (const live of lives.values()) void watch(live);
    } catch (error) {
      fail(error);
    }
  }, TICK_MS);

  return {
    active: () =>
      [...lives.values()].filter(({ trace }) =>
        trace.ended_at === null && trace.end === null
      ).length,
    traces: () => [...lives.values()].map(({ trace }) => ({ ...trace })),
    async stop() {
      clearInterval(timer);
      await ready;
      for (let pass = 0; pass < 2; pass++) {
        await Promise.all(
          [...lives.values()].map((live) => closeSession(live, "killed")),
        );
        await Promise.allSettled(chains.values());
      }
      await Promise.all([...lives.values()].map((live) => live.finished));
      await gateway?.close();
      if (failure) throw failure;
      return this.traces();
    },
  };
}
