// TasksSource를 main의 통로로 만든다. Task 읽기·취소·생성은 core의 사람 credential(renderer allowlist의
// read·command)이고, [Start]·TUI 상태·감지된 harness·등록 폴더는 main IPC(`lophnCoding`)다. 응답은 main의
// contract client가 route output schema로 이미 검사했다. 아래 모양은 그 schema에서 이 화면이 읽는 field만
// 옮긴 것이다. 취소·생성은 사람이 누르는 것이 허락이라 확인 창이 없고 coding credential이 아니라 사람
// credential로 간다.
import { t } from "@lophn/wording";

import type { CodingApi } from "../../../../ipc/coding.ts";
import type { CoreCall } from "../../../../ipc/core.ts";
import type { CoreSource } from "../../../desktop/connection/connection.ts";
import type {
  ConnectionChoice,
  SourceResult,
  TaskCheck,
  TaskCondition,
  TaskDetail,
  TaskRow,
  TasksSource,
  TuiSession,
} from "./source.ts";

/** 목록을 끝까지 모을 때 page 상한. 넘으면 모은 것까지만 보인다. */
const PAGE_LIMIT = 10;

interface ScreenSummary {
  id: string;
  app: string;
  kind: "implementation" | "repair";
  title: string;
  request: string;
  problem_count: number;
  screen_state: TaskRow["state"];
  next_action: TaskRow["next"];
}

interface ScreenDetail extends ScreenSummary {
  why: string;
  needs: string[];
  claim: { expires_at: string } | null;
  conditions: { position: number; kind: TaskCondition["kind"] }[];
  completion: unknown | null;
  checks: { condition: number; result: TaskCheck["result"] }[];
  remaining: number[];
  revision: string;
}

interface ConnectionValue {
  id: string;
  label: string;
  scope: { kind: "all"; app: null } | { kind: "app"; app: string };
  state: "active" | "revoked";
}

async function call<T>(
  core: CoreSource,
  kind: CoreCall["kind"],
  resource: string,
  method: string,
  body: unknown,
): Promise<SourceResult<T>> {
  const reply = await core.call({ kind, resource, method, body });
  if (!reply.ok) return { ok: false, code: reply.error?.code ?? "internal" };
  return { ok: true, value: reply.value as T };
}

function rowOf(value: ScreenSummary): TaskRow {
  return {
    id: value.id,
    app: value.app,
    kind: value.kind,
    title: value.title,
    request: value.request,
    problemCount: value.problem_count,
    state: value.screen_state,
    next: value.next_action,
  };
}

function detailOf(value: ScreenDetail): TaskDetail {
  return {
    ...rowOf(value),
    why: value.why,
    needs: value.needs,
    revision: value.revision,
    heldUntil: value.claim?.expires_at ?? null,
    conditions: value.conditions.map((condition) => ({
      position: condition.position,
      kind: condition.kind,
    })),
    reported: value.completion !== null,
    checks: value.checks.map((check) => ({
      condition: check.condition,
      result: check.result,
    })),
    remaining: value.remaining,
  };
}

export interface TasksDeps {
  /** main의 coding 통로. 없는 창에서는 시작·TUI 상태가 unavailable이다. */
  coding: CodingApi | undefined;
  /** 새 command의 idempotency key. 테스트가 고정한다. */
  key?: () => string;
}

