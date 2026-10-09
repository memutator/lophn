// 외부 연결이 필요한 model 호출의 마지막 사실. 연결 실패·기다림·결과 모름만 고르고,
// 확정된 retry_at이 있을 때만 그 시각을 남긴다. 목록을 읽지 못하면 null이다.
import type { CoreSource } from "../desktop/connection/connection.ts";

export interface GuideCall {
  readonly state: "started" | "finished";
  readonly startedAt: string;
  readonly attemptOrder: number;
  readonly providerId: string;
  readonly modelName: string;
  readonly outcome: {
    readonly kind: string;
    readonly code: string | null;
    readonly retryAt: string | null;
  } | null;
}

export interface ExternalGuide {
  readonly kind: "waiting" | "connection-failed" | "unknown";
  readonly connection: string;
  readonly action: "reconnect" | "check" | null;
  /** 확인된 다음 시도 시각. 없으면 null이고 화면은 시간을 세지 않는다. */
  readonly retryAt: string | null;
}

function newer(left: GuideCall, right: GuideCall): GuideCall {
  if (left.attemptOrder !== right.attemptOrder) {
    return left.attemptOrder > right.attemptOrder ? left : right;
  }
  return left.startedAt >= right.startedAt ? left : right;
}

function connectionOf(
  call: GuideCall,
  names: ReadonlyMap<string, string>,
): string {
  const named = names.get(call.providerId);
  if (named !== undefined && named.trim() !== "") return named;
  return call.modelName;
}

/** 아직 끝나지 않은 호출이 있으면 기다림이 먼저다. 끝난 호출은 가장 나중 하나만 본다. */
export function externalGuide(
  calls: readonly GuideCall[],
  names: ReadonlyMap<string, string>,
): ExternalGuide | null {
  if (calls.length === 0) return null;
  const open = calls.filter((call) =>
    call.state === "started" || call.outcome === null
  );
  const focus = (open.length > 0 ? open : calls).reduce(newer);
  const connection = connectionOf(focus, names);
  if (connection.trim() === "") return null;
  if (focus.state === "started" || focus.outcome === null) {
    return { kind: "waiting", connection, action: null, retryAt: null };
  }
  if (focus.outcome.kind === "uncertain") {
    return { kind: "unknown", connection, action: "check", retryAt: null };
  }
  if (
    focus.outcome.kind === "failed" && focus.outcome.code === "temporary"
  ) {
    return {
      kind: "connection-failed",
      connection,
      action: "reconnect",
      retryAt: focus.outcome.retryAt,
    };
  }
  return null;
}

const PAGE_LIMIT = 8;

function callOf(value: unknown): GuideCall | null {
  if (typeof value !== "object" || value === null) return null;
  const row = value as {
    state?: unknown;
    started_at?: unknown;
    attempt_order?: unknown;
    model?: { provider?: unknown; name?: unknown };
    outcome?: {
      kind?: unknown;
      code?: unknown;
      retry_at?: unknown;
    } | null;
  };
  if (row.state !== "started" && row.state !== "finished") return null;
  if (typeof row.started_at !== "string") return null;
  if (typeof row.attempt_order !== "number") return null;
  const modelName = row.model?.name;
  if (typeof modelName !== "string") return null;
  const providerId = typeof row.model?.provider === "string"
    ? row.model.provider
    : "";
  const outcome = row.outcome;
  if (outcome === null || outcome === undefined) {
    return {
      state: row.state,
      startedAt: row.started_at,
      attemptOrder: row.attempt_order,
      providerId,
      modelName,
      outcome: null,
    };
  }
  if (typeof outcome.kind !== "string") return null;
  return {
    state: row.state,
    startedAt: row.started_at,
    attemptOrder: row.attempt_order,
    providerId,
    modelName,
    outcome: {
      kind: outcome.kind,
      code: typeof outcome.code === "string" ? outcome.code : null,
      retryAt: typeof outcome.retry_at === "string" ? outcome.retry_at : null,
    },
  };
}

async function readPages(
  core: CoreSource,
  resource: string,
  method: string,
  body: Record<string, unknown>,
  key: string,
): Promise<unknown[] | null> {
  const rows: unknown[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < PAGE_LIMIT; page += 1) {
    let reply;
    try {
      reply = await core.call({
        kind: "read",
        resource,
        method,
        body: cursor === undefined ? body : { ...body, cursor },
      });
    } catch {
      return null;
    }
    if (!reply.ok) return null;
    const value = reply.value as Record<string, unknown>;
    const list = value[key];
    if (!Array.isArray(list)) return null;
    rows.push(...list);
    const next = value.next_cursor;
    if (typeof next !== "string" || next.length === 0) return rows;
    cursor = next;
  }
  return rows;
}

/** 이 대화의 model 호출과 사람이 보는 연결 이름으로 안내를 고른다. */
export async function loadExternalGuide(
  core: CoreSource,
  runId: string,
): Promise<ExternalGuide | null> {
  const listed = await readPages(
    core,
    "model-calls",
    "list",
    { run: runId },
    "calls",
  );
  if (listed === null) return null;
  const calls = listed.flatMap((row) => {
    const call = callOf(row);
    return call === null ? [] : [call];
  });
  const providers = await readPages(core, "providers", "list", {}, "providers");
  const names = new Map<string, string>();
  for (const row of providers ?? []) {
    if (typeof row !== "object" || row === null) continue;
    const item = row as { id?: unknown; name?: unknown };
    if (typeof item.id !== "string" || typeof item.name !== "string") continue;
    if (item.name.trim() === "") continue;
    names.set(item.id, item.name);
  }
  return externalGuide(calls, names);
}
