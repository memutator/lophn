// 한 session 화면(thread) snapshot: 받은 메시지, turn의 tool 줄·편집 카드·call 블록·질문 요약·끝 줄, 다음 turn을 기다리는
// 사람 메시지, 지금 turn, 사람이 답할 것. snapshot을 처음과 다시 붙을 때(와 turn이 끝났을 때)만 읽고 그 사이는 화면이
// agent event를 줄로 접는다. 줄 순서는 메시지의 created_seq이고, 메시지가 아닌 줄은 그 turn의 메시지에 맞춰 둔다.
// 본문과 끝난 tool 호출은 한 번 읽으면 바뀌지 않으므로 기억한다.
import { t } from "@lophn/wording";

import { askRead } from "../../../protocol/lophn-agent/ask-tool.ts";
import type { ReceivedMessage } from "../../../protocol/lophn-agent/received-messages.ts";
import { messageBody } from "../../../protocol/lophn-agent/messages.ts";
import { agentDefinitionRead } from "../../../protocol/lophn-agent/agent-definitions.ts";
import {
  receivedMessageList,
  receivedMessageRead,
} from "../../../protocol/lophn-agent/received-messages.ts";
import { toolCallList } from "../../../protocol/lophn-agent/tool-calls.ts";
import type { ToolCall } from "../../../protocol/lophn-agent/tool-values.ts";
import type { TurnRecord } from "../../../protocol/lophn-agent/turn-values.ts";
import {
  turnBodyView,
  turnList,
} from "../../../protocol/lophn-agent/turn-reads.ts";
import { sessionSnapshotsList } from "../../../protocol/events/snapshot.ts";
import type {
  AgentRole,
  AskedGroup,
  AskedQuestion,
  BodyPart,
  Envelope,
  EvidenceRef,
  QueuedView,
  Sender,
  SourceResult,
  ThreadEntry,
  ThreadHidden,
  ThreadMessage,
  ThreadView,
  TurnView,
} from "./agent-tab-source.ts";
import type { Env } from "./agent-tab-core-source-env.ts";
import { asRecord, callViewOf } from "./agent-tab-core-source-calls.ts";
import {
  groupAt,
  hiddenFacts,
  type HiddenGroup,
  readHiddenGroups,
} from "./agent-tab-core-source-rewind.ts";
import { readSession } from "./agent-tab-core-source-sessions.ts";

/** 한 번 읽으면 바뀌지 않는 값. */
interface ThreadMemo {
  readonly bodies: Map<string, readonly BodyPart[]>;
  readonly roles: Map<string, AgentRole>;
  /** `<종류>:<id>` → tool 호출의 입력·결과 본문. */
  readonly views: Map<string, unknown>;
}

export function createThreadMemo(): ThreadMemo {
  return {
    bodies: new Map(),
    roles: new Map(),
    views: new Map(),
  };
}

/** 한 번에 읽는 tool 호출 수의 상한. 넘으면 가장 나중 것부터 이만큼만 그린다. */
const TOOL_CALL_LIMIT = 100;

// ---------------------------------------------------------------- 본문과 보낸 쪽

/** 확정 메시지 하나의 본문. 시각 블록은 받은 값 그대로 넘기고 블록 renderer가 그리기 전에 검사한다. */
export async function readBody(
  env: Env,
  memo: ThreadMemo,
  message: string,
): Promise<SourceResult<readonly BodyPart[]>> {
  const known = memo.bodies.get(message);
  if (known !== undefined) return { ok: true, value: known };
  const read = await env.read(messageBody, { message });
  if (!read.ok) return read;
  const parts = read.value.content.parts.map((part): BodyPart => {
    switch (part.kind) {
      case "text":
        return { kind: "text", text: part.text };
      case "app_card":
        return { kind: "app_card", app: part.app, view: part.view };
    }
  });
  memo.bodies.set(message, parts);
  return { ok: true, value: parts };
}

function textOf(parts: readonly BodyPart[]): string {
  return parts.flatMap((part) => part.kind === "text" ? [part.text] : [])
    .join("\n");
}

async function roleOf(
  env: Env,
  memo: ThreadMemo,
  session: string,
): Promise<AgentRole | null> {
  const known = memo.roles.get(session);
  if (known !== undefined) return known;
  const read = await readSession(env, session);
  if (!read.ok) return null;
  memo.roles.set(session, read.value.agent.role);
  return read.value.agent.role;
}

