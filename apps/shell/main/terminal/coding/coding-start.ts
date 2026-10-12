// ticket [Start]의 main 쪽(shell/terminal#R4, R5, R12, R13). 사람 클릭 하나가 일회 human_start_handle과
// operation_id를 만들고, main이 core로 ticket 현재 판·connection·등록 폴더를 다시 읽어 `lophn session plan --json`
// child에 넘긴다. 받은 plan이 사람이 고른 harness·cwd와 다르면 거절하고 다른 것으로 대체하지 않는다. 그 plan을
// host에 넘기면 host가 PTY를 직접 연다. 같은 시작 요청의 재전달은 같은 runtime만 돌려준다.
// 이 module의 입구(click → issue → start)를 renderer에 여는 IPC와 [Start] 화면은 shell#T50이 붙인다.
//
// host가 먼저 보내는 관측 줄은 ObservationStore가 받는다. 관측이 없거나 낡았거나 host가 끝나면 unknown이고
// Electron 재시작은 빈 store라 unknown이다. 자동 spawn·resume·첫 prompt 재생은 이 module에 없다.

import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";

import {
  acceptObservation,
  type CodingAgentLaunchPlan,
  codingAgentLaunchPlanSchema,
  connectionIdSchema,
  connectionShowOutputSchema,
  harnessIdSchema,
  type HarnessSessionObservation,
  observationAt,
  observeEnvelopeSchema,
  sessionPlanGuideOutputSchema,
  type SessionPlanInput,
  sessionPlanInputSchema,
  ticketIdSchema,
  ticketScreenDetailOutputSchema,
  unknownObservation,
} from "../../../../../packages/protocol/coding-agent/mod.ts";
import { projectIdSchema } from "../../../../../packages/protocol/projects/values.ts";
import { seqSchema } from "../../../../../packages/protocol/platform/mod.ts";
import { z } from "zod";

import type { TerminalReply, TerminalRuntime } from "../../../ipc/terminal.ts";

/** [Start]를 누른 사람이 본 값이다. renderer는 이것만 보내고 main이 다시 검사한다. */
export const codingStartClickSchema = z.strictObject({
  ticket: ticketIdSchema,
  /** 사람이 본 ticket 판. 지금 판과 다르면 거절한다. */
  ticket_revision: seqSchema,
  connection: connectionIdSchema,
  harness_id: harnessIdSchema,
  profile_id: z.string().min(1).nullable(),
  project: projectIdSchema,
  folder_ref: z.string().min(1),
});

export type CodingStartClick = z.infer<typeof codingStartClickSchema>;

export type CodingStartRefusal =
  | "invalid_input"
  | "forbidden"
  | "folder_changed"
  | "ticket_changed"
  | "ticket_unavailable"
  | "connection_unavailable"
  | "plan_refused"
  | "plan_mismatch"
  | "host_refused";

export type CodingStartResult =
  | { ok: true; runtime: TerminalRuntime }
  | {
    ok: false;
    reason: CodingStartRefusal;
    message: string;
    /** 사람이 할 다음 행동. plan child가 낸 `details.next`를 그대로 옮긴다. */
    next: string[];
    /** 자기 터미널 안내(`own_terminal`). plan이 아니라 안내로 끝났을 때 있다. */
    guide?: unknown;
  };

type CoreResult =
  | { ok: true; value: unknown }
  | { ok: false; error: { code: string; message: string } };

export type PlanRunResult =
  | { ok: true; data: unknown }
  | {
    ok: false;
    error: { code: string; message: string; details?: unknown };
  };

/** `lophn session plan --json`을 부른다. plan은 spawn이 아니다. */
export type PlanRunner = (input: SessionPlanInput) => Promise<PlanRunResult>;

export type CodingStartDeps = {
  /** main이 user 자격으로 core를 읽는다(`CoreSession.internal`). */
  core: {
    internal(
      kind: string,
      resource: string,
      method: string,
      body: unknown,
    ): Promise<CoreResult>;
  };
  folders: {
    folders(
      project: string,
    ): Promise<readonly { folder_ref: string; path: string }[]>;
  };
  plan: PlanRunner;
  host: { request(message: unknown): Promise<TerminalReply> };
  /**
   * 설치된 helper `lophn-credential`의 절대 경로(loader identity). 주면 host가 TUI 아래 MCP·CLI process를
   * 관측해 main이 core에 등록한다(coding-children.ts). 없으면 그 child는 token을 받지 못한다.
   */
  credential_helper?: string;
  random?: () => string;
  now?: () => number;
  /** 발급한 handle이 쓰이지 않고 남는 시간. */
  handle_ttl_ms?: number;
};

