// 받은 메시지의 보낸 쪽 chip이 읽는 것(근거 링크, 보낸 session)과 tool 호출의 입력·결과 본문. 대화 줄은
// ACP snapshot이 주므로 여기서 만들지 않는다. 한 번 읽으면 바뀌지 않는 값은 기억한다.
import type { AgentId } from "../../../protocol/lophn-agent/workspaces.ts";
import {
  type ReceivedMessage,
  receivedMessageRead,
} from "../../../protocol/lophn-agent/received-messages.ts";
import { turnBodyView } from "../../../protocol/lophn-agent/turn-reads.ts";
import type {
  Envelope,
  EvidenceRef,
  Sender,
  SourceResult,
  ToolCallBodyView,
} from "./agent-tab-source.ts";
import type { Env } from "./agent-tab-core-source-env.ts";
import { agentNameOf, readSession } from "./agent-tab-core-source-sessions.ts";

/** 한 번 읽으면 바뀌지 않는 값. */
interface BodiesMemo {
  readonly agents: Map<string, AgentId>;
  /** `<종류>:<id>` → tool 호출의 입력·결과 본문. */
  readonly views: Map<string, ToolCallBodyView>;
}

export function createBodiesMemo(): BodiesMemo {
  return {
    agents: new Map(),
    views: new Map(),
  };
}

// ---------------------------------------------------------------- 보낸 쪽

async function agentOf(
  env: Env,
  memo: BodiesMemo,
  session: string,
): Promise<AgentId | null> {
  const known = memo.agents.get(session);
  if (known !== undefined) return known;
  const read = await readSession(env, session);
  if (!read.ok) return null;
  memo.agents.set(session, read.value.agent);
  return read.value.agent;
}

/** 이름은 chip을 누를 때 읽는다(`withName`). 사람이 직접 쓴 메시지는 보낸 쪽이 없다. */
async function senderOf(
  env: Env,
  memo: BodiesMemo,
  from: ReceivedMessage["from"],
): Promise<Sender | null> {
  switch (from.kind) {
    case "human":
      return null;
    case "program":
      return { kind: "program", label: null };
    case "app":
      return { kind: "app", app: from.app, name: from.slug };
    default: {
      const agent = await agentOf(env, memo, from.session);
      return {
        kind: "agent",
        agent,
        name: agent === null ? null : await agentNameOf(env, agent),
      };
    }
  }
}

async function withName(
  env: Env,
  sender: Sender,
  from: ReceivedMessage["from"],
): Promise<Sender> {
  if (sender.kind !== "agent" || from.kind !== "agent") return sender;
  const session = await readSession(env, from.session);
  if (!session.ok) return sender;
  const name = await agentNameOf(env, session.value.agent);
  return name === null ? sender : { ...sender, name };
}

function refsOf(refs: ReceivedMessage["refs"]): EvidenceRef[] {
  return refs.map((ref): EvidenceRef => {
    switch (ref.kind) {
      case "file":
        return { kind: "file", text: ref.path, target: ref.path };
      case "session":
        return { kind: "session", text: ref.session, target: ref.session };
      case "annotation":
        return { kind: "annotation", text: ref.id, target: ref.id };
    }
  });
}

/** 보낸 쪽 chip을 누르면 읽는다: 근거 링크, 보낸 session. */
export async function readEnvelope(
  env: Env,
  memo: BodiesMemo,
  message: string,
): Promise<SourceResult<Envelope>> {
  const read = await env.read(receivedMessageRead, { message });
  if (!read.ok) return read;
  const { from, refs } = read.value.message;
  const base = await senderOf(env, memo, from);
  if (base === null) return { ok: false, code: "not_found" };
  const sender = await withName(env, base, from);
  let session: Envelope["session"] = null;
  if (from.kind === "agent") {
    const sent = await readSession(env, from.session);
    if (sent.ok) {
      session = { id: from.session, title: sent.value.title ?? "" };
    }
  }
  return {
    ok: true,
    value: { sender, refs: refsOf(refs), session },
  };
}

// ---------------------------------------------------------------- tool 호출

async function readToolCallBodyMemo(
  env: Env,
  memo: BodiesMemo,
  kind: "tool_call_input" | "tool_call_output",
  id: string,
): Promise<SourceResult<ToolCallBodyView>> {
  const key = `${kind}:${id}`;
  const known = memo.views.get(key);
  if (known !== undefined) return { ok: true, value: known };
  const read = await env.read(turnBodyView, { kind, id });
  if (!read.ok) return read;
  const view = { value: read.value.value, truncated: read.value.truncated };
  memo.views.set(key, view);
  return { ok: true, value: view };
}

/** call 줄을 펼칠 때 읽는 입력이나 결과. 실패는 그 code 그대로다. */
export function readToolCallBody(
  env: Env,
  memo: BodiesMemo,
  toolCall: string,
  part: "input" | "output",
): Promise<SourceResult<ToolCallBodyView>> {
  return readToolCallBodyMemo(
    env,
    memo,
    part === "input" ? "tool_call_input" : "tool_call_output",
    toolCall,
  );
}
