// call 읽기와 취소, 그리고 대화에 놓이는 call 블록. 상태 구독은 없고 블록을 누를 때 읽는다. 블록은 이 session이 부른
// `call` tool의 입력과 결과에서 그린다.
import { callCancel, callRead } from "../../../protocol/lophn-agent/calls.ts";
import type {
  CallReply,
  CallStatus,
  CallView,
  SourceResult,
} from "./agent-tab-source.ts";
import { dropValue, type Env } from "./agent-tab-core-source-env.ts";
import { readSession, roleLabel } from "./agent-tab-core-source-sessions.ts";

export async function readCallState(
  env: Env,
  call: string,
): Promise<SourceResult<CallStatus>> {
  const read = await readCall(env, call);
  return read.ok ? { ok: true, value: read.value.status } : read;
}

async function readCall(
  env: Env,
  call: string,
): Promise<SourceResult<{ status: CallStatus; session: string | null }>> {
  const read = await env.read(callRead, { call });
  if (!read.ok) return read;
  const { state, fail_reason, receiver_session } = read.value.call;
  return {
    ok: true,
    value: {
      status: { state, reason: fail_reason },
      session: receiver_session,
    },
  };
}

/** 끝나지 않은 call을 취소한다. 끝난 call은 core가 conflict로 답한다. */
export function cancelCallOf(
  env: Env,
  call: string,
): Promise<SourceResult<void>> {
  return env.command(callCancel, {
    input: { call },
    compare: {},
    key: `calls-cancel-${call}`,
  }).then(dropValue);
}

// ---------------------------------------------------------------- call 블록

type Json = Record<string, unknown>;

export function asRecord(value: unknown): Json | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Json
    : null;
}

const CALL_ID = /cal_[0-7][0-9a-hjkmnp-tv-z]{25}/;

/** tool 결과(JSON) 안의 call id. 결과의 칸 이름에 기대지 않고 id 모양으로 찾는다. */
function callIdIn(output: unknown): string | null {
  return CALL_ID.exec(JSON.stringify(output) ?? "")?.[0] ?? null;
}

const REPLIES: readonly string[] = ["none", "result", "conversation"];

/** 받는 곳을 사람이 읽는 말로: "Operator · Eval analyst". */
async function toLabel(env: Env, to: Json): Promise<string> {
  if (typeof to["session"] === "string" && to["role"] === undefined) {
    const read = await readSession(env, to["session"]);
    if (!read.ok) return to["session"];
    const role = roleLabel(read.value.agent.role);
    return read.value.title === null ? role : `${role} · ${read.value.title}`;
  }
  const role = typeof to["role"] === "string"
    ? roleLabel(to["role"] as Parameters<typeof roleLabel>[0])
    : "";
  const place = asRecord(to["place"]);
  const where = typeof to["name"] === "string"
    ? to["name"]
    : typeof place?.["project"] === "string"
    ? place["project"]
    : typeof place?.["app"] === "string"
    ? place["app"]
    : "";
  return [role, where].filter((part) => part !== "").join(" · ");
}

/** `call` tool의 입력과 결과로 블록 하나를 만든다. 결과에 call id가 없으면(배달 전 실패) 블록이 없다. */
export async function callViewOf(
  env: Env,
  input: unknown,
  output: unknown,
): Promise<CallView | null> {
  const call = callIdIn(output);
  const given = asRecord(input);
  if (call === null || given === null) return null;
  const read = await readCall(env, call);
  if (!read.ok) return null;
  const body = typeof given["body"] === "string" ? given["body"] : "";
  const reply = typeof given["reply"] === "string" &&
      REPLIES.includes(given["reply"])
    ? given["reply"] as CallReply
    : "none";
  return {
    call,
    to: await toLabel(env, asRecord(given["to"]) ?? {}),
    task: body.split("\n")[0] ?? "",
    reply,
    status: read.value.status,
    session: read.value.session,
  };
}
