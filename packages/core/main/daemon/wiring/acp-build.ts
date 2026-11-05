// ACP snapshot과 갱신이 쓰는 읽기와 조립이다. 기록(messages, turns, tool calls, rewind)을 core 안 read route로 읽어
// 항목을 만들고, 갱신 쪽(`acp.ts`)도 같은 함수로 본문·tool 칸을 채운다. 그래서 같은 기록에서 같은 상태가 나온다.
// 밖으로 나가는 글은 모두 `env.redact`를 거친다: 저장된 본문도 지금의 redaction을 한 번 더 거친다.
import { ok, type Result } from "../../../../base/mod.ts";
import {
  type AcpEntry,
  type AcpHiddenItem,
  type AcpMessageItem,
  type AcpNoticeItem,
  type AcpState,
  type AcpToolDetail,
  type AcpToolItem,
  acpNoticeId,
  acpTurnTimes,
  type AcpApprovalItem,
  type AcpCard,
  type AcpPending,
  type AcpQueued,
  type AcpReasoning,
  type AcpWriting,
  type AcpUpdate,
  ACP_CAPABILITIES,
  type AcpCapabilities,
  type AcpChoice,
  type AcpModelGroup,
  type AcpSessionMeta,
  type AcpUsage,
} from "../../../../protocol/acp/mod.ts";
import { LOPHN_AGENT_NAME } from "../../../../protocol/lophn-agent/agent-values.ts";
import { agentCallRead } from "../../../../protocol/lophn-agent/calls.ts";
import {
  type ContentBlock,
  blocksOfContent,
  messageBody,
  messageContentSchema,
} from "../../../../protocol/lophn-agent/mod.ts";
import { placeSessionRead } from "../../../../protocol/lophn-agent/agent-sessions.ts";
import { agentRead } from "../../../../protocol/lophn-agent/agent-definitions.ts";
import { commandsList } from "../../../../protocol/lophn-agent/commands.ts";
import {
  type ModelChoice,
  modelCatalogRead,
  shownModelsRead,
} from "../../../../protocol/lophn-agent/models.ts";
import {
  optionAxesOf,
  orderPicker,
  selectableModels,
} from "../../../../protocol/lophn-agent/model-picker.ts";
import { providerList } from "../../../../protocol/lophn-agent/providers.ts";
import { sessionStatusRead } from "../../../../protocol/lophn-agent/session-status.ts";
import {
  type AgentId,
  LOPHN_AGENT_ID,
  type Place,
} from "../../../../protocol/lophn-agent/places.ts";
import {
  type ReceivedMessage,
  receivedMessageList,
} from "../../../../protocol/lophn-agent/received-messages.ts";
import { rewindList } from "../../../../protocol/lophn-agent/reverts.ts";
import {
  toolCallList,
  toolCallRead,
} from "../../../../protocol/lophn-agent/tool-calls.ts";
import type {
  ListedToolCall,
  ToolCall,
} from "../../../../protocol/lophn-agent/tool-values.ts";
import {
  turnBody,
  turnList,
} from "../../../../protocol/lophn-agent/turn-reads.ts";
import type { TurnRecord } from "../../../../protocol/lophn-agent/turn-values.ts";
import type { Output } from "../../../../protocol/server/mod.ts";
import {
  acpUpdatesOf,
  type AgentEvent,
} from "../../../../protocol/events/mod.ts";
import type { TurnRequest } from "../../../../protocol/approvals/mod.ts";

export type Route = { resource: string; method: string };

export type AcpEnv = {
  read<T>(route: Route, input: unknown): Promise<Result<T>>;
  /** 알려진 secret을 다 모르는 동안은 글을 내지 않도록 빈 글을 돌려준다. */
  redact(text: string): string;
};

type Json = Record<string, unknown>;

function asRecord(value: unknown): Json | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Json)
    : null;
}

export function redactDeep<T>(env: Pick<AcpEnv, "redact">, value: T): T {
  if (typeof value === "string") return env.redact(value) as T;
  if (Array.isArray(value))
    return value.map((one) => redactDeep(env, one)) as T;
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, one]) => [key, redactDeep(env, one)]),
    ) as T;
  }
  return value;
}

export function redactBlocks(
  env: Pick<AcpEnv, "redact">,
  blocks: readonly ContentBlock[],
): ContentBlock[] {
  return blocks.map((block): ContentBlock => {
    switch (block.type) {
      case "text":
        return { ...block, text: env.redact(block.text) };
      case "resource":
        return { ...block, text: env.redact(block.text) };
      case "resource_link":
        return {
          ...block,
          name: env.redact(block.name),
          ...(block.description === undefined
            ? {}
            : { description: env.redact(block.description) }),
        };
      case "image":
        return block;
    }
  });
}

async function pages<T>(
  env: AcpEnv,
  route: Route,
  input: Json,
  pick: (out: never) => T[],
): Promise<Result<T[]>> {
  const all: T[] = [];
  let cursor: string | undefined;
  for (;;) {
    const page = await env.read<{ next_cursor?: string | null }>(route, {
      ...input,
      ...(cursor === undefined ? {} : { cursor }),
    });
    if (!page.ok) return page;
    all.push(...pick(page.value as never));
    const next = page.value.next_cursor;
    if (next === null || next === undefined) return ok(all);
    cursor = next;
  }
}

// ---------------------------------------------------------------- 본문과 보낸 쪽

export type MessageBody = {
  content: ContentBlock[];
  reasoning: AcpReasoning | null;
  cards: AcpCard[];
};

