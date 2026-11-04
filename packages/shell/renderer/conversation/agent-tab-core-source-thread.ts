// 한 session 화면(thread) snapshot: 받은 메시지, turn의 tool 줄·편집 카드·call 블록·질문 요약·끝 줄, 다음 turn을 기다리는
// 사람 메시지, 지금 turn, 사람이 답할 것, 쓰는 중인 글. snapshot을 처음과 다시 붙을 때(와 turn이 끝났을 때)만 읽고 그
// 사이는 화면이 agent event를 줄로 접는다. 줄 순서는 메시지의 created_seq이고, 메시지가 아닌 줄은 그 turn의 메시지
// 사이에 시각순으로 둔다. 본문과 끝난 tool 호출은 한 번 읽으면 바뀌지 않으므로 기억한다.
import { askRead } from "../../../protocol/lophn-agent/ask-tool.ts";
import type { ReceivedMessage } from "../../../protocol/lophn-agent/received-messages.ts";
import { messageBody } from "../../../protocol/lophn-agent/messages.ts";
import type { AgentId } from "../../../protocol/lophn-agent/places.ts";
import {
  receivedMessageList,
  receivedMessageRead,
} from "../../../protocol/lophn-agent/received-messages.ts";
import { toolCallList } from "../../../protocol/lophn-agent/tool-calls.ts";
import type {
  ListedToolCall,
  ToolCall,
} from "../../../protocol/lophn-agent/tool-values.ts";
import type { TurnRecord } from "../../../protocol/lophn-agent/turn-values.ts";
import {
  turnBodyView,
  turnList,
} from "../../../protocol/lophn-agent/turn-reads.ts";
import { sessionSnapshotsList } from "../../../protocol/events/snapshot.ts";
import type {
  ApprovalCardRequest,
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
  ToolCallBodyView,
  TurnView,
} from "./agent-tab-source.ts";
import { summaryOfParts, turnEndTimes } from "./agent-tab-source.ts";
import type { ToolCallState, ToolCallView } from "./activity/model.ts";
import { toolEntriesOf } from "./activity/tool-groups.ts";
import type { Env } from "./agent-tab-core-source-env.ts";
import { asRecord, callViewOf } from "./agent-tab-core-source-calls.ts";
import {
  groupAt,
  hiddenFacts,
  type HiddenGroup,
  readHiddenGroups,
} from "./agent-tab-core-source-rewind.ts";
import { agentNameOf, readSession } from "./agent-tab-core-source-sessions.ts";
import { liveFromWriting } from "./live-text.ts";

/** 한 번 읽으면 바뀌지 않는 값. */
interface ThreadMemo {
  readonly bodies: Map<string, readonly BodyPart[]>;
  readonly agents: Map<string, AgentId>;
  /** `<종류>:<id>` → tool 호출의 입력·결과 본문. */
  readonly views: Map<string, ToolCallBodyView>;
}

