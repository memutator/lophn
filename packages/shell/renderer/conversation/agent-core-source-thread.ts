// 한 session 화면(thread): 확정 메시지, run의 tool 줄·편집 카드·끝 줄, 대화 안 질문 묶음, 지금 일, 승인.
// tool 줄·편집 카드·끝 줄은 메시지가 아니라 run 기록에서 그린다(shell/desktop#R41). 기록에 없는 줄은 그리지
// 않는다. 줄 순서는 원장 seq이고, 메시지가 아닌 줄은 그 run의 메시지에 맞춰 둔다.
import { t } from "@lophn/wording";

import type { EditView, TaskView, ToolLineView } from "./activity/model.ts";
import type { ApprovalCardRequest } from "./approval-card/model.ts";
import type {
  AnswerSummaryStatus,
  GroupAnswer,
  QuestionGroupView,
} from "./question-card/model.ts";
import type {
  EditUndo,
  ResultLink,
  SourceResult,
  ThreadEntry,
  ThreadMessage,
  ThreadView,
} from "./agent-source.ts";
import type { Page } from "./agent-core-source-link.ts";
import {
  type AgentEnv,
  fillTimes,
  latestRun,
  runsOfSession,
} from "./agent-core-source-env.ts";
import {
  groupAt,
  hiddenFacts,
  hiddenGroups,
  undoStateOf,
} from "./agent-core-source-rewind.ts";
import type {
  GroupTextValue,
  GroupValue,
  MessageLinkValue,
  MessageSnapshot,
  RevertValue,
  RunValue,
  SessionValue,
  ToolCallValue,
} from "./agent-core-source-values.ts";

/** 끝난 run과 고정된 판은 바뀌지 않으므로 한 번 읽으면 다시 읽지 않는다. */
export interface ThreadMemo {
  readonly tools: Map<string, ToolGroup[]>;
  /** 끝난 run의 tool call 전부. 편집 카드를 문서를 쓴 call과 짝짓는 데 쓴다. */
  readonly calls: Map<string, ToolCallValue[]>;
  readonly edits: Map<string, EditView>;
  readonly texts: Map<string, GroupTextValue>;
  /** 편집 카드(판 id) → 그 편집을 쓴 tool call. Undo가 쓴다. */
  readonly editCalls: Map<string, string>;
  /** call별 Undo 사전 검사. 파일은 바뀔 수 있어 잠깐만 기억한다. */
  readonly undo: Map<string, { at: number; value: EditUndo }>;
}

export function createThreadMemo(): ThreadMemo {
  return {
    tools: new Map(),
    calls: new Map(),
    edits: new Map(),
    texts: new Map(),
    editCalls: new Map(),
    undo: new Map(),
  };
}

interface ToolGroup {
  readonly line: ToolLineView;
  readonly at: string | null;
}

/** 줄 순서 key. seq를 4배 해서 같은 seq의 앞뒤에 줄을 끼운다. */
const BEFORE = -1n;
const SAME = 0n;
const AFTER = 1n;
const FOLLOW = 2n;
/** 아직 끝나지 않은 run의 줄은 맨 끝이다. */
const END = 1n << 70n;

const keyOf = (seq: string, offset: bigint): bigint =>
  BigInt(seq) * 4n + offset;

interface Placed {
  readonly key: bigint;
  readonly entry: ThreadEntry;
  /** 편집 카드를 쓴 tool call. 어느 call인지 모르면 null이다. */
  readonly call?: string | null;
}

const DOCUMENT_WRITES = new Set(["document.create", "document.save_version"]);

function resultsOf(links: readonly MessageLinkValue[]): ResultLink[] {
  const results: ResultLink[] = [];
  for (const link of links) {
    if (link.kind === "document" && link.document) {
      results.push({ kind: "document", document: link.document });
    }
    if (link.kind === "context" && link.context) {
      results.push({ kind: "context", context: link.context });
    }
    if (link.kind === "version" && link.document && link.version) {
      results.push({
        kind: "version",
        document: link.document,
        version: link.version,
      });
    }
  }
  return results;
}

function actorOf(actor: string): ThreadMessage["actor"] {
  if (actor === "user") return "user";
  if (actor === "machine") return "machine";
  return "agent";
}

// ---------------------------------------------------------------- tool lines

function bucketOf(tool: string): string {
  return tool.startsWith("document.read") || tool === "document.get"
    ? "documents"
    : tool;
}

function lineOf(call: ToolCallValue): string {
  return call.outcome === null || call.outcome.kind === "success"
    ? call.tool
    : `${call.tool} (${call.outcome.kind})`;
}