export function coreTasksSource(
  core: CoreSource,
  deps: TasksDeps,
): TasksSource {
  const key = deps.key ?? (() => crypto.randomUUID());

  async function activeConnections(
    app: string,
  ): Promise<SourceResult<readonly ConnectionChoice[]>> {
    const found: ConnectionChoice[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < PAGE_LIMIT; page += 1) {
      const result: SourceResult<
        { connections: ConnectionValue[]; next_cursor: string | null }
      > = await call(
        core,
        "read",
        "coding_agent_connections",
        "list",
        { state: "active", ...(cursor === undefined ? {} : { cursor }) },
      );
      if (!result.ok) return result;
      for (const connection of result.value.connections) {
        if (
          connection.state === "active" &&
          (connection.scope.kind === "all" || connection.scope.app === app)
        ) {
          found.push({ id: connection.id, label: connection.label });
        }
      }
      if (result.value.next_cursor === null) break;
      cursor = result.value.next_cursor;
    }
    return { ok: true, value: found };
  }

  return {
    async list(app) {
      const rows: TaskRow[] = [];
      let cursor: string | undefined;
      for (let page = 0; page < PAGE_LIMIT; page += 1) {
        const result: SourceResult<
          { tickets: ScreenSummary[]; next_cursor: string | null }
        > = await call(core, "read", "tickets", "screen_list", {
          app,
          ...(cursor === undefined ? {} : { cursor }),
        });
        if (!result.ok) return result;
        rows.push(...result.value.tickets.map(rowOf));
        if (result.value.next_cursor === null) break;
        cursor = result.value.next_cursor;
      }
      return { ok: true, value: rows };
    },

    async get(ticket) {
      const result = await call<{ ticket: ScreenDetail }>(
        core,
        "read",
        "tickets",
        "screen_detail",
        { ticket },
      );
      return result.ok
        ? { ok: true, value: detailOf(result.value.ticket) }
        : result;
    },

    async startChoices(app) {
      const coding = deps.coding;
      if (coding === undefined) return { ok: false, code: "unavailable" };
      const [detected, connections, folders] = await Promise.all([
        coding.detect(),
        activeConnections(app),
        coding.folders(),
      ]);
      if (!detected.ok) return { ok: false, code: detected.error.code };
      if (!connections.ok) return connections;
      if (!folders.ok) return { ok: false, code: folders.error.code };
      return {
        ok: true,
        value: {
          harnesses: detected.value.harnesses.filter((harness) =>
            harness.discovery === "detected"
          ).map((harness) => ({
            id: harness.harness_id,
            profile: harness.profile_id,
          })),
          connections: connections.value,
          folders: folders.value,
        },
      };
    },

    async sessions() {
      const coding = deps.coding;
      if (coding === undefined) return { ok: false, code: "unavailable" };
      const reply = await coding.sessions();
      if (!reply.ok) return { ok: false, code: reply.error.code };
      const sessions: TuiSession[] = reply.value.map((session) => ({
        ticket: session.ticket,
        tui: session.tui,
        promptDelivery: session.prompt_delivery,
      }));
      return { ok: true, value: sessions };
    },

    async start(press) {
      const coding = deps.coding;
      if (coding === undefined) return { ok: false, code: "unavailable" };
      const reply = await coding.start({
        ticket: press.ticket,
        ticket_revision: press.revision,
        connection: press.connection,
        harness_id: press.harness,
        profile_id: press.profile,
        project: press.project,
        folder_ref: press.folderRef,
      });
      if (!reply.ok) return { ok: false, code: reply.error.code };
      return {
        ok: true,
        value: reply.value.ok ? { ok: true } : {
          ok: false,
          reason: reply.value.reason,
          ownTerminal: reply.value.own_terminal,
        },
      };
    },

    async cancel(ticket, revision, reason) {
      const result = await call(core, "command", "tickets", "cancel", {
        input: { ticket, base_revision: revision, reason },
        idempotency_key: `tickets-cancel-${key()}`,
        compare: { base_revision: revision },
        prepared: [],
      });
      return result.ok ? { ok: true, value: null } : result;
    },

    async create(app, draft) {
      const result = await call<{ ticket: string }>(
        core,
        "command",
        "tickets",
        "create",
        {
          input: {
            app,
            kind: "implementation",
            title: draft.title,
            what: draft.what,
            why: draft.why,
            references: [],
            adoption_questions: [],
            conditions: [],
            inspect: [],
            preserve: [],
            problems: [],
            readiness: "needs_confirmation",
            // 채택과 확인 조건이 정해지기 전이라 준비 중이다. 가짜 근거를 채우지 않는다.
            needs: [t("app-detail.text.task-create-needs")],
          },
          idempotency_key: `tickets-create-${key()}`,
          compare: {},
          prepared: [],
        },
      );
      return result.ok
        ? { ok: true, value: { ticket: result.value.ticket } }
        : result;
    },
  };
}
