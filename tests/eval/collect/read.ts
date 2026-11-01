import { appList } from "../../../packages/protocol/apps/mod.ts";
import type { Route } from "../../../packages/protocol/base/mod.ts";
import { projectList } from "../../../packages/protocol/projects/mod.ts";
import {
  type AgentId,
  agentCallRead,
  agentList,
  type CallFailReason,
  type CallReply,
  type CallState,
  modelCallList,
  type Place,
  placeSessionRead,
  toolCallList,
  turnBodyView,
  turnList,
} from "../../../packages/protocol/lophn-agent/mod.ts";
import type { Core, Input, Output } from "../../support/core/mod.ts";
import type {
  CollectedModelCall,
  CollectedToolCall,
  PlaceName,
  SentCall,
  SessionRecord,
} from "../types.ts";
import { type BlobReader, readJsonBlob } from "./blob.ts";

export type ReadPort = Pick<Core, "tryCall">;

// 오류면 `route.name: code: message`로 던진다. allowNotFound면 not_found는 null이다.
async function read<R extends Route>(
  port: ReadPort,
  route: R,
  input: Input<R>,
  allowNotFound = false,
): Promise<Output<R> | null> {
  const result = await port.tryCall(route, input);
  if (result.ok) return result.value;
  if (allowNotFound && result.error.code === "not_found") return null;
  throw new Error(
    `${route.name}: ${result.error.code}: ${result.error.message}`,
  );
}

// next_cursor가 null일 때까지 이어 읽는다.
async function readAll<T>(
  page: (
    cursor: string | undefined,
  ) => Promise<{ items: T[]; next_cursor: string | null }>,
): Promise<T[]> {
  const all: T[] = [];
  let cursor: string | undefined;
  do {
    const { items, next_cursor } = await page(cursor);
    all.push(...items);
    cursor = next_cursor ?? undefined;
  } while (cursor !== undefined);
  return all;
}

type Names = {
  app: Map<string, string>;
  project: Map<string, string>;
  agent: Map<string, string>;
};

async function readNames(port: ReadPort): Promise<Names> {
  const apps = await readAll(async (cursor) => {
    const out = (await read(port, appList, { cursor }))!;
    return { items: out.apps, next_cursor: out.next_cursor };
  });
  const projects = await readAll(async (cursor) => {
    const out = (await read(port, projectList, { cursor }))!;
    return { items: out.projects, next_cursor: out.next_cursor };
  });
  const { agents } = (await read(port, agentList, {}))!;
  return {
    app: new Map(apps.map((a) => [a.id, a.name])),
    project: new Map(projects.map((p) => [p.id, p.name])),
    agent: new Map(agents.map((a) => [a.agent, a.name])),
  };
}

function placeOf(place: Place | null, names: Names): PlaceName | null {
  if (place === null) return null;
  const name = (place.kind === "app" ? names.app : names.project).get(place.id);
  return name === undefined ? null : { kind: place.kind, id: place.id, name };
}

const nameOf = (agent: AgentId, names: Names): string =>
  names.agent.get(agent) ?? agent;

type CallContent = {
  call?: string;
  state?: CallState;
  fail_reason?: CallFailReason;
};