/** 이름은 chip을 누를 때 읽는다(`withName`). 사람이 직접 쓴 메시지는 보낸 쪽이 없다. */
async function senderOf(
  env: Env,
  memo: ThreadMemo,
  from: ReceivedMessage["from"],
): Promise<Sender | null> {
  switch (from.kind) {
    case "human":
      return null;
    case "agent":
      return {
        kind: "agent",
        role: await roleOf(env, memo, from.session),
        name: null,
      };
    case "coding_agent":
      return { kind: "coding", product: null };
    case "program":
      return { kind: "program", label: null };
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
  const def = await env.read(agentDefinitionRead, {
    agent: session.value.agent,
  });
  return def.ok ? { ...sender, name: def.value.effective.name.value } : sender;
}

function refsOf(refs: ReceivedMessage["refs"]): EvidenceRef[] {
  return refs.map((ref): EvidenceRef => {
    switch (ref.kind) {
      case "ticket":
        return { kind: "ticket", text: ref.ticket, target: ref.ticket };
      case "file":
        return { kind: "file", text: ref.path, target: ref.path };
      case "session":
        return { kind: "session", text: ref.session, target: ref.session };
      case "annotation":
        return { kind: "annotation", text: ref.id, target: ref.id };
    }
  });
}

/** 보낸 쪽 chip을 누르면 읽는다: 맡긴 글, 근거 링크, 보낸 session. */
export async function readEnvelope(
  env: Env,
  memo: ThreadMemo,
  message: string,
): Promise<SourceResult<Envelope>> {
  const read = await env.read(receivedMessageRead, { message });
  if (!read.ok) return read;
  const { from, refs, id } = read.value.message;
  const body = await readBody(env, memo, id);
  if (!body.ok) return body;
  const base = await senderOf(env, memo, from);
  if (base === null) return { ok: false, code: "not_found" };
  const sender = await withName(env, base, from);
  let session: Envelope["session"] = null;
  if (from.kind === "agent" || from.kind === "coding_agent") {
    const sent = await readSession(env, from.session);
    if (sent.ok) {
      session = { id: from.session, title: sent.value.title ?? "" };
    }
  }
  return {
    ok: true,
    value: { sender, task: textOf(body.value), refs: refsOf(refs), session },
  };
}

// ---------------------------------------------------------------- 질문

/** 대기 중인 묶음의 질문 목록. 풀린 묶음은 not_found다. */
export async function readAskedQuestions(
  env: Env,
  session: string,
  toolCall: string,
): Promise<SourceResult<readonly AskedQuestion[]>> {
  const read = await env.read(askRead, { session, tool_call: toolCall });
  if (!read.ok) return read;
  return {
    ok: true,
    value: read.value.questions.map((question, index): AskedQuestion => ({
      id: `q${index + 1}`,
      header: question.header,
      question: question.question,
      options: question.options.map((option) => ({
        label: option.label,
        description: option.description,
      })),
      multiSelect: question.multiSelect,
    })),
  };
}

// ---------------------------------------------------------------- tool 호출

/** tool 호출의 입력이나 결과 본문. 사람 화면용으로 redaction을 거친 값이다. 읽지 못하면 null이다. */
async function viewOf(
  env: Env,
  memo: ThreadMemo,
  kind: "tool_call_input" | "tool_call_output",
  id: string,
): Promise<unknown> {
  const key = `${kind}:${id}`;
  if (memo.views.has(key)) return memo.views.get(key);
  const read = await env.read(turnBodyView, { kind, id });
  if (!read.ok) return null;
  memo.views.set(key, read.value.value);
  return read.value.value;
}

/** 이 session의 tool 호출 기록. 가장 나중 것부터 상한까지만 그린다. */
async function readToolCalls(env: Env, session: string): Promise<ToolCall[]> {
  const listed = await env.pages(
    toolCallList,
    { session },
    (out) => out.tool_calls,
  );
  return listed.ok ? listed.value.slice(-TOOL_CALL_LIMIT) : [];
}

function lineCount(text: unknown): number {
  return typeof text === "string" && text !== ""
    ? text.replace(/\n$/, "").split("\n").length
    : 0;
}

function turnOfCall(
  call: ToolCall,
  turns: readonly TurnRecord[],
): TurnRecord | undefined {
  const named = turns.find((turn) => turn.id === call.turn);
  if (named !== undefined) return named;
  const at = call.started_at ?? call.finished_at;
  if (at === null) return turns.at(-1);
  return turns.find((turn) =>
    turn.started_at <= at &&
    (turn.finished_at === null || at <= turn.finished_at)
  );
}

function lineOf(call: ToolCall): string {
  return call.outcome === null || call.outcome.kind === "success"
    ? call.tool
    : `${call.tool} (${call.outcome.kind})`;
}

/** 읽기 tool은 "Read N documents" 한 줄로, 나머지는 같은 tool이 이어지면 한 줄로 묶는다. */
function bucketOf(tool: string): string {
  return tool === "file.read" ? "documents" : tool;
}

async function askEntry(
  env: Env,
  memo: ThreadMemo,
  call: ToolCall,
  at: string,
): Promise<ThreadEntry | null> {
  const input = asRecord(await viewOf(env, memo, "tool_call_input", call.id));
  const output = asRecord(await viewOf(env, memo, "tool_call_output", call.id));
  const questions = Array.isArray(input?.["questions"])
    ? input["questions"] as unknown[]
    : [];
  const result = asRecord(output?.["content"]) ?? output;
  const answers = Array.isArray(result?.["answers"])
    ? result["answers"] as unknown[]
    : [];
  const outcome = result?.["outcome"];
  return {
    kind: "questions",
    id: call.id,
    at,
    group: call.id,
    outcome: outcome === "submitted" || outcome === "human_message"
      ? outcome
      : "cancelled",
    lines: questions.map((question, index) => {
      const answer = asRecord(answers[index]);
      const given = Array.isArray(answer?.["answer"])
        ? (answer["answer"] as unknown[]).filter((one) =>
          typeof one === "string"
        ).join(", ")
        : "";
      return {
        header: String(asRecord(question)?.["header"] ?? ""),
        answer: answer?.["status"] === "answered" && given !== ""
          ? given
          : null,
      };
    }),
  };
}

async function editEntry(
  env: Env,
  memo: ThreadMemo,
  call: ToolCall,
  at: string,
): Promise<ThreadEntry | null> {
  const input = asRecord(await viewOf(env, memo, "tool_call_input", call.id));
  const path = input?.["path"];
  if (typeof path !== "string") return null;
  const write = call.tool === "file.write";
  return {
    kind: "edit",
    id: call.id,
    at,
    edit: {
      id: call.id,
      document: path,
      path,
      added: lineCount(write ? input?.["content"] : input?.["new_string"]),
      removed: write ? 0 : lineCount(input?.["old_string"]),
    },
  };
}

/** turn마다 tool 줄·편집 카드·call 블록·질문 요약. 재시도한 호출은 마지막 시도 하나만 보인다. */
async function toolEntries(
  env: Env,
  memo: ThreadMemo,
  session: string,
  turns: readonly TurnRecord[],
): Promise<Map<string, ThreadEntry[]>> {
  const found = new Map<string, ThreadEntry[]>();
  const all = await readToolCalls(env, session);
  const retried = new Set(
    all.flatMap((call) => call.retry_of === null ? [] : [call.retry_of]),
  );
  let run: ToolCall[] = [];
  let runTurn: TurnRecord | undefined;
  const put = (turn: TurnRecord, entry: ThreadEntry) => {
    const list = found.get(turn.id) ?? [];
    list.push(entry);
    found.set(turn.id, list);
  };
  const flush = () => {
    const first = run[0];
    if (first === undefined || runTurn === undefined) {
      run = [];
      return;
    }
    const documents = bucketOf(first.tool) === "documents";
    put(runTurn, {
      kind: "tools",
      id: first.id,
      at: first.started_at ?? first.finished_at ?? runTurn.started_at,
      tool: {
        id: first.id,
        label: documents
          ? t("conversation.label.tool-read-documents", { count: run.length })
          : t("conversation.label.tool-used", {
            count: run.length,
            tool: first.tool,
          }),
        lines: run.map(lineOf),
      },
    });
    run = [];
  };
  for (const call of all) {
    if (retried.has(call.id)) continue;
    const turn = turnOfCall(call, turns);
    if (turn === undefined) continue;
    const at = call.started_at ?? call.finished_at ?? turn.started_at;
    const done = call.state === "finished";
    const ok = call.outcome?.kind === "success";
    let own: ThreadEntry | null = null;
    if (call.tool === "ask") {
      // 풀리지 않은 묶음은 `pending.questions`가 보인다.
      if (!done) continue;
      own = await askEntry(env, memo, call, at);
    } else if (call.tool === "call") {
      if (!ok) continue;
      const view = await callViewOf(
        env,
        await viewOf(env, memo, "tool_call_input", call.id),
        await viewOf(env, memo, "tool_call_output", call.id),
      );
      own = view === null
        ? null
        : { kind: "call", id: view.call, at, call: view };
    } else if (call.tool === "file.write" || call.tool === "file.edit") {
      if (!ok) continue;
      own = await editEntry(env, memo, call, at);
    }
    if (own !== null) {
      flush();
      put(turn, own);
      continue;
    }
    if (
      run.length > 0 &&
      (runTurn?.id !== turn.id ||
        bucketOf(run[0]!.tool) !== bucketOf(call.tool))
    ) flush();
    runTurn = turn;
    run.push(call);
  }
  flush();
  return found;
}

// ---------------------------------------------------------------- thread

function secondsBetween(from: string, to: string): number {
  return Math.max(0, Date.parse(to) - Date.parse(from));
}

function tailOf(turn: TurnRecord): ThreadEntry | null {
  if (turn.state !== "finished" || turn.outcome === null) return null;
  const at = turn.finished_at ?? turn.started_at;
  if (turn.outcome.kind === "failed") {
    return {
      kind: "provider-error",
      id: `error-${turn.id}`,
      at,
      turn: turn.id,
      code: turn.outcome.reason,
      message: turn.outcome.reason.replaceAll("_", " "),
    };
  }
  return {
    kind: "turn-end",
    id: `end-${turn.id}`,
    at,
    turn: turn.id,
    outcome: turn.outcome.kind === "completed" ? "completed" : "stopped",
    durationMs: secondsBetween(turn.started_at, at),
  };
}

function latestTurn(turns: readonly TurnRecord[]): TurnRecord | null {
  let latest: TurnRecord | null = null;
  for (const turn of turns) {
    if (latest === null || BigInt(turn.state_seq) > BigInt(latest.state_seq)) {
      latest = turn;
    }
  }
  return latest;
}

type Row =
  | { readonly kind: "message"; readonly entry: ThreadMessage }
  | { readonly kind: "hidden"; readonly entry: ThreadHidden };

/** 되돌린 구간 하나를 접은 줄. 숨긴 메시지는 펼치면 읽기만 한다. */
function hiddenEntry(
  group: HiddenGroup,
  inside: readonly ThreadMessage[],
): ThreadHidden {
  const facts = hiddenFacts(group);
  return {
    kind: "hidden",
    id: `hidden-${facts.checkpoint}`,
    at: inside[0]!.at,
    checkpoint: facts.checkpoint,
    choice: facts.choice,
    count: inside.length,
    restored: facts.restored,
    left: facts.left,
    entries: inside,
  };
}

export async function readThread(
  env: Env,
  memo: ThreadMemo,
  session: string,
): Promise<SourceResult<ThreadView>> {
  const [record, messages, turns, snapshot, hidden] = await Promise.all([
    readSession(env, session),
    env.pages(receivedMessageList, { session }, (out) => out.messages),
    env.pages(turnList, { session }, (out) => out.turns),
    env.read(sessionSnapshotsList, { sessions: [session] }),
    readHiddenGroups(env, session),
  ]);
  if (!record.ok) return record;
  if (!messages.ok) return messages;
  if (!turns.ok) return turns;
  if (!snapshot.ok) return snapshot;

  const turnById = new Map(turns.value.map((turn) => [turn.id, turn]));
  const current = latestTurn(turns.value);
  const running = current !== null && current.state === "running";
  const live = snapshot.value.snapshots[0];
  const permission = live?.permission_requests[0] ?? null;
  const asked = live?.questions[0] ?? null;

  // 사람이 도는 중에 다음 turn으로 보낸 메시지는 입력함에 있다.
  const queued: QueuedView[] = [];
  const entries: ThreadMessage[] = [];
  const hiddenIn = new Map<HiddenGroup, ThreadMessage[]>();
  const rows: Row[] = [];
  for (const message of messages.value) {
    const sender = await senderOf(env, memo, message.from);
    const own = message.from.kind === "agent" &&
      message.from.session === session;
    if (
      sender === null && message.turn === null &&
      message.delivery === "next_turn" && running
    ) {
      const body = await readBody(env, memo, message.id);
      queued.push({
        id: message.id,
        at: message.created_at,
        text: body.ok ? textOf(body.value) : "",
      });
      continue;
    }
    const entry: ThreadMessage = {
      kind: "message",
      id: message.id,
      at: message.created_at,
      actor: sender === null ? "user" : own ? "agent" : "received",
      sender: sender === null || own ? null : sender,
      call: message.call,
      replyTo: message.reply_to,
      delivery: message.delivery,
      turn: message.turn,
      text: null,
    };
    entries.push(entry);
    const group = groupAt(hidden, message.created_seq);
    if (group === undefined) {
      rows.push({ kind: "message", entry });
      continue;
    }
    const inside = hiddenIn.get(group);
    if (inside === undefined) {
      hiddenIn.set(group, [entry]);
      rows.push({ kind: "hidden", entry: hiddenEntry(group, [entry]) });
    } else inside.push(entry);
  }
  // 숨긴 줄에 든 메시지를 채운다.
  const filled = rows.map((row): Row => {
    if (row.kind !== "hidden") return row;
    const group = [...hiddenIn.keys()].find((one) =>
      hiddenFacts(one).checkpoint === row.entry.checkpoint
    );
    return group === undefined
      ? row
      : { kind: "hidden", entry: hiddenEntry(group, hiddenIn.get(group)!) };
  });

  // turn에 딸린 줄(tool 줄, 편집 카드, call 블록, 질문 요약)과 끝 줄을 그 turn의 메시지 둘레에 둔다.
  const pre = await toolEntries(env, memo, session, turns.value);
  const lastAt = new Map<string, number>();
  const firstAnswerAt = new Map<string, number>();
  filled.forEach((row, index) => {
    if (row.kind !== "message" || row.entry.turn === null) return;
    lastAt.set(row.entry.turn, index);
    if (row.entry.actor === "agent" && !firstAnswerAt.has(row.entry.turn)) {
      firstAnswerAt.set(row.entry.turn, index);
    }
  });
  const hiddenTurns = new Set(
    entries.filter((entry) => entry.turn !== null).map((entry) => entry.turn!),
  );
  for (const row of filled) {
    if (row.kind === "message" && row.entry.turn !== null) {
      hiddenTurns.delete(row.entry.turn);
    }
  }
  const out: ThreadEntry[] = [];
  const placed = new Set<string>();
  const place = (turnId: string, which: "pre" | "tail") => {
    const turn = turnById.get(turnId);
    if (turn === undefined || hiddenTurns.has(turnId)) return;
    if (which === "pre") {
      if (placed.has(`pre:${turnId}`)) return;
      placed.add(`pre:${turnId}`);
      out.push(...pre.get(turnId) ?? []);
    } else {
      if (placed.has(`tail:${turnId}`)) return;
      placed.add(`tail:${turnId}`);
      const tail = tailOf(turn);
      if (tail !== null) out.push(tail);
    }
  };
  filled.forEach((row, index) => {
    if (row.kind === "hidden") {
      out.push(row.entry);
      return;
    }
    const turnId = row.entry.turn;
    if (turnId !== null && firstAnswerAt.get(turnId) === index) {
      place(turnId, "pre");
    }
    out.push(row.entry);
    if (turnId !== null && lastAt.get(turnId) === index) {
      place(turnId, "pre");
      place(turnId, "tail");
    }
  });
  // 메시지를 못 찾은 turn의 줄은 맨 뒤에 둔다.
  for (const turn of turns.value) {
    if (!lastAt.has(turn.id)) {
      place(turn.id, "pre");
      place(turn.id, "tail");
    }
  }

  let questions: AskedGroup | null = null;
  if (asked !== null) {
    const read = await readAskedQuestions(env, session, asked.tool_call);
    questions = {
      group: asked.group,
      toolCall: asked.tool_call,
      questions: read.ok ? read.value : null,
    };
  }
  const pending: ThreadView["pending"] = {
    approval: permission === null ? null : {
      id: permission.id,
      intent: permission.intent,
      choices: permission.choices,
    },
    questions,
  };

  const turn: TurnView | null = current === null ? null : {
    id: current.id,
    phase: current.state === "finished"
      ? "ended"
      : pending.approval !== null || pending.questions !== null
      ? "waiting"
      : "working",
    startedAt: current.started_at,
  };
  return {
    ok: true,
    value: { entries: out, turn, tasks: [], queued, pending },
  };
}