/** 저장된 메시지 본문. harness가 쓴 tool 줄은 전용 항목이 생기기 전까지 글 한 줄이다. 못 읽으면 null이다. */
export async function readMessageBody(
  env: AcpEnv,
  message: string,
): Promise<MessageBody | null> {
  const read = await env.read<Output<typeof messageBody>>(messageBody, {
    message,
  });
  if (!read.ok) return null;
  const parsed = messageContentSchema.safeParse(read.value.content);
  if (!parsed.success) return null;
  const content: ContentBlock[] = [];
  const cards: AcpCard[] = [];
  let reasoning: AcpReasoning | null = null;
  for (const part of parsed.data.parts) {
    switch (part.kind) {
      case "app_card":
        cards.push({ app: part.app, view: part.view });
        break;
      case "reasoning":
        reasoning = {
          text: env.redact(part.text),
          duration_ms: part.duration_ms,
        };
        break;
      case "harness_tool":
        content.push({
          type: "text",
          text: env.redact(`[${part.status}] ${part.name}: ${part.summary}`),
        });
        break;
      default:
        content.push(
          ...redactBlocks(
            env,
            blocksOfContent({ schema_version: 1, parts: [part] }),
          ),
        );
    }
  }
  return { content, reasoning, cards };
}

export async function agentOfSession(
  env: AcpEnv,
  session: string,
): Promise<AgentId | null> {
  const read = await env.read<Output<typeof placeSessionRead>>(
    placeSessionRead,
    { session },
  );
  return read.ok ? (read.value.session.agent as AgentId) : null;
}

/** lophn은 이름이 고정이다. 다른 agent는 정의에서 읽고, 못 읽으면 null이다. */
export async function agentNameOf(
  env: AcpEnv,
  agent: AgentId,
): Promise<string | null> {
  if (agent === LOPHN_AGENT_ID) return LOPHN_AGENT_NAME;
  const read = await env.read<Output<typeof agentRead>>(agentRead, { agent });
  return read.ok ? env.redact(read.value.effective.name.value) : null;
}

// ---------------------------------------------------------------- tool

const CALL_ID = /cal_[0-7][0-9a-hjkmnp-tv-z]{25}/;

function lineCount(text: unknown): number {
  return typeof text === "string" && text !== ""
    ? text.replace(/\n$/, "").split("\n").length
    : 0;
}

/** 저장된 tool 입력이나 결과. 저장 때 redaction을 거쳤지만 지금의 redaction을 한 번 더 거친다. */
async function bodyOf(
  env: AcpEnv,
  kind: "tool_call_input" | "tool_call_output",
  id: string,
): Promise<unknown> {
  const read = await env.read<Output<typeof turnBody>>(turnBody, { kind, id });
  return read.ok ? redactDeep(env, read.value.value) : null;
}