function groupsOf(calls: readonly ToolCallValue[]): ToolGroup[] {
  // 재시도한 호출은 마지막 시도 하나만 보인다.
  const retried = new Set(
    calls.flatMap((call) => call.retry_of === null ? [] : [call.retry_of]),
  );
  const shown = calls.filter((call) =>
    !retried.has(call.id) && !DOCUMENT_WRITES.has(call.tool)
  );
  const groups: ToolGroup[] = [];
  let run: ToolCallValue[] = [];
  const flush = () => {
    const first = run[0];
    if (first === undefined) return;
    const bucket = bucketOf(first.tool);
    groups.push({
      at: first.started_at ?? first.finished_at,
      line: {
        id: first.id,
        label: bucket === "documents"
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
  for (const call of shown) {
    if (run.length > 0 && bucketOf(run[0]!.tool) !== bucketOf(call.tool)) {
      flush();
    }
    run.push(call);
  }
  flush();
  return groups;
}

async function callsOf(
  env: AgentEnv,
  memo: ThreadMemo,
  run: RunValue,
): Promise<ToolCallValue[] | null> {
  const known = memo.calls.get(run.id);
  if (known !== undefined) return known;
  const listed = await env.link.pages<ToolCallValue>(
    "tool-calls",
    "list",
    { run: run.id },
    "tool_calls",
  );
  if (!listed.ok) return null;
  if (run.state === "finished") memo.calls.set(run.id, listed.value);
  return listed.value;
}

async function toolsOf(
  env: AgentEnv,
  memo: ThreadMemo,
  run: RunValue,
): Promise<ToolGroup[] | null> {
  const known = memo.tools.get(run.id);
  if (known !== undefined) return known;
  const calls = await callsOf(env, memo, run);
  if (calls === null) return null;
  const groups = groupsOf(calls);
  if (run.state === "finished") memo.tools.set(run.id, groups);
  return groups;
}

/**
 * 한 run에서 문서를 쓴 call(성공한 마지막 시도)을 쓴 순서로. 편집 카드는 판 하나마다 한 장이라 같은 run의 카드를
 * 이 call들과 순서대로 짝짓는다.
 */
function writeCallsOf(calls: readonly ToolCallValue[]): ToolCallValue[] {
  const retried = new Set(
    calls.flatMap((call) => call.retry_of === null ? [] : [call.retry_of]),
  );
  return calls.filter((call) =>
    !retried.has(call.id) && DOCUMENT_WRITES.has(call.tool) &&
    call.outcome?.kind === "success"
  );
}

// ---------------------------------------------------------------- edit cards

interface DocumentGetValue {
  document: { title: string; name: string | null };
  version: { number: number };
}

interface DiffPageValue {
  additions: { range: { start_line: number; end_line: number } }[];
  deletions: { range: { start_line: number; end_line: number } }[];
}

const spanOf = (
  runs: readonly { range: { start_line: number; end_line: number } }[],
): number =>
  runs.reduce(
    (sum, item) => sum + item.range.end_line - item.range.start_line + 1,
    0,
  );

async function linesOf(
  env: AgentEnv,
  document: string,
  version: string,
): Promise<number | null> {
  const pages = await env.link.walk<
    { text: string | null; next_cursor: string | null }
  >("documents", "read", {
    reference: { document, version, section: null },
  }, "worker");
  if (!pages.ok) return null;
  let lines = 0;
  for (const page of pages.value) {
    const text = page.text ?? "";
    if (text !== "") lines += text.replace(/\n$/, "").split("\n").length;
  }
  return lines;
}

/** 이 판이 만든 줄 수의 바뀜. 읽지 못하면 null이고 카드를 그리지 않는다. */
async function editOf(
  env: AgentEnv,
  memo: ThreadMemo,
  document: string,
  version: string,
): Promise<EditView | null> {
  const known = memo.edits.get(version);
  if (known !== undefined) return known;
  const read = await env.link.read<DocumentGetValue>("documents", "get", {
    document,
    version,
  });
  if (!read.ok) return null;
  const { number } = read.value.version;
  let added: number;
  let removed = 0;
  if (number > 1) {
    const history = await env.link.read<
      { versions: { id: string; number: number }[] }
    >("documents", "history", { document });
    if (!history.ok) return null;
    const before = history.value.versions.find((item) =>
      item.number === number - 1
    );
    if (before === undefined) return null;
    const diff = await env.link.walk<DiffPageValue & Page>(
      "documents",
      "diff",
      { document, before: before.id, after: version, section: null },
      "worker",
    );
    if (!diff.ok) return null;
    added = 0;
    for (const page of diff.value) {
      added += spanOf(page.additions);
      removed += spanOf(page.deletions);
    }
  } else {
    const lines = await linesOf(env, document, version);
    if (lines === null) return null;
    added = lines;
  }
  const edit: EditView = {
    id: version,
    document,
    path: read.value.document.name ?? read.value.document.title,
    added,
    removed,
  };
  memo.edits.set(version, edit);
  return edit;
}

// ---------------------------------------------------------------- questions

function summaryOf(
  group: GroupValue,
  text: GroupTextValue,
): { status: AnswerSummaryStatus; answers: GroupAnswer[] } {
  if (group.status === "expired") return { status: "expired", answers: [] };
  if (group.status === "cancelled") {
    return {
      status: group.closed_reason === "deferred" ? "skipped" : "cancelled",
      answers: [],
    };
  }
  const answers = group.questions.flatMap((question): GroupAnswer[] => {
    const answer = question.answer;
    if (answer === null) return [];
    if (answer.kind === "option") {
      return [{
        question: question.id,
        answer: { kind: "option", option_key: answer.option_key },
      }];
    }
    const given = text.questions.find((item) => item.question === question.id);
    return [{
      question: question.id,
      answer: { kind: "text", text: given?.answer_text ?? "" },
    }];
  });
  // 고정 action 선택지를 고른 답은 적용 상태가 따로 있다.
  const only = group.questions.length === 1 ? group.questions[0]! : null;
  const given = only?.answer ?? null;
  const chosen = given?.kind === "option"
    ? only!.options.find((option) => option.key === given.option_key)
    : undefined;
  if (chosen?.action) {
    return { status: only!.applied ? "applied" : "applying", answers };
  }
  return { status: "answered", answers };
}

function groupViewOf(
  group: GroupValue,
  text: GroupTextValue,
  agentName: string,
): QuestionGroupView {
  return {
    id: group.id,
    agentName,
    expires_at: group.expires_at,
    questions: group.questions.map((question) => {
      const given = text.questions.find((item) =>
        item.question === question.id
      );
      return {
        id: question.id,
        prompt: given?.prompt ?? "",
        reason: given?.reason ?? "",
        options: question.options.map((option) => ({
          key: option.key,
          label: option.label,
          description: given?.options.find((item) => item.key === option.key)
            ?.description ?? "",
        })),
        recommendation: question.recommendation === null ? null : {
          option_key: question.recommendation.option_key,
          explanation: given?.recommendation?.explanation ?? "",
        },
      };
    }),
  };
}

async function textOf(
  env: AgentEnv,
  memo: ThreadMemo,
  group: GroupValue,
): Promise<GroupTextValue | null> {
  const key = `${group.id}:${group.closed_seq ?? ""}`;
  const known = memo.texts.get(key);
  if (known !== undefined) return known;
  const read = await env.link.read<GroupTextValue>("questions", "text", {
    group: group.id,
  });
  if (!read.ok) return null;
  memo.texts.set(key, read.value);
  return read.value;
}

// ---------------------------------------------------------------- approval

async function approvalOf(
  env: AgentEnv,
  approval: string,
): Promise<ApprovalCardRequest | null> {
  const got = await env.link.read<
    { request: { session_grantable: boolean } }
  >("approvals", "get", { approval });
  if (!got.ok) return null;
  const text = await env.link.read<{ reason: string; changes: string }>(
    "approvals",
    "text",
    { approval },
  );
  if (!text.ok) return null;
  const first = text.value.changes.split("\n")[0]!.trim();
  return {
    id: approval,
    title: first,
    reason: text.value.reason,
    preview: null,
    allowSession: got.value.request.session_grantable,
  };
}

// ---------------------------------------------------------------- thread

const PHASE = {
  accepted: "working",
  running: "working",
  waiting_user: "waiting",
  finished: "ended",
} as const;

export async function readThread(
  env: AgentEnv,
  memo: ThreadMemo,
  session: string,
  agentName: () => Promise<string>,
): Promise<SourceResult<ThreadView>> {
  const { link } = env;
  const record = await link.read<{ session: SessionValue }>(
    "sessions",
    "read",
    { session },
  );
  if (!record.ok) return record;
  const messages = await link.pages<MessageSnapshot>(
    "messages",
    "list",
    { session },
    "messages",
  );
  if (!messages.ok) return messages;
  const allRuns = await env.runsOf();
  if (!allRuns.ok) return allRuns;
  const groups = await link.pages<GroupValue>(
    "questions",
    "list",
    { session },
    "groups",
  );
  if (!groups.ok) return groups;

  const runs = runsOfSession(allRuns.value, session);
  // 끝난 run의 call만 기억한다. 진행 중인 run은 읽을 때마다 새로 읽는다.
  for (const run of runs) {
    if (run.state !== "finished") memo.calls.delete(run.id);
  }
  const runById = new Map(runs.map((run) => [run.id, run]));
  const latest = latestRun(runs);

  // 시각: 메시지와 질문 묶음은 만들어진 event, 나머지는 기록에 든 시각이다.
  await fillTimes(env, [
    ...messages.value.map((item) => ({
      subject: item.message.id,
      seq: item.created_seq,
    })),
    ...groups.value.map((group) => ({
      subject: group.id,
      seq: group.created_seq,
    })),
  ]);
  let lastAt = env.nowIso();
  const atOf = (seq: string): string => {
    const known = env.times.get(seq);
    if (known !== undefined) lastAt = known;
    return known ?? lastAt;
  };

  const placed: Placed[] = [];
  const firstAgent = new Map<string, string>();

  for (const item of messages.value) {
    const { message } = item;
    const run = message.run === null ? undefined : runById.get(message.run);
    if (message.run !== null && actorOf(message.actor) === "agent") {
      const seen = firstAgent.get(message.run);
      if (seen === undefined || BigInt(item.created_seq) < BigInt(seen)) {
        firstAgent.set(message.run, item.created_seq);
      }
    }
    placed.push({
      key: keyOf(item.created_seq, SAME),
      entry: {
        kind: "message",
        id: message.id,
        at: atOf(item.created_seq),
        actor: actorOf(message.actor),
        run: message.run === null ? null : {
          id: message.run,
          ended: run === undefined || run.state === "finished",
        },
        mode: message.mode,
        applied: message.applied_at_call !== null ||
          message.copied_from !== null,
        results: resultsOf(message.links),
      },
    });
  }

  // 편집 카드: agent 메시지가 결과로 건 판마다 한 장, 그 메시지 바로 뒤다. 같은 run에서 문서를 쓴 call의 수와 카드의
  // 수가 맞으면 순서대로 짝짓고, 맞지 않으면 어느 call의 편집인지 모르는 것이다(Undo를 열지 않는다).
  const seenEdits = new Set<string>();
  const cards = new Map<string, { item: MessageSnapshot; version: string }[]>();
  for (const item of messages.value) {
    if (actorOf(item.message.actor) !== "agent") continue;
    for (const link of item.message.links) {
      if (link.kind !== "version" || !link.document || !link.version) continue;
      if (seenEdits.has(link.version)) continue;
      seenEdits.add(link.version);
      const run = item.message.run ?? "";
      cards.set(run, [...(cards.get(run) ?? []), {
        item,
        version: link.version,
      }]);
    }
  }
  for (const [runId, listed] of cards) {
    const run = runById.get(runId);
    const calls = run === undefined ? null : await callsOf(env, memo, run);
    const writes = calls === null ? [] : writeCallsOf(calls);
    const matched = writes.length === listed.length;
    for (const [index, { item, version }] of listed.entries()) {
      const document = item.message.links.find((link) =>
        link.kind === "version" && link.version === version
      )!.document!;
      const edit = await editOf(env, memo, document, version);
      if (edit === null) continue;
      const call = matched ? writes[index]!.id : null;
      if (call !== null) memo.editCalls.set(version, call);
      placed.push({
        key: keyOf(item.created_seq, AFTER),
        call,
        entry: {
          kind: "edit",
          id: edit.id,
          at: atOf(item.created_seq),
          edit,
          // 되돌린 상태와 Undo를 누를 수 있는지는 아래에서 되돌리기 기록으로 채운다.
          undone: false,
          undo: { can: false, reason: "unknown" },
        },
      });
    }
  }

  // tool 줄과 끝 줄은 run마다다.
  for (const run of runs) {
    const groupsOfRun = await toolsOf(env, memo, run);
    const agentSeq = firstAgent.get(run.id);
    const toolKey = agentSeq !== undefined
      ? keyOf(agentSeq, BEFORE)
      : run.state === "finished"
      ? keyOf(run.state_seq, BEFORE)
      : END;
    for (const group of groupsOfRun ?? []) {
      placed.push({
        key: toolKey,
        entry: {
          kind: "tools",
          id: group.line.id,
          at: group.at ?? lastAt,
          tool: group.line,
        },
      });
    }
    if (run.state === "finished") {
      placed.push({
        key: keyOf(run.state_seq, FOLLOW),
        entry: {
          kind: "run-end",
          id: `end-${run.id}`,
          at: run.finished_at ?? lastAt,
          outcome: run.outcome?.kind === "completed" ? "completed" : "stopped",
          durationMs: run.elapsed.active_ms,
        },
      });
    }
  }

  // 질문 묶음.
  const name = await agentName();
  for (const group of groups.value) {
    const text = await textOf(env, memo, group);
    if (text === null) continue;
    placed.push({
      key: keyOf(group.created_seq, SAME),
      entry: {
        kind: "questions",
        id: group.id,
        at: atOf(group.created_seq),
        group: groupViewOf(group, text, name),
        answered: group.status === "pending" ? null : summaryOf(group, text),
      },
    });
  }

  // 되돌리기 기록(rewind/list)으로 숨긴 구간을 접고 Undo한 편집을 안다. 못 읽으면 숨겨야 할 줄을 보이지 않도록
  // thread를 읽지 못한 것으로 한다.
  const reverts = await link.pages<RevertValue>(
    "rewind",
    "list",
    { session },
    "reverts",
  );
  if (!reverts.ok) return reverts;
  const ranges = hiddenGroups(reverts.value);
  const undone = new Set(
    reverts.value.flatMap((revert) =>
      revert.kind === "undo" && revert.outcome === "applied" &&
        revert.tool_call !== null
        ? [revert.tool_call]
        : []
    ),
  );

  // 순서가 같은 줄은 만든 순서를 지킨다.
  const ordered = placed
    .map((item, index) => ({ ...item, index }))
    .sort((left, right) =>
      left.key < right.key
        ? -1
        : left.key > right.key
        ? 1
        : left.index - right.index
    );

  // 숨긴 구간(boundary_seq부터 result_seq까지)의 줄은 한 줄로 접는다. 끝나지 않은 run의 줄은 구간 끝(END)이라
  // 접히지 않는다.
  type Out = { key: bigint; entry: ThreadEntry; call: string | null };
  const out: Out[] = [];
  const folded = new Map<
    ReturnType<typeof groupAt>,
    { key: bigint; entries: ThreadEntry[] }
  >();
  for (const item of ordered) {
    const group = item.key >= END
      ? undefined
      : groupAt(ranges, (item.key + 1n) / 4n);
    if (group === undefined) {
      out.push({ key: item.key, entry: item.entry, call: item.call ?? null });
      continue;
    }
    const bucket = folded.get(group);
    if (bucket === undefined) {
      folded.set(group, { key: item.key, entries: [item.entry] });
    } else bucket.entries.push(item.entry);
  }
  for (const [group, bucket] of folded) {
    const messages = bucket.entries.filter((entry) => entry.kind === "message");
    if (group === undefined || messages.length === 0) continue;
    const facts = hiddenFacts(group);
    out.push({
      key: bucket.key,
      call: null,
      entry: {
        kind: "hidden",
        id: `hidden-${facts.revert}`,
        at: bucket.entries[0]!.at,
        count: messages.length,
        entries: bucket.entries,
        ...facts,
      },
    });
  }
  out.sort((left, right) =>
    left.key < right.key ? -1 : left.key > right.key ? 1 : 0
  );

  // 눈에 보이는 편집 카드만 Undo를 누를 수 있는지 묻는다. Undo한 call은 되돌린 카드다.
  const entries = await Promise.all(
    out.map(async (item): Promise<ThreadEntry> => {
      const { entry, call } = item;
      if (entry.kind !== "edit" || call === null) return entry;
      if (undone.has(call)) {
        return {
          ...entry,
          undone: true,
          undo: { can: false, reason: "already_reverted" },
        };
      }
      return { ...entry, undo: await undoStateOf(env, memo, session, call) };
    }),
  );

  const approval = latest?.state === "waiting_user" &&
      latest.waiting_on?.startsWith("apr_")
    ? await approvalOf(env, latest.waiting_on)
    : null;
  // 할 일 목록을 남기는 기록은 아직 contract에 없어 비어 있다.
  const tasks: TaskView[] = [];
  return {
    ok: true,
    value: {
      entries,
      run: latest === null
        ? null
        : { id: latest.id, phase: PHASE[latest.state] },
      tasks,
      approval,
    },
  };
}