async function readSession(
  port: ReadPort,
  session: string,
  since: number,
  names: Names,
  readBlob: BlobReader | undefined,
): Promise<SessionRecord | null> {
  const found = await read(
    port,
    placeSessionRead,
    { session: session as never },
    true,
  );
  if (found === null) return null;
  const { agent, place } = found.session;

  // t0보다 먼저 시작한 turn은 되살리기의 흔적이라 그 turn의 call과 함께 뺀다.
  const turns = (
    await readAll(async (cursor) => {
      const out = (await read(port, turnList, { session, cursor }))!;
      return { items: out.turns, next_cursor: out.next_cursor };
    })
  ).filter((t) => Date.parse(t.started_at) >= since);
  const kept = new Set(turns.map((t) => t.id));

  const modelCalls = (
    await readAll(async (cursor) => {
      const out = (await read(port, modelCallList, { session, cursor }))!;
      return { items: out.calls, next_cursor: out.next_cursor };
    })
  ).filter((c) =>
    c.turn === null ? Date.parse(c.started_at) >= since : kept.has(c.turn),
  );
  const model_calls: CollectedModelCall[] = [];
  for (const call of modelCalls) {
    model_calls.push({
      call,
      request:
        readBlob === undefined
          ? null
          : await readJsonBlob(readBlob, call.input),
    });
  }

  const toolCalls = (
    await readAll(async (cursor) => {
      const out = (await read(port, toolCallList, {
        session,
        cursor,
        limit: 100,
      }))!;
      return { items: out.tool_calls, next_cursor: out.next_cursor };
    })
  ).filter((c) => kept.has(c.turn));
  const tool_calls: CollectedToolCall[] = [];
  for (const call of toolCalls) {
    const input = await read(
      port,
      turnBodyView,
      { kind: "tool_call_input", id: call.id },
      true,
    );
    const output =
      call.output === null
        ? null
        : await read(
            port,
            turnBodyView,
            { kind: "tool_call_output", id: call.id },
            true,
          );
    tool_calls.push({
      call,
      input: input?.value ?? null,
      output: output?.value ?? null,
      body_truncated:
        (input?.truncated ?? false) || (output?.truncated ?? false),
    });
  }

  // 재시도에 밀린 행(다른 행의 retry_of가 가리키는 행)은 보낸 call로 세지 않는다.
  const superseded = new Set(
    tool_calls.map((t) => t.call.retry_of).filter((id) => id !== null),
  );
  const sent_calls: SentCall[] = [];
  for (const t of tool_calls) {
    if (t.call.tool !== "call.send" || superseded.has(t.call.id)) continue;
    sent_calls.push(await sentCall(port, t, sent_calls.length, names));
  }

  return {
    session,
    agent,
    agent_name: nameOf(agent, names),
    place: placeOf(place, names),
    turns,
    model_calls,
    tool_calls,
    sent_calls,
  };
}

async function sentCall(
  port: ReadPort,
  t: CollectedToolCall,
  order: number,
  names: Names,
): Promise<SentCall> {
  const input = (t.input ?? {}) as {
    to?: unknown;
    reply: CallReply;
    body: string;
  };
  const content = ((t.output as { content?: CallContent | null } | null)
    ?.content ?? {}) as CallContent;
  const sent: SentCall = {
    tool_call: t.call.id,
    order,
    to: input.to,
    reply: input.reply,
    body: input.body,
    outcome: t.call.outcome,
    call: content.call ?? null,
    state: content.state ?? null,
    fail_reason: content.fail_reason ?? null,
    record: null,
    receiver: null,
    receiver_name: null,
    receiver_session: null,
    receiver_place: null,
  };
  if (sent.call === null) return sent;
  const out = await read(
    port,
    agentCallRead,
    { call: sent.call as never },
    true,
  );
  if (out === null) return sent;
  const record = out.call;
  sent.record = record;
  sent.receiver_session = record.receiver_session;
  let to: { agent: AgentId; place: Place | null } | null = null;
  if (record.to.kind === "open_session") {
    const opened = await read(
      port,
      placeSessionRead,
      { session: record.to.session },
      true,
    );
    to = opened?.session ?? null;
  } else {
    to = record.to.agent;
  }
  if (to !== null) {
    sent.receiver = to.agent;
    sent.receiver_name = nameOf(to.agent, names);
    sent.receiver_place = placeOf(to.place, names);
  }
  return sent;
}

// roots에서 시작해 보낸 call의 받는 session을 따라가며 닿는 session을 모두 읽는다.
export async function collectSessions(
  deps: { port: ReadPort; readBlob?: BlobReader },
  roots: string[],
  since: string,
): Promise<SessionRecord[]> {
  const names = await readNames(deps.port);
  const t0 = Date.parse(since);
  const queue = [...roots];
  const visited = new Set(roots);
  const records: SessionRecord[] = [];
  for (let i = 0; i < queue.length; i++) {
    const record = await readSession(
      deps.port,
      queue[i],
      t0,
      names,
      deps.readBlob,
    );
    if (record === null) continue;
    records.push(record);
    for (const s of record.sent_calls) {
      const next = s.receiver_session;
      if (next !== null && !visited.has(next)) {
        visited.add(next);
        queue.push(next);
      }
    }
  }
  return records;
}