export type CodingStart = {
  /** 사람 클릭을 받아 일회 handle과 operation_id를 만든다. */
  issue(
    click: unknown,
  ):
    | { ok: true; human_start_handle: string; operation_id: string }
    | { ok: false; reason: "invalid_input"; message: string };
  /** handle로 시작한다. 같은 handle의 재전달은 같은 결과다. */
  start(handle: string): Promise<CodingStartResult>;
};

const HANDLE_TTL_MS = 60_000;

function refuse(
  reason: CodingStartRefusal,
  message: string,
  next: string[] = [],
  guide?: unknown,
): CodingStartResult {
  return {
    ok: false,
    reason,
    message,
    next,
    ...(guide === undefined ? {} : { guide }),
  };
}

export function createCodingStart(deps: CodingStartDeps): CodingStart {
  const random = deps.random ?? (() => randomBytes(16).toString("hex"));
  const now = deps.now ?? Date.now;
  const ttl = deps.handle_ttl_ms ?? HANDLE_TTL_MS;
  const issued = new Map<
    string,
    {
      click: CodingStartClick;
      operation_id: string;
      issued_at: number;
      started?: Promise<CodingStartResult>;
    }
  >();

  async function run(
    handle: string,
    operationId: string,
    click: CodingStartClick,
  ): Promise<CodingStartResult> {
    // 1. 등록 폴더. 사람이 고른 folder_ref가 지금도 그 project의 등록 폴더여야 한다.
    const folders = await deps.folders.folders(click.project);
    const folder = folders.find((item) => item.folder_ref === click.folder_ref);
    if (!folder) {
      return refuse("folder_changed", "registered folder is not available", [
        "등록 폴더를 다시 고른다",
      ]);
    }
    // 2. ticket 현재 판.
    const ticketRead = await deps.core.internal(
      "read",
      "tickets",
      "screen_detail",
      {
        ticket: click.ticket,
      },
    );
    const ticketOut = ticketRead.ok
      ? ticketScreenDetailOutputSchema.safeParse(ticketRead.value)
      : undefined;
    if (!ticketOut?.success) {
      return refuse("ticket_unavailable", "ticket cannot be read", [
        "ticket을 다시 읽는다",
      ]);
    }
    const ticket = ticketOut.data.ticket;
    if (ticket.revision !== click.ticket_revision) {
      return refuse("ticket_changed", "ticket changed after the click", [
        "바뀐 ticket을 확인한 뒤 다시 [Start]를 누른다",
      ]);
    }
    // 3. connection 현재 상태와 범위.
    const connectionRead = await deps.core.internal(
      "read",
      "coding_agent_connections",
      "show",
      { connection: click.connection },
    );
    const connectionOut = connectionRead.ok
      ? connectionShowOutputSchema.safeParse(connectionRead.value)
      : undefined;
    if (!connectionOut?.success) {
      return refuse("connection_unavailable", "connection cannot be read", [
        "연결을 확인한다",
      ]);
    }
    const connection = connectionOut.data.connection;
    // 4. plan child. 사람이 고른 harness·profile·folder·cwd와 다시 읽은 사실만 넘긴다.
    const input = sessionPlanInputSchema.safeParse({
      ticket: click.ticket,
      ticket_revision: ticket.revision,
      connection: click.connection,
      harness_id: click.harness_id,
      profile_id: click.profile_id,
      project: click.project,
      folder_ref: folder.folder_ref,
      cwd: folder.path,
      method: "terminal_tui",
      facts: {
        ticket_app: ticket.app,
        screen_state: ticket.screen_state,
        connection_state: connection.state,
        connection_scope: connection.scope,
        problems: ticket.problems,
        inspect: ticket.inspect,
      },
      human_start_handle: handle,
      operation_id: operationId,
    });
    if (!input.success) {
      return refuse("invalid_input", "start input is not valid");
    }
    const planned = await deps.plan(input.data);
    if (!planned.ok) {
      const details = planned.error.details as
        | { next?: unknown; guide?: unknown }
        | undefined;
      const next = Array.isArray(details?.next)
        ? details.next.filter((item): item is string =>
          typeof item === "string"
        )
        : [];
      return refuse(
        "plan_refused",
        planned.error.message,
        next,
        details?.guide,
      );
    }
    const guide = sessionPlanGuideOutputSchema.safeParse(planned.data);
    if (guide.success) {
      return refuse(
        "plan_refused",
        "lophn does not open this one",
        ["자기 터미널에서 안내대로 직접 시작한다"],
        guide.data.guide,
      );
    }
    const plan = (planned.data as { plan?: unknown } | null)?.plan;
    const parsed = codingAgentLaunchPlanSchema.safeParse(plan);
    if (!parsed.success || !sameTarget(parsed.data, input.data)) {
      return refuse("plan_mismatch", "plan does not match the chosen start");
    }
    // 5. host가 shell 없이 PTY를 직접 연다. host가 plan과 cwd를 한 번 더 검사한다.
    const reply = await deps.host.request({
      type: "open-coding",
      plan: parsed.data,
      ...(deps.credential_helper === undefined
        ? {}
        : { credential_helper: deps.credential_helper }),
      columns: 80,
      rows: 24,
    });
    if (!reply.ok) {
      return refuse("host_refused", reply.message, [
        "다시 [Start]를 눌러 새로 시작한다",
      ]);
    }
    return { ok: true, runtime: reply.runtime };
  }

  return {
    issue(raw) {
      const click = codingStartClickSchema.safeParse(raw);
      if (!click.success) {
        return {
          ok: false,
          reason: "invalid_input",
          message: "start click is not valid",
        };
      }
      const human_start_handle = `hsh_${random()}`;
      const operation_id = `op_${random()}`;
      issued.set(human_start_handle, {
        click: click.data,
        operation_id,
        issued_at: now(),
      });
      return { ok: true, human_start_handle, operation_id };
    },
    start(handle) {
      const record = issued.get(handle);
      if (!record) {
        return Promise.resolve(
          refuse("forbidden", "start handle is not valid"),
        );
      }
      // 한 번만 일을 한다. 재전달은 같은 일의 같은 결과를 받는다(같은 operation_id는 같은 runtime).
      if (record.started) return record.started;
      if (now() - record.issued_at > ttl) {
        issued.delete(handle);
        return Promise.resolve(refuse("forbidden", "start handle expired"));
      }
      record.started = run(handle, record.operation_id, record.click).catch(
        () => refuse("host_refused", "start failed", ["다시 시작한다"]),
      );
      return record.started;
    },
  };
}