export function callStateOf(call: {
  state: ToolCall["state"];
  outcome: ToolCall["outcome"];
}): AcpToolItem["state"] {
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

/** 입력을 못 읽어도 tool 이름만으로 아는 종류. 질문뿐이다. */
export function startDetail(tool: string): AcpToolDetail | null {
  return tool === "ask"
    ? { kind: "question", group: null, outcome: null, lines: [] }
    : null;
}

async function toLabel(env: AcpEnv, to: Json): Promise<string> {
  if (typeof to["session"] === "string") {
    const session = await env.read<Output<typeof placeSessionRead>>(
      placeSessionRead,
      { session: to["session"] },
    );
    if (!session.ok) return to["session"];
    const name =
      (await agentNameOf(env, session.value.session.agent as AgentId)) ?? "";
    return [name, env.redact(session.value.session.title ?? "")]
      .filter((part) => part !== "")
      .join(" · ");
  }
  const agent = typeof to["agent"] === "string" ? to["agent"] : "";
  const place = asRecord(to["place"]);
  const where =
    typeof place?.["project"] === "string"
      ? place["project"]
      : typeof place?.["app"] === "string"
        ? place["app"]
        : "";
  return [agent, where].filter((part) => part !== "").join(" · ");
}

/**
 * tool call의 종류와 칸. 모르면 null(generic)이다. 큰 본문은 싣지 않고 화면에 필요한 칸만 뽑는다.
 * 종류는 tool 이름이 정하므로 시작 때부터 있고 실패해도 지킨다(실패는 item의 state가 말한다).
 * 입력에서 뽑는 칸은 시작 때부터 채우고, 결과에서 아는 칸(call id·state, 동의 대기)은 성공하고 끝난 call만이다.
 */
export async function toolDetailOf(
  env: AcpEnv,
  call: Pick<ToolCall, "id" | "tool" | "state" | "outcome">,
): Promise<AcpToolDetail | null> {
  const finished = call.state === "finished";
  const ok = finished && call.outcome?.kind === "success";
  if (call.tool === "ask") {
    if (!finished) return startDetail(call.tool);
    const input = asRecord(await bodyOf(env, "tool_call_input", call.id));
    const output = asRecord(await bodyOf(env, "tool_call_output", call.id));
    const questions = Array.isArray(input?.["questions"])
      ? (input["questions"] as unknown[])
      : [];
    const result = asRecord(output?.["content"]) ?? output;
    const answers = Array.isArray(result?.["answers"])
      ? (result["answers"] as unknown[])
      : [];
    const outcome = result?.["outcome"];
    return {
      kind: "question",
      // 묶음 id는 메모리에만 있다. 풀린 묶음은 알 필요가 없다.
      group: null,
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
  if (call.tool === "call.send") {
    const input = asRecord(await bodyOf(env, "tool_call_input", call.id));
    const body = typeof input?.["body"] === "string" ? input["body"] : "";
    const reply = input?.["reply"];
    const detail: Extract<AcpToolDetail, { kind: "call" }> = {
      kind: "call",
      call: null,
      to: await toLabel(env, asRecord(input?.["to"]) ?? {}),
      task: body.split("\n")[0] ?? "",
      reply:
        reply === "result" || reply === "conversation" || reply === "none"
          ? reply
          : "none",
      state: null,
      fail_reason: null,
      session: null,
    };
    if (!ok) return detail;
    const output = await bodyOf(env, "tool_call_output", call.id);
    const id = CALL_ID.exec(JSON.stringify(output) ?? "")?.[0];
    if (id === undefined) return detail;
    const read = await env.read<Output<typeof agentCallRead>>(agentCallRead, {
      call: id,
    });
    return read.ok
      ? {
          ...detail,
          call: id,
          state: read.value.call.state,
          fail_reason: read.value.call.fail_reason,
          session: read.value.call.receiver_session,
        }
      : detail;
  }
  if (call.tool === "release.activate") {
    if (!ok) return null;
    // 동의 대기만 카드로 올린다. 나머지(active·failed)는 일반 tool 줄로 충분하다.
    const output = asRecord(await bodyOf(env, "tool_call_output", call.id));
    const result = asRecord(output?.["content"]) ?? output;
    const release = result?.["release"];
    return result?.["status"] === "waiting_consent" &&
      typeof release === "string"
      ? { kind: "consent", release }
      : null;
  }
  if (call.tool === "file.write" || call.tool === "file.edit") {
    const input = asRecord(await bodyOf(env, "tool_call_input", call.id));
    const path = input?.["path"];
    if (typeof path !== "string") return null;
    const write = call.tool === "file.write";
    return {
      kind: "edit",
      document: path,
      path,
      added: lineCount(write ? input?.["content"] : input?.["new_string"]),
      removed: write ? 0 : lineCount(input?.["old_string"]),
    };
  }
  return null;
}

/** tool call 하나의 칸. 갱신이 `ToolCallEnded`에서 쓴다. */
export async function readToolDetail(
  env: AcpEnv,
  toolCall: string,
): Promise<AcpToolDetail | null> {
  const read = await env.read<Output<typeof toolCallRead>>(toolCallRead, {
    tool_call: toolCall,
  });
  return read.ok ? await toolDetailOf(env, read.value.tool_call) : null;
}

// ---------------------------------------------------------------- 후보

/** 대화에 들 항목의 후보. 순번은 저장된 것이거나 이어서 붙인다. */
type Candidate = {
  id: string;
  kind: "message" | "tool" | "approval" | "notice";
  turn: string | null;
  /** 대화에 든 때. 순번이 없는 옛 기록의 순서를 정한다. */
  at: string;
  /** 같은 시각이면 메시지가 먼저다. */
  rank: number;
  /** 메시지의 기록 순번. 숨긴 구간을 가른다. */
  createdSeq: bigint | null;
  make(seq: number): AcpEntry;
};

export type AcpStoredItem = {
  id: string;
  seq: number;
  kind: "message" | "tool" | "approval" | "notice";
  turn: string | null;
  at: string;
  data: string | null;
};

export type AcpAlloc = {
  id: string;
  kind: AcpStoredItem["kind"];
  turn: string | null;
  at: string;
  data: string | null;
};

/** 메모리에 있는 것과 저장된 순번. snapshot을 만들 때 core가 모아 준다. */
export type AcpLive = {
  /** `[Send now]`로 올렸지만 아직 model 요청에 싣지 않은 steer. */
  steering: ReadonlySet<string>;
  writing: {
    turn: string;
    model_call: string;
    text: string;
    reasoning: string;
  } | null;
  elapsed: { turn: string; active_ms: number; at: string } | null;
  approval: NonNullable<AcpPending["approval"]> | null;
  question: NonNullable<AcpPending["question"]> | null;
  /** 대화 밖 session 기능. snapshot을 부른 사람이 있을 때만 읽는다(`readSessionMeta`). */
  session: AcpSessionMeta | null;
  stored: readonly AcpStoredItem[];
  /** 순번이 없는 항목에 순번을 붙인다. 이미 있는 id는 그 순번을 돌려준다. */
  allocate(items: AcpAlloc[]): Promise<Result<Map<string, number>>>;
};

const BODY_CHUNK = 16;

async function inChunks<T, R>(
  list: readonly T[],
  work: (one: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = [];
  for (let at = 0; at < list.length; at += BODY_CHUNK) {
    out.push(...(await Promise.all(list.slice(at, at + BODY_CHUNK).map(work))));
  }
  return out;
}

// ---------------------------------------------------------------- 되돌린 구간

type RevertRecord = Output<typeof rewindList>["reverts"][number];

type HiddenGroup = {
  from: bigint;
  through: bigint;
  rewinds: RevertRecord[];
};

/** 숨김 구간은 rewind의 boundary_seq부터 result_seq까지다. 겹치거나 이어지면 합친다. 오래된 쪽부터다. */
async function readHiddenGroups(
  env: AcpEnv,
  session: string,
): Promise<HiddenGroup[]> {
  const read = await pages(
    env,
    rewindList,
    { session },
    (out: { reverts: RevertRecord[] }) => out.reverts,
  );
  // 읽지 못하면 접지 않는다. 대화는 그대로 보인다.
  if (!read.ok) return [];
  const hiding = read.value
    .flatMap((row) =>
      row.kind === "rewind" &&
      (row.choice === "restore_all" || row.choice === "messages_only") &&
      (row.outcome === "applied" ||
        row.outcome === "partial" ||
        row.outcome === "uncertain") &&
      row.result_seq !== null
        ? [
            {
              row,
              from: BigInt(row.boundary_seq),
              through: BigInt(row.result_seq),
            },
          ]
        : [],
    )
    .sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0));
  const groups: HiddenGroup[] = [];
  for (const item of hiding) {
    const last = groups.at(-1);
    if (last !== undefined && item.from <= last.through + 1n) {
      if (item.through > last.through) last.through = item.through;
      last.rewinds.push(item.row);
    } else {
      groups.push({
        from: item.from,
        through: item.through,
        rewinds: [item.row],
      });
    }
  }
  return groups;
}

const LEFT_RESULTS = new Set(["skipped", "remained", "failure", "uncertain"]);

/** 접힌 줄이 말하는 것: 구간을 숨긴 가장 나중 rewind의 결과. */
function hiddenFacts(
  env: AcpEnv,
  group: HiddenGroup,
): Pick<AcpHiddenItem, "checkpoint" | "choice" | "restored" | "left"> {
  const latest = [...group.rewinds].sort((a, b) =>
    BigInt(a.result_seq!) < BigInt(b.result_seq!) ? 1 : -1,
  )[0]!;
  return {
    checkpoint: latest.checkpoint,
    choice: latest.choice as "restore_all" | "messages_only",
    restored: latest.items.filter(
      (item) => item.class === "file" && item.result === "restored",
    ).length,
    left: latest.items
      .filter(
        (item) =>
          LEFT_RESULTS.has(item.result) ||
          (item.result === "unchanged" && item.reason !== null),
      )
      .map((item) => ({
        kind: item.class,
        target: env.redact(item.target),
        result: item.result as AcpHiddenItem["left"][number]["result"],
        reason: item.reason,
      })),
  };
}

// ---------------------------------------------------------------- snapshot

function latestTurn(turns: readonly TurnRecord[]): TurnRecord | null {
  let latest: TurnRecord | null = null;
  for (const turn of turns) {
    if (latest === null || BigInt(turn.state_seq) > BigInt(latest.state_seq)) {
      latest = turn;
    }
  }
  return latest;
}

function noticeOf(turn: TurnRecord): AcpNoticeItem["notice"] | null {
  if (turn.state !== "finished" || turn.outcome === null) return null;
  if (turn.outcome.kind === "failed") {
    return {
      type: "error",
      code: turn.outcome.reason,
      message: turn.outcome.reason.replaceAll("_", " "),
    };
  }
  const at = turn.finished_at ?? turn.started_at;
  return {
    type: "turn_end",
    outcome: turn.outcome.kind === "completed" ? "completed" : "stopped",
    ...acpTurnTimes(turn.started_at, at, turn.elapsed.active_ms),
  };
}

/**
 * 다음 turn으로 접수했다가 [Send now]로 올려 도는 turn이 가져간 사람 메시지다. 기록의 delivery는 접수 때 값 그대로라
 * turn을 연 입력이 아닌데 turn이 정해진 것으로 안다.
 */
function steered(
  message: ReceivedMessage,
  turns: ReadonlyMap<string, TurnRecord>,
): boolean {
  if (message.from.kind !== "human" || message.turn === null) return false;
  const turn = turns.get(message.turn);
  return turn !== undefined && turn.input_message !== message.id;
}

function senderOf(
  from: ReceivedMessage["from"],
  agent: AgentId | null,
  name: string | null,
): AcpMessageItem["sender"] {
  if (from.kind === "human") return null;
  if (from.kind === "program") return { kind: "program" };
  return { kind: "agent", agent, name };
}

export async function buildAcpState(
  env: AcpEnv,
  session: string,
  live: AcpLive,
): Promise<Result<AcpState>> {
  const [messages, turns, calls, groups] = await Promise.all([
    pages(
      env,
      receivedMessageList,
      { session },
      (out: { messages: ReceivedMessage[] }) => out.messages,
    ),
    pages(
      env,
      turnList,
      { session },
      (out: { turns: TurnRecord[] }) => out.turns,
    ),
    pages(
      env,
      toolCallList,
      { session, limit: 100 },
      (out: { tool_calls: ListedToolCall[] }) => out.tool_calls,
    ),
    readHiddenGroups(env, session),
  ]);
  if (!messages.ok) return messages;
  if (!turns.ok) return turns;
  if (!calls.ok) return calls;

  const stored = new Map(live.stored.map((row) => [row.id, row]));
  const turnById = new Map(turns.value.map((turn) => [turn.id, turn]));
  const current = latestTurn(turns.value);
  const running = current !== null && current.state === "running";

  // 보낸 session의 agent는 한 번씩만 읽는다.
  const agents = new Map<
    string,
    Promise<{ agent: AgentId | null; name: string | null }>
  >();
  const agentOf = (from: string) => {
    let found = agents.get(from);
    if (found === undefined) {
      found = agentOfSession(env, from).then(async (agent) => ({
        agent,
        name: agent === null ? null : await agentNameOf(env, agent),
      }));
      agents.set(from, found);
    }
    return found;
  };

  const queued: AcpQueued[] = [];
  const candidates: Candidate[] = [];
  // 줄에 선 메시지: 도는 중에 보낸 사람 메시지로 아직 turn이 가져가지도, steer로 올리지도 않았다.
  const waiting = new Set(
    messages.value
      .filter(
        (message) =>
          message.from.kind === "human" &&
          message.turn === null &&
          message.delivery === "next_turn" &&
          running &&
          !live.steering.has(message.id) &&
          !stored.has(message.id),
      )
      .map((message) => message.id),
  );
  const bodies = await inChunks(messages.value, (message) =>
    readMessageBody(env, message.id),
  );
  const bodyOf = new Map(
    messages.value.map((message, index) => [message.id, bodies[index]!]),
  );
  for (const message of messages.value) {
    if (!waiting.has(message.id)) continue;
    queued.push({
      id: message.id,
      at: message.created_at,
      content: bodyOf.get(message.id)?.content ?? [],
    });
  }
  for (const message of messages.value) {
    if (waiting.has(message.id)) continue;
    const body = bodyOf.get(message.id) ?? null;
    const own =
      message.from.kind === "agent" && message.from.session === session;
    const steering = live.steering.has(message.id);
    const turnStart = turnById.get(message.turn ?? "");
    const inputOf =
      turnStart !== undefined && turnStart.input_message === message.id;
    const sender =
      message.from.kind === "agent" && !own
        ? await agentOf(message.from.session)
        : { agent: null, name: null };
    candidates.push({
      id: message.id,
      kind: "message",
      turn: message.turn,
      // turn을 연 입력은 turn이 가져간 때 대화에 든다(줄에 섰다 가져간 메시지).
      at: inputOf ? turnStart.started_at : message.created_at,
      rank: 0,
      createdSeq: BigInt(message.created_seq),
      make: (seq) => ({
        kind: "message",
        id: message.id,
        seq,
        at: message.created_at,
        actor:
          message.from.kind === "human" ? "user" : own ? "agent" : "received",
        sender: own ? null : senderOf(message.from, sender.agent, sender.name),
        call: message.call,
        reply_to: message.reply_to,
        delivery:
          steering || steered(message, turnById) ? "steer" : message.delivery,
        turn: steering ? (current?.id ?? null) : message.turn,
        content: body?.content ?? [],
        reasoning: body?.reasoning ?? null,
        cards: body?.cards ?? [],
        complete: body !== null,
      }),
    });
  }

  const details = await inChunks(calls.value, (call) =>
    toolDetailOf(env, call),
  );
  calls.value.forEach((call, index) => {
    const turn = turnById.get(call.turn);
    const at = call.started_at ?? call.finished_at ?? turn?.started_at;
    if (at === undefined) return;
    const detail = details[index] ?? { kind: "generic" as const };
    candidates.push({
      id: call.id,
      kind: "tool",
      turn: call.turn,
      at,
      rank: 1,
      createdSeq: null,
      make: (seq) => ({
        kind: "tool",
        id: call.id,
        seq,
        at,
        turn: call.turn,
        tool: call.tool,
        category: call.display.category,
        title: call.display.title,
        state: callStateOf(call),
        duration_ms: call.duration_ms,
        detail:
          // 풀리지 않은 묶음은 묶음 id를 붙인다.
          detail.kind === "question" &&
          detail.outcome === null &&
          live.question?.tool_call === call.id
            ? { ...detail, group: live.question.group }
            : detail,
      }),
    });
  });

  for (const turn of turns.value) {
    const notice = noticeOf(turn);
    if (notice === null) continue;
    const at = turn.finished_at ?? turn.started_at;
    candidates.push({
      id: acpNoticeId(turn.id),
      kind: "notice",
      turn: turn.id,
      at,
      rank: 3,
      createdSeq: null,
      make: (seq) => ({
        kind: "notice",
        id: acpNoticeId(turn.id),
        seq,
        at,
        turn: turn.id,
        notice,
      }),
    });
  }

  // 승인 결과는 기록에서 다시 만들 수 없어 결정 때 저장해 둔 내용으로 만든다.
  for (const row of live.stored) {
    if (row.kind !== "approval" || row.data === null) continue;
    const data = JSON.parse(row.data) as Pick<
      AcpApprovalItem,
      "subject" | "outcome" | "choice" | "reason"
    >;
    candidates.push({
      id: row.id,
      kind: "approval",
      turn: row.turn,
      at: row.at,
      rank: 2,
      createdSeq: null,
      make: (seq) => ({
        kind: "approval",
        id: row.id,
        seq,
        at: row.at,
        subject: redactDeep(env, data.subject),
        outcome: data.outcome,
        choice: data.choice,
        reason: data.reason === null ? null : env.redact(data.reason),
      }),
    });
  }

  // 순번이 없는 항목(옛 기록, 놓친 event)은 대화에 든 때 순서로 이어 붙인다.
  const missing = candidates
    .filter((one) => !stored.has(one.id))
    .sort(
      (a, b) =>
        Date.parse(a.at) - Date.parse(b.at) ||
        a.rank - b.rank ||
        Number((a.createdSeq ?? 0n) - (b.createdSeq ?? 0n)) ||
        (a.id < b.id ? -1 : 1),
    );
  const seqs = new Map(live.stored.map((row) => [row.id, row.seq]));
  if (missing.length > 0) {
    const allocated = await live.allocate(
      missing.map((one) => ({
        id: one.id,
        kind: one.kind,
        turn: one.turn,
        at: one.at,
        data: null,
      })),
    );
    if (!allocated.ok) return allocated;
    for (const [id, seq] of allocated.value) seqs.set(id, seq);
  }

  const built = candidates.flatMap((one) => {
    const seq = seqs.get(one.id);
    return seq === undefined ? [] : [{ one, entry: one.make(seq) }];
  });
  built.sort((a, b) => a.entry.seq - b.entry.seq);

  // 숨긴 구간: 메시지는 기록 순번으로, 그 밖의 항목은 메시지가 전부 숨은 turn을 따라간다.
  const groupOf = (createdSeq: bigint) =>
    groups.find((g) => createdSeq >= g.from && createdSeq <= g.through);
  const perTurn = new Map<string, (HiddenGroup | undefined)[]>();
  for (const { one } of built) {
    if (one.kind !== "message" || one.turn === null) continue;
    const list = perTurn.get(one.turn) ?? [];
    list.push(one.createdSeq === null ? undefined : groupOf(one.createdSeq));
    perTurn.set(one.turn, list);
  }
  const turnGroup = new Map<string, HiddenGroup>();
  for (const [turn, list] of perTurn) {
    if (list.every((group) => group !== undefined)) {
      turnGroup.set(turn, list[0]!);
    }
  }
  const hiddenIn = new Map<HiddenGroup, AcpEntry[]>();
  const slots: ({ entry: AcpEntry } | { group: HiddenGroup })[] = [];
  for (const { one, entry } of built) {
    const group =
      one.kind === "message"
        ? one.createdSeq === null
          ? undefined
          : groupOf(one.createdSeq)
        : one.turn === null
          ? undefined
          : turnGroup.get(one.turn);
    if (group === undefined) {
      slots.push({ entry });
      continue;
    }
    const inside = hiddenIn.get(group);
    if (inside === undefined) {
      hiddenIn.set(group, [entry]);
      // 숨긴 구간은 숨긴 첫 항목 자리에 선다.
      slots.push({ group });
    } else inside.push(entry);
  }
  const items = slots.map((slot): AcpState["items"][number] => {
    if ("entry" in slot) return slot.entry;
    const inside = hiddenIn.get(slot.group)!;
    const facts = hiddenFacts(env, slot.group);
    return {
      kind: "hidden",
      id: `hidden-${facts.checkpoint}`,
      seq: inside[0]!.seq,
      at: inside[0]!.at,
      ...facts,
      count: inside.filter((one) => one.kind === "message").length,
      items: inside,
    };
  });

  const maxSeq = built.reduce((top, { entry }) => Math.max(top, entry.seq), 0);

  const approval = live.approval;
  const question = live.question;
  const pending: AcpPending = { approval, question };
  const turn: AcpState["turn"] =
    current === null
      ? null
      : {
          id: current.id,
          phase: !running
            ? "ended"
            : approval !== null || question !== null
              ? "waiting"
              : "working",
          started_at: current.started_at,
          elapsed:
            running && live.elapsed?.turn === current.id
              ? { active_ms: live.elapsed.active_ms, at: live.elapsed.at }
              : null,
        };

  const writingAt =
    live.writing === null
      ? null
      : (turnById.get(live.writing.turn)?.started_at ??
        current?.started_at ??
        null);
  const writing: AcpWriting | null =
    live.writing === null || writingAt === null
      ? null
      : { ...live.writing, at: writingAt };

  return ok({
    seq: maxSeq,
    items,
    turn,
    queued,
    pending,
    writing,
    dropped: {
      // 마지막 tool call을 낸 응답의 글은 이미 버려졌다.
      model_call: calls.value.at(-1)?.model_call ?? null,
      turn: current !== null && !running ? current.id : null,
    },
    session: live.session,
    // lophn agent에는 todo가 없다.
    plan: null,
    reread: false,
  });
}

// ---------------------------------------------------------------- session 기능

// lophn mode는 둘이다. acp-send도 이 id로 받는다.
export const AGENT_MODES: AcpChoice[] = [
  {
    id: "ask",
    label: "Ask",
    description: "Ask before actions that need permission",
  },
  {
    id: "skip",
    label: "Skip permissions",
    description: "Do not ask for permission (deny rules still block)",
  },
];

// lophn agent가 가진 기능은 전부다.
const CAPABILITIES = Object.fromEntries(
  ACP_CAPABILITIES.map((name) => [name, true]),
) as AcpCapabilities;

type SessionRecord = Output<typeof placeSessionRead>["session"];

/** model id는 `<provider id>/<model name>`이다(acp-send가 풀어 쓴다). provider id에는 `/`가 없다. */
export const acpModelId = (provider: string, modelName: string) =>
  `${provider}/${modelName}`;

export async function readSessionRecord(
  env: AcpEnv,
  session: string,
): Promise<Result<SessionRecord>> {
  const read = await env.read<Output<typeof placeSessionRead>>(
    placeSessionRead,
    { session },
  );
  return read.ok ? ok(read.value.session) : read;
}

/** 화면의 model 묶음과 지금 값. 묶음·정렬은 picker 규칙(켠 model과 지금 model)을 그대로 쓴다. */
export async function readModelPart(
  env: AcpEnv,
  record: Pick<SessionRecord, "agent" | "place" | "model_selection">,
): Promise<Pick<AcpSessionMeta, "models" | "model">> {
  const [providers, entries, shown, agent] = await Promise.all([
    pages(
      env,
      providerList,
      {},
      (out: Output<typeof providerList>) => out.providers,
    ),
    pages(
      env,
      modelCatalogRead,
      {},
      (out: Output<typeof modelCatalogRead>) => out.entries,
    ),
    env.read<Output<typeof shownModelsRead>>(shownModelsRead, {}),
    record.model_selection === null
      ? env.read<Output<typeof agentRead>>(agentRead, {
          agent: record.agent,
          ...(record.place === null ? {} : { place: record.place }),
        })
      : null,
  ]);
  if (!providers.ok || !shown.ok) return { models: [], model: null };
  // catalog를 읽지 못해도 지금 model은 보이도록 model 목록만 비운다.
  const catalog = entries.ok ? entries.value : [];

  const selectable = new Map<
    string,
    ReturnType<typeof selectableModels>[number]
  >();
  const available = providers.value.flatMap((provider) =>
    selectableModels({
      definition: provider.definition.key,
      catalog,
      reported: provider.credential.reported_models,
    }).map((one) => {
      selectable.set(acpModelId(provider.id, one.model_name), one);
      return { provider: provider.id, model_name: one.model_name };
    }),
  );

  let current: ModelChoice | null = record.model_selection;
  let layer: NonNullable<AcpSessionMeta["model"]>["layer"] =
    current === null ? null : "session";
  if (current === null && agent?.ok) {
    const effective = agent.value.effective.model;
    current = effective?.value ?? null;
    layer = effective?.source ?? null;
  }

  const layout = orderPicker({
    shown: shown.value.shown.items,
    models: available,
    current:
      current === null
        ? null
        : { provider: current.provider, model_name: current.model_name },
    query: "",
  });
  const models: AcpModelGroup[] = layout.providers.map((group) => ({
    id: group.provider,
    label:
      providers.value.find((provider) => provider.id === group.provider)
        ?.name ?? group.provider,
    models: group.models.map((one) => {
      const entry = selectable.get(
        acpModelId(one.provider, one.model_name),
      )?.entry;
      return {
        id: acpModelId(one.provider, one.model_name),
        label: one.model_name,
        axes:
          entry === null || entry === undefined
            ? []
            : optionAxesOf(entry).map(({ id, label, values }) => ({
                id,
                label,
                values,
              })),
      };
    }),
  }));
  return {
    models,
    model:
      current === null
        ? null
        : {
            model: acpModelId(current.provider, current.model_name),
            label: current.model_name,
            options: current.option_values,
            layer,
          },
  };
}

export async function readUsage(
  env: AcpEnv,
  session: string,
): Promise<AcpUsage | null> {
  const read = await env.read<Output<typeof sessionStatusRead>>(
    sessionStatusRead,
    { session },
  );
  if (!read.ok) return null;
  const { context, tokens, turns, costs, provider } = read.value;
  return {
    context,
    input_tokens: tokens.input,
    output_tokens: tokens.output,
    cache_read_tokens: tokens.cache_read,
    cache_write_tokens: tokens.cache_write,
    turns,
    costs: costs.map(({ kind, currency, amount }) => ({
      kind,
      currency,
      amount,
    })),
    provider:
      provider === null
        ? null
        : {
            name: provider.name,
            definition: provider.definition,
            account: provider.account,
            state: provider.state,
            until: provider.until,
          },
  };
}

type MetaParts = {
  title: string | null;
  skip: boolean;
  model: Pick<AcpSessionMeta, "models" | "model">;
  usage: AcpUsage | null;
  commands: AcpSessionMeta["commands"];
};

// session meta의 모양은 여기 하나다. session과 draft(첫 메시지 전)가 읽은 칸만 다르다.
function metaOf(env: AcpEnv, parts: MetaParts): AcpSessionMeta {
  return {
    title: parts.title === null ? null : env.redact(parts.title),
    cli_session: null,
    capabilities: CAPABILITIES,
    ...parts.model,
    modes: AGENT_MODES,
    mode: parts.skip ? "skip" : "ask",
    commands: parts.commands,
    usage: parts.usage,
  };
}

function commandsOf(
  env: AcpEnv,
  read: Result<Output<typeof commandsList>>,
): AcpSessionMeta["commands"] {
  return read.ok
    ? read.value.commands.map((one) => ({
        name: one.name,
        description: env.redact(one.description),
        argument_hint: null,
        source: one.source,
      }))
    : [];
}

/** 이름 목록은 사람 자격으로만 읽힌다(`ListCommands`). 그래서 부른 사람의 read를 받는다. */
export async function readSessionMeta(
  env: AcpEnv,
  session: string,
  readAsCaller: AcpEnv["read"],
): Promise<AcpSessionMeta | null> {
  const record = await readSessionRecord(env, session);
  if (!record.ok) return null;
  const [model, usage, commands] = await Promise.all([
    readModelPart(env, record.value),
    readUsage(env, session),
    readAsCaller<Output<typeof commandsList>>(commandsList, { session }),
  ]);
  return metaOf(env, {
    title: record.value.title,
    skip: record.value.skip,
    model,
    usage,
    commands: commandsOf(env, commands),
  });
}

/**
 * 첫 메시지 전 새 session 화면의 meta. 그 agent와 place로 지금 session을 열면 받을 값이다: session이 고른 model이
 * 없어 agent 기본값이고, mode는 ask, title·usage는 없다. 명령은 `readSessionMeta`와 같이 부른 사람의 read로 읽는다.
 */
export async function readDraftMeta(
  env: AcpEnv,
  draft: { agent: AgentId; place: Place | null },
  readAsCaller: AcpEnv["read"],
): Promise<AcpSessionMeta> {
  const [model, commands] = await Promise.all([
    readModelPart(env, { ...draft, model_selection: null }),
    readAsCaller<Output<typeof commandsList>>(commandsList, draft),
  ]);
  return metaOf(env, {
    title: null,
    skip: false,
    model,
    usage: null,
    commands: commandsOf(env, commands),
  });
}

/** 바뀐 칸만 읽어 `session_changed` 한 건으로 낸다. 읽지 못하면 null이고 화면은 다음 snapshot에서 맞춘다. */
export async function sessionChangeOf(
  env: AcpEnv,
  session: string,
  changed: "title" | "mode" | "model" | "usage",
): Promise<AcpUpdate | null> {
  if (changed === "usage") {
    const usage = await readUsage(env, session);
    return usage === null
      ? null
      : { type: "session_changed", session: { usage } };
  }
  const record = await readSessionRecord(env, session);
  if (!record.ok) return null;
  switch (changed) {
    case "title":
      return {
        type: "session_changed",
        session: {
          title:
            record.value.title === null ? null : env.redact(record.value.title),
        },
      };
    case "mode":
      return {
        type: "session_changed",
        session: { mode: record.value.skip ? "skip" : "ask" },
      };
    case "model":
      // 고른 model이 바뀌면 창 한도도 바뀐다.
      return {
        type: "session_changed",
        session: {
          ...(await readModelPart(env, record.value)),
          usage: await readUsage(env, session),
        },
      };
  }
}

// ---------------------------------------------------------------- 갱신

// event를 받은 그 순간에만 알 수 있는 값이다(요청이 닫히면 결정이 지워지고 묻기가 풀리면 질문이 사라진다).
export type AcpCaptured = {
  queuedHuman: boolean;
  decision: Promise<{
    choice: "once" | "always" | null;
    reason: string | null;
  } | null> | null;
  questions: NonNullable<AcpPending["question"]>["questions"];
};

/**
 * AgentEvent 하나를 ACP 갱신으로 바꾼다. 순번을 저장하고, 본문과 tool 칸을 기록에서 읽고, 글은 redaction을 거쳐 `acpUpdatesOf`에
 * 넘긴다. snapshot과 같은 읽기 함수를 쓴다.
 */
export async function acpUpdatesFor(
  deps: {
    env: AcpEnv;
    allocate(
      session: string,
      items: AcpAlloc[],
    ): Promise<Result<Map<string, number>>>;
    /** 승인 요청의 내용(redaction을 거친 것). 닫힐 때 결과 항목으로 저장한다. */
    openRequests: Map<string, TurnRequest["subject"]>;
  },
  event: AgentEvent,
  cap: AcpCaptured,
): Promise<AcpUpdate[]> {
  const { env, allocate, openRequests } = deps;
  const session = event.session;
  const alloc: AcpAlloc[] = [];
  const message = (id: string, turn: string | null, at: string) =>
    alloc.push({ id, kind: "message", turn, at, data: null });
  let projected: AgentEvent = event;
  let body: MessageBody | null = null;
  let detail = null as Awaited<ReturnType<typeof readToolDetail>>;
  let decision: Awaited<NonNullable<AcpCaptured["decision"]>> = null;
  const agents = new Map<string, AgentId | null>();
  const names = new Map<string, string | null>();
  switch (event.type) {
    case "MessageReceived": {
      const { message: id, from } = event.payload;
      projected = {
        ...event,
        payload: {
          ...event.payload,
          body: redactBlocks(env, event.payload.body),
        },
      };
      if (!cap.queuedHuman) message(id, null, event.at);
      if (from.kind === "agent") {
        const agent = await agentOfSession(env, from.session);
        agents.set(from.session, agent);
        if (agent !== null) names.set(agent, await agentNameOf(env, agent));
      }
      break;
    }
    case "MessageSteered":
      message(event.payload.message, null, event.at);
      break;
    case "TurnStarted":
      message(event.payload.input_message, event.payload.turn, event.at);
      break;
    case "TurnEnded":
      for (const id of event.payload.messages) {
        message(id, event.payload.turn, event.at);
      }
      alloc.push({
        id: acpNoticeId(event.payload.turn),
        kind: "notice",
        turn: event.payload.turn,
        at: event.at,
        data: null,
      });
      break;
    case "MessageRecorded":
      message(event.payload.message, event.payload.turn, event.at);
      body = await readMessageBody(env, event.payload.message);
      break;
    case "ToolCallStarted":
      alloc.push({
        id: event.payload.tool_call,
        kind: "tool",
        turn: event.payload.turn,
        at: event.at,
        data: null,
      });
      // 입력은 시작 event 전에 저장되므로 종류와 입력에서 뽑는 칸을 시작 때부터 낸다.
      detail =
        (await readToolDetail(env, event.payload.tool_call)) ??
        startDetail(event.payload.tool);
      break;
    case "ToolCallEnded":
      detail = await readToolDetail(env, event.payload.tool_call);
      break;
    case "TurnRequestOpened": {
      const { request } = event.payload;
      const subject = redactDeep(env, request.subject);
      openRequests.set(request.id, subject);
      projected = {
        ...event,
        payload: { request: { ...request, subject } },
      };
      break;
    }
    case "TurnRequestClosed": {
      const { request } = event.payload;
      const subject = openRequests.get(request);
      openRequests.delete(request);
      decision = (await cap.decision) ?? null;
      // 결과 항목은 기록에서 다시 만들 수 없어 내용을 같이 저장한다. harness 물음은 대화에 들지 않는다.
      if (subject !== undefined && subject.kind !== "harness") {
        const outcome =
          event.payload.outcome === "allow"
            ? "allowed"
            : event.payload.outcome === "reject"
              ? "denied"
              : "cancelled";
        alloc.push({
          id: request,
          kind: "approval",
          turn: null,
          at: event.at,
          data: JSON.stringify({
            subject,
            outcome,
            choice:
              event.payload.outcome === "allow"
                ? (decision?.choice ?? null)
                : null,
            reason:
              event.payload.outcome === "reject"
                ? (decision?.reason ?? null)
                : null,
          }),
        });
      }
      break;
    }
    default:
      break;
  }
  let seqs = new Map<string, number>();
  if (alloc.length > 0) {
    const allocated = await allocate(session, alloc);
    // 순번을 못 붙이면 갱신을 내지 않는다. 화면은 다음 갱신의 순번 건너뜀으로 다시 읽는다.
    if (!allocated.ok) return [];
    seqs = allocated.value;
  }
  return acpUpdatesOf(projected, {
    seq: (id) => seqs.get(id) ?? null,
    tool: () => detail,
    questions: () =>
      cap.questions === null ? null : redactDeep(env, cap.questions),
    agentOf: (from) => agents.get(from) ?? null,
    agentName: (agent) => names.get(agent) ?? null,
    body: () => body,
    decision: () => decision,
  });
}
