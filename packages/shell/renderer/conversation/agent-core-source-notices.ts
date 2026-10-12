// 대화 입력 위의 안내: provider를 쓸 수 없을 때와 마지막 run의 외부 연결 호출이 기다리거나
// 실패했을 때. 행동 하나만 말하고 확인된 시각만 적는다.
import type { AgentNotice, SourceResult } from "./agent-source.ts";
import {
  type AgentEnv,
  latestRun,
  runsOfSession,
} from "./agent-core-source-env.ts";

interface ProviderValue {
  id: string;
  name: string;
  credential: { state: string };
}

/** 외부 연결이 필요한 model 호출 하나. 이 화면이 읽는 field만이다. */
interface CallValue {
  state: "started" | "finished";
  started_at: string;
  attempt_order: number;
  attempt_kind: "initial" | "retry";
  model: { provider: string; name: string };
  outcome:
    | { kind: string; code: string | null; retry_at: string | null }
    | null;
}

type ExternalNotice = Extract<AgentNotice, { kind: "external" }>;

function newer(left: CallValue, right: CallValue): CallValue {
  if (left.attempt_order !== right.attempt_order) {
    return left.attempt_order > right.attempt_order ? left : right;
  }
  return left.started_at >= right.started_at ? left : right;
}

/**
 * 아직 끝나지 않은 호출이 있으면 기다림이 먼저이고, 끝난 호출은 가장 나중 하나만 본다. 연결 실패·기다림·
 * 결과 모름만 고르며 확정된 retry_at이 있을 때만 그 시각을 남긴다. 자동 retry는 사람에게 보이지 않는다.
 */
export function externalGuide(
  calls: readonly CallValue[],
  names: ReadonlyMap<string, string>,
): ExternalNotice | null {
  if (calls.length === 0) return null;
  const open = calls.filter((call) =>
    call.state === "started" || call.outcome === null
  );
  const focus = (open.length > 0 ? open : calls).reduce(newer);
  const named = names.get(focus.model.provider);
  const connection = named !== undefined && named.trim() !== ""
    ? named
    : focus.model.name;
  if (connection.trim() === "") return null;
  if (focus.state === "started" || focus.outcome === null) {
    if (focus.attempt_kind === "retry") return null;
    return {
      kind: "external",
      state: "waiting",
      connection,
      action: null,
      retryAt: null,
    };
  }
  if (focus.outcome.kind === "uncertain") {
    return {
      kind: "external",
      state: "unknown",
      connection,
      action: "check",
      retryAt: null,
    };
  }
  if (focus.outcome.kind === "failed" && focus.outcome.code === "temporary") {
    return {
      kind: "external",
      state: "connection-failed",
      connection,
      action: "reconnect",
      retryAt: focus.outcome.retry_at,
    };
  }
  return null;
}

export async function readNotices(
  env: AgentEnv,
  session: string | null,
): Promise<SourceResult<AgentNotice[]>> {
  const providers = await env.link.pages<ProviderValue>(
    "providers",
    "list",
    {},
    "providers",
  );
  if (!providers.ok) return providers;
  const notices: AgentNotice[] = [];
  if (!providers.value.some((item) => item.credential.state === "available")) {
    notices.push({ kind: "provider-lost" });
  }
  if (session === null) return { ok: true, value: notices };

  // 외부 연결 안내는 덤이다. 읽지 못하면 안내만 빠지고 나머지는 그대로다.
  const runs = await env.runsOf();
  if (!runs.ok) return { ok: true, value: notices };
  const run = latestRun(runsOfSession(runs.value, session));
  if (run === null) return { ok: true, value: notices };
  const calls = await env.link.pages<CallValue>(
    "model-calls",
    "list",
    { run: run.id },
    "calls",
  );
  if (!calls.ok) return { ok: true, value: notices };
  const guide = externalGuide(
    calls.value,
    new Map(providers.value.map((item) => [item.id, item.name])),
  );
  if (guide !== null) notices.push(guide);
  return { ok: true, value: notices };
}