// plan이 사람이 고른 대상과 같은지 본다. harness·profile·folder·cwd·ticket 판·connection을 다른 것으로
// 대체하지 않는다.
function sameTarget(
  plan: CodingAgentLaunchPlan,
  input: SessionPlanInput,
): boolean {
  return plan.ticket === input.ticket &&
    plan.ticket_revision === input.ticket_revision &&
    plan.harness_id === input.harness_id &&
    plan.profile_id === (input.profile_id ?? null) &&
    plan.connection === input.connection &&
    plan.project === input.project &&
    plan.folder_ref === input.folder_ref &&
    plan.cwd === input.cwd &&
    plan.method === "terminal_tui" &&
    plan.human_start_handle === input.human_start_handle &&
    plan.operation_id === input.operation_id;
}

export type ExecFile = (
  file: string,
  args: string[],
  options: { env: Record<string, string>; timeout: number; maxBuffer: number },
) => Promise<{ code: number | null; stdout: string }>;

export const defaultExec: ExecFile = (file, args, options) =>
  new Promise((resolve) => {
    execFile(file, args, options, (error, stdout) => {
      const code = error === null
        ? 0
        : typeof (error as { code?: unknown }).code === "number"
        ? (error as { code: number }).code
        : null;
      resolve({ code, stdout: String(stdout) });
    });
  });