export function createThreadMemo(): ThreadMemo {
  return {
    bodies: new Map(),
    agents: new Map(),
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
  const parts = read.value.content.parts.flatMap((part): BodyPart[] => {
    switch (part.kind) {
      case "text":
        return [{ kind: "text", text: part.text }];
      case "image":
        return [{ kind: "image", blob: part.blob }];
      case "resource_link":
        return [{ kind: "resource_link", uri: part.uri, name: part.name }];
      case "resource":
        return [{ kind: "resource", uri: part.uri, text: part.text }];
      case "app_card":
        return [{ kind: "app_card", app: part.app, view: part.view }];
      // reasoning은 글과 달리 agent 답 앞의 reasoning 줄이 그린다.
      case "reasoning":
        return [
          {
            kind: "reasoning",
            text: part.text,
            durationMs: part.duration_ms,
          },
        ];
    }
  });
  memo.bodies.set(message, parts);
  return { ok: true, value: parts };
}

function textOf(parts: readonly BodyPart[]): string {
  return parts
    .flatMap((part) => (part.kind === "text" ? [part.text] : []))
    .join("\n");
}

async function agentOf(
  env: Env,
  memo: ThreadMemo,
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
  memo: ThreadMemo,
  from: ReceivedMessage["from"],
): Promise<Sender | null> {
  switch (from.kind) {
    case "human":
      return null;
    case "program":
      return { kind: "program", label: null };
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
  if (from.kind !== "human" && from.kind !== "program") {
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
    value: read.value.questions.map(
      (question, index): AskedQuestion => ({
        id: `q${index + 1}`,
        header: question.header,
        question: question.question,
        options: question.options.map((option) => ({
          label: option.label,
          description: option.description,
        })),
        multiSelect: question.multiSelect,
      }),
    ),
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
  const read = await readToolCallBodyMemo(env, memo, kind, id);
  return read.ok ? read.value.value : null;
}

async function readToolCallBodyMemo(
  env: Env,
  memo: ThreadMemo,
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
  memo: ThreadMemo,
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

/** 이 session의 tool 호출 기록. 가장 나중 것부터 상한까지만 그린다. */
async function readToolCalls(
  env: Env,
  session: string,
): Promise<ListedToolCall[]> {
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
  return turns.find(
    (turn) =>
      turn.started_at <= at &&
      (turn.finished_at === null || at <= turn.finished_at),
  );
}

/** call 기록 하나를 화면 값으로. 끝난 call의 상태는 `core-ports.ts`의 `endedOutcome`과 같은 가르기다. */
function toolCallView(call: ListedToolCall): ToolCallView {
  return {
    id: call.id,
    tool: call.tool,
    category: call.display.category,
    title: call.display.title,
    state: callStateOf(call),
    startedAt: call.started_at,
    durationMs: call.duration_ms,
  };
}

function callStateOf(call: ListedToolCall): ToolCallState {
  if (call.state !== "finished") return "running";
  const outcome = call.outcome;
  if (outcome === null) return "error";
  if (outcome.kind === "success") return "ok";
  if (outcome.kind === "not_executed") {
    if (outcome.code === "cancelled") return "cancelled";
    if (outcome.code === "denied" || outcome.code === "rejected") {
      return "denied";
    }
  }
  return "error";
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
    ? (input["questions"] as unknown[])
    : [];
  const result = asRecord(output?.["content"]) ?? output;
  const answers = Array.isArray(result?.["answers"])
    ? (result["answers"] as unknown[])
    : [];
  const outcome = result?.["outcome"];
  return {
    kind: "questions",
    id: call.id,
    at,
    group: call.id,
    outcome:
      outcome === "submitted" || outcome === "human_message"
        ? outcome
        : "cancelled",
    lines: questions.map((question, index) => {
      const answer = asRecord(answers[index]);
      const given = Array.isArray(answer?.["answer"])
        ? (answer["answer"] as unknown[])
            .filter((one) => typeof one === "string")
            .join(", ")
        : "";
      return {
        header: String(asRecord(question)?.["header"] ?? ""),
        answer:
          answer?.["status"] === "answered" && given !== "" ? given : null,
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
  messageTimes: ReadonlyMap<string, readonly number[]>,
): Promise<Map<string, ThreadEntry[]>> {
  const found = new Map<string, ThreadEntry[]>();
  const all = await readToolCalls(env, session);
  const retried = new Set(
    all.flatMap((call) => (call.retry_of === null ? [] : [call.retry_of])),
  );
  let run: ListedToolCall[] = [];
  let runTurn: TurnRecord | undefined;
  const callAt = (call: ToolCall, turn: TurnRecord) =>
    call.started_at ?? call.finished_at ?? turn.started_at;
  // 앞 call과 이 call 사이에 그 turn의 메시지가 있으면 같은 묶음으로 두면 메시지 뒤의 call이 메시지 앞에 보인다.
  const interrupted = (call: ToolCall, turn: TurnRecord): boolean => {
    const previous = run.at(-1);
    const times = messageTimes.get(turn.id);
    if (previous === undefined || times === undefined) return false;
    const from = Date.parse(callAt(previous, turn));
    const to = Date.parse(callAt(call, turn));
    return times.some((at) => from < at && at <= to);
  };
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
    const calls = run.map(toolCallView);
    for (const entry of toolEntriesOf(calls, callAt(first, runTurn))) {
      put(runTurn, entry);
    }
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
    } else if (call.tool === "call.send") {
      if (!ok) continue;
      const view = await callViewOf(
        env,
        await viewOf(env, memo, "tool_call_input", call.id),
        await viewOf(env, memo, "tool_call_output", call.id),
      );
      own =
        view === null ? null : { kind: "call", id: view.call, at, call: view };
    } else if (call.tool === "release.activate") {
      // 동의 대기만 카드로 올린다. 나머지(active·failed·실패한 호출)는 일반 tool 줄로 충분하다.
      const output = ok
        ? asRecord(await viewOf(env, memo, "tool_call_output", call.id))
        : null;
      const result = asRecord(output?.["content"]) ?? output;
      const release = result?.["release"];
      if (
        result?.["status"] === "waiting_consent" &&
        typeof release === "string"
      )
        own = { kind: "release-consent", id: call.id, at, release };
    } else if (call.tool === "file.write" || call.tool === "file.edit") {
      if (!ok) continue;
      own = await editEntry(env, memo, call, at);
    }
    if (own !== null) {
      flush();
      put(turn, own);
      continue;
    }
    if (run.length > 0 && (runTurn?.id !== turn.id || interrupted(call, turn)))
      flush();
    runTurn = turn;
    run.push(call);
  }
  flush();
  return found;
}

// ---------------------------------------------------------------- thread

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
  const times = turnEndTimes(turn.started_at, at, turn.elapsed.active_ms);
  return {
    kind: "turn-end",
    id: `end-${turn.id}`,
    at,
    turn: turn.id,
    outcome: turn.outcome.kind === "completed" ? "completed" : "stopped",
    activeMs: times.activeMs,
    waitedMs: times.waitedMs,
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

/**
 * 다음 turn으로 접수했다가 [Send now]로 올려 도는 turn이 가져간 사람 메시지다. 기록의 delivery는 접수 때 값 그대로라
 * turn을 연 입력이 아닌데 turn이 정해진 것으로 안다.
 */
function steered(
  message: { id: string; from: { kind: string }; turn: string | null },
  turns: ReadonlyMap<string, TurnRecord>,
): boolean {
  if (message.from.kind !== "human" || message.turn === null) return false;
  const turn = turns.get(message.turn);
  return turn !== undefined && turn.input_message !== message.id;
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
  const sessionSnapshot = snapshot.value.snapshots[0];
  // harness 물음은 이 대화에 그리지 않는다.
  let approval: ApprovalCardRequest | null = null;
  for (const one of sessionSnapshot?.turn_requests ?? []) {
    if (one.subject.kind === "harness") continue;
    approval = {
      id: one.id,
      subject: one.subject,
      always_patterns: one.always_patterns,
    };
    break;
  }
  const asked = sessionSnapshot?.questions[0] ?? null;
  // 늦게 붙은 화면도 쓰인 데까지 본다. 묶음 위의 시각은 그 turn의 시작이다.
  const writing = sessionSnapshot?.writing ?? null;
  const writingAt =
    writing === null
      ? null
      : (turnById.get(writing.turn)?.started_at ?? current?.started_at ?? null);
  const live =
    writing === null || writingAt === null
      ? null
      : liveFromWriting(writing, writingAt);

  const steeringIds = new Set(sessionSnapshot?.steering ?? []);
  // 사람이 도는 중에 다음 turn으로 보낸 메시지는 입력함에 있다.
  const queued: QueuedView[] = [];
  const entries: ThreadMessage[] = [];
  const hiddenIn = new Map<HiddenGroup, ThreadMessage[]>();
  const rows: Row[] = [];
  for (const message of messages.value) {
    const sender = await senderOf(env, memo, message.from);
    const own =
      message.from.kind === "agent" && message.from.session === session;
    // [Send now]로 올렸지만 아직 model 요청에 싣지 않은 메시지는 기록에 turn이 비어 있어도 대화에 steer로 선다.
    const steering = steeringIds.has(message.id);
    if (
      sender === null &&
      message.turn === null &&
      message.delivery === "next_turn" &&
      running &&
      !steering
    ) {
      const body = await readBody(env, memo, message.id);
      queued.push({
        id: message.id,
        at: message.created_at,
        text: body.ok ? textOf(body.value) : "",
        summary: body.ok ? summaryOfParts(body.value) : "",
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
      delivery:
        steering || steered(message, turnById) ? "steer" : message.delivery,
      turn: steering ? (current?.id ?? null) : message.turn,
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
    const group = [...hiddenIn.keys()].find(
      (one) => hiddenFacts(one).checkpoint === row.entry.checkpoint,
    );
    return group === undefined
      ? row
      : { kind: "hidden", entry: hiddenEntry(group, hiddenIn.get(group)!) };
  });

  // turn에 딸린 줄(tool 줄, 편집 카드, call 블록, 질문 요약)과 끝 줄을 그 turn의 메시지 사이에 시각순으로 둔다.
  const messageTimes = new Map<string, number[]>();
  for (const entry of entries) {
    if (entry.turn === null) continue;
    const times = messageTimes.get(entry.turn) ?? [];
    times.push(Date.parse(entry.at));
    messageTimes.set(entry.turn, times);
  }
  for (const times of messageTimes.values()) times.sort((a, b) => a - b);
  const pre = await toolEntries(env, memo, session, turns.value, messageTimes);
  for (const list of pre.values()) {
    list.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  }
  const lastAt = new Map<string, number>();
  filled.forEach((row, index) => {
    if (row.kind !== "message" || row.entry.turn === null) return;
    lastAt.set(row.entry.turn, index);
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
  const nextPre = new Map<string, number>();
  const tails = new Set<string>();
  // 아직 놓지 않은 pre 줄 중 `before`보다 앞선 것을 놓는다. null이면 남은 것을 모두 놓는다.
  const placePre = (turnId: string, before: number | null) => {
    if (hiddenTurns.has(turnId) || !turnById.has(turnId)) return;
    const list = pre.get(turnId) ?? [];
    let next = nextPre.get(turnId) ?? 0;
    while (next < list.length) {
      const entry = list[next]!;
      if (before !== null && Date.parse(entry.at) >= before) break;
      out.push(entry);
      next++;
    }
    nextPre.set(turnId, next);
  };
  const placeTail = (turnId: string) => {
    if (hiddenTurns.has(turnId) || tails.has(turnId)) return;
    const turn = turnById.get(turnId);
    if (turn === undefined) return;
    tails.add(turnId);
    const tail = tailOf(turn);
    if (tail !== null) out.push(tail);
  };
  filled.forEach((row, index) => {
    if (row.kind === "hidden") {
      out.push(row.entry);
      return;
    }
    const turnId = row.entry.turn;
    // 같은 시각이면 메시지가 먼저다(MessageRecorded가 그 응답의 ToolCallStarted보다 먼저 온다).
    if (turnId !== null) placePre(turnId, Date.parse(row.entry.at));
    out.push(row.entry);
    if (turnId !== null && lastAt.get(turnId) === index) {
      placePre(turnId, null);
      placeTail(turnId);
    }
  });
  // 메시지를 못 찾은 turn의 줄은 맨 뒤에 둔다.
  for (const turn of turns.value) {
    if (!lastAt.has(turn.id)) {
      placePre(turn.id, null);
      placeTail(turn.id);
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
    approval,
    questions,
  };

  const turn: TurnView | null =
    current === null
      ? null
      : {
          id: current.id,
          phase:
            current.state === "finished"
              ? "ended"
              : pending.approval !== null || pending.questions !== null
                ? "waiting"
                : "working",
          startedAt: current.started_at,
          elapsed:
            running && sessionSnapshot?.elapsed?.turn === current.id
              ? {
                  activeMs: sessionSnapshot.elapsed.active_ms,
                  at: sessionSnapshot.elapsed.at,
                }
              : null,
        };
  return {
    ok: true,
    value: {
      entries: out,
      turn,
      queued,
      pending,
      live,
      dropped: {
        modelCall: null,
        turn:
          current !== null && current.state === "finished" ? current.id : null,
      },
    },
  };
}