/**
 * `lophn session plan --json --input <json>` child다. 사람 전용 command라 `LOPHN_CONNECTION` 환경이면 거절하므로
 * 상속 환경에서 connection·관측 socket·credential 이름을 빼고 부른다. core를 읽지 않는 child다.
 */
export function childPlanRunner(options: {
  /** `lophn` 실행 파일 절대 경로. */
  command: string;
  env: Readonly<Record<string, string | undefined>>;
  exec?: ExecFile;
  timeout_ms?: number;
}): PlanRunner {
  const exec = options.exec ?? defaultExec;
  return async (input) => {
    const env: Record<string, string> = {};
    for (const [name, value] of Object.entries(options.env)) {
      if (value === undefined) continue;
      if (/^(LOPHN_CONNECTION|LOPHN_TERMINAL_OBSERVE)$/.test(name)) continue;
      if (/(TOKEN|SECRET|PASSWORD|CREDENTIAL)/i.test(name)) continue;
      env[name] = value;
    }
    const ran = await exec(
      options.command,
      [
        "session",
        "plan",
        "--json",
        "--input",
        JSON.stringify({ plan_input: input }),
      ],
      { env, timeout: options.timeout_ms ?? 15_000, maxBuffer: 1 << 20 },
    );
    let body: unknown;
    try {
      body = JSON.parse(ran.stdout);
    } catch {
      return {
        ok: false,
        error: { code: "unavailable", message: "plan child gave no result" },
      };
    }
    const failure = (body as { error?: unknown } | null)?.error as
      | { code?: unknown; message?: unknown; details?: unknown }
      | undefined;
    if (failure !== undefined) {
      return {
        ok: false,
        error: {
          code: typeof failure.code === "string" ? failure.code : "unavailable",
          message: typeof failure.message === "string"
            ? failure.message
            : "plan was refused",
          details: failure.details,
        },
      };
    }
    return { ok: true, data: (body as { data?: unknown } | null)?.data };
  };
}

/**
 * host가 보낸 관측 줄의 현재 상태 표다. runtime_ref·generation은 host가 붙인 값이다. 같은 runtime의 새 관측은
 * `acceptObservation`으로 받고 읽을 때는 `observationAt`으로 낡음을 반영한다. host가 끝나면 ended 아닌 것은
 * unknown이다. 이 process가 새로 뜨면 표가 비어 있어 모든 runtime이 unknown이다(자동 spawn·resume 없음).
 */
export type ObservationStore = {
  /** supervisor가 host에서 받은 줄. 올바른 observation 줄만 받는다. */
  onEvent(event: unknown): void;
  hostLost(): void;
  latest(runtime_ref: string): HarnessSessionObservation | null;
  current(
    runtime_ref: string,
  ): ReturnType<typeof observationAt>;
};

export function createObservationStore(
  options: { now(): string },
): ObservationStore {
  // host 하나가 끝나면 epoch가 바뀐다. 새 host의 같은 이름 runtime은 지난 host의 관측을 이어받지 않는다.
  let epoch = 0;
  const entries = new Map<
    string,
    {
      generation: number;
      observation: HarnessSessionObservation;
      epoch: number;
    }
  >();
  return {
    onEvent(event) {
      const line = event as
        | { event?: unknown; envelope?: unknown }
        | null;
      if (line?.event !== "observation") return;
      const parsed = observeEnvelopeSchema.safeParse(line.envelope);
      if (!parsed.success) return;
      const envelope = parsed.data;
      const known = entries.get(envelope.runtime_ref);
      const same = known !== undefined && known.epoch === epoch &&
        known.generation === envelope.generation;
      const base = same ? known.observation : null;
      const accepted = base === null
        ? envelope.observation
        : acceptObservation(base, envelope.observation);
      entries.set(envelope.runtime_ref, {
        generation: envelope.generation,
        observation: accepted,
        epoch,
      });
    },
    hostLost() {
      epoch++;
      for (const [ref, entry] of entries) {
        entries.set(ref, {
          ...entry,
          observation: unknownObservation(
            entry.observation,
            "terminal host가 끝나 지금 상태를 모른다",
          ),
        });
      }
    },
    latest(ref) {
      return entries.get(ref)?.observation ?? null;
    },
    current(ref) {
      return observationAt(
        entries.get(ref)?.observation ?? null,
        options.now(),
      );
    },
  };
}
