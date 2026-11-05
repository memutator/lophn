// ACP 상태(`AcpState`)를 화면 줄(`ThreadView`)로 늘어놓는다. 순서는 항목의 `seq`가 정하고 이 함수는 시각을 보지
// 않는다. snapshot과 갱신을 접은 상태가 같으면 줄도 같아서 turn이 끝나고 snapshot을 다시 읽어도 줄이 튀지
// 않는다. 하는 일은 이어진 tool call 묶기와 항목 종류를 줄 종류로 옮기는 것뿐이다.
import {
  blocksSummary,
  blocksText,
  type ContentBlock,
} from "../../../protocol/lophn-agent/content-block.ts";
import type {
  AcpEntry,
  AcpItem,
  AcpMessageItem,
  AcpState,
  AcpToolItem,
} from "../../../protocol/acp/mod.ts";
import type { ToolCallView } from "./activity/model.ts";
import { groupToolCalls } from "./activity/tool-groups.ts";
import type {
  BodyPart,
  ThreadEntry,
  ThreadMessage,
  ThreadView,
} from "./agent-tab-source.ts";

/** content block을 본문 part로. */
export function partsOfContent(content: readonly ContentBlock[]): BodyPart[] {
  return content.map((block): BodyPart => {
    switch (block.type) {
      case "text":
        return { kind: "text", text: block.text };
      case "image":
        return { kind: "image", blob: block.blob };
      case "resource_link":
        return { kind: "resource_link", uri: block.uri, name: block.name };
      case "resource":
        return { kind: "resource", uri: block.uri, text: block.text };
    }
  });
}

function partsOf(item: AcpMessageItem): BodyPart[] {
  return [
    ...(item.reasoning === null
      ? []
      : [
          {
            kind: "reasoning" as const,
            text: item.reasoning.text,
            durationMs: item.reasoning.duration_ms,
          },
        ]),
    ...partsOfContent(item.content),
    ...item.cards.map(
      (card): BodyPart => ({
        kind: "app_card",
        app: card.app,
        view: card.view,
      }),
    ),
  ];
}

/**
 * 항목이 그대로면 줄도 그대로여야 한다. 쓰는 글이 자라는 동안 이미 다 쓴 message를 다시 그리지 않으려고
 * (`MessageBody`는 memo다) 항목 객체별로 만든 줄을 기억한다. `reduceAcp`는 바뀌지 않은 항목의 객체를 그대로 둔다.
 */
export interface LayoutCache {
  readonly entries: WeakMap<AcpItem, ThreadEntry | null>;
  readonly calls: WeakMap<AcpToolItem, ToolCallView>;
  readonly groups: WeakMap<
    ToolCallView,
    { calls: readonly ToolCallView[]; entry: ThreadEntry }
  >;
}

export function createLayoutCache(): LayoutCache {
  return {
    entries: new WeakMap(),
    calls: new WeakMap(),
    groups: new WeakMap(),
  };
}

function callViewOf(item: AcpToolItem, cache: LayoutCache): ToolCallView {
  let view = cache.calls.get(item);
  if (view === undefined) {
    view = {
      id: item.id,
      tool: item.tool,
      category: item.category,
      title: item.title,
      state: item.state,
      startedAt: item.at,
      durationMs: item.duration_ms,
    };
    cache.calls.set(item, view);
  }
  return view;
}

function messageEntry(item: AcpMessageItem): ThreadMessage | null {
  const parts = partsOf(item);
  // 본문을 아직 모르는 agent message는 snapshot을 다시 읽어 채울 때까지 줄이 없다.
  if (item.actor === "agent" && parts.length === 0) return null;
  return {
    kind: "message",
    id: item.id,
    at: item.at,
    actor: item.actor,
    sender:
      item.sender === null
        ? null
        : item.sender.kind === "program"
          ? { kind: "program", label: null }
          : item.sender,
    call: item.call,
    replyTo: item.reply_to,
    delivery: item.delivery,
    turn: item.turn,
    origin: item.origin,
    parts,
  };
}

/** tool이 아닌 항목과 종류가 정해진 tool을 줄 하나로. 줄이 없으면 null이다. */
function entryOf(item: AcpItem): ThreadEntry | null {
  switch (item.kind) {
    case "message":
      return messageEntry(item);
    case "approval":
      return {
        kind: "approval-result",
        id: item.id,
        at: item.at,
        result: {
          request: item.id,
          subject: item.subject,
          outcome: item.outcome,
          choice: item.choice,
          reason: item.reason,
        },
      };
    case "notice": {
      const { notice } = item;
      if (notice.type === "info") {
        return {
          kind: "info",
          id: item.id,
          at: item.at,
          text: notice.text,
          level: notice.level,
          turn: item.turn,
        };
      }
      if (notice.type === "command_output") {
        return {
          kind: "command-output",
          id: item.id,
          at: item.at,
          command: notice.command,
          text: notice.text,
          format: notice.format,
          turn: item.turn,
        };
      }
      // turn_end·error는 늘 turn이 있다.
      if (item.turn === null) return null;
      return notice.type === "error"
        ? {
            kind: "provider-error",
            id: item.id,
            at: item.at,
            turn: item.turn,
            code: notice.code,
            message: notice.message,
          }
        : {
            kind: "turn-end",
            id: item.id,
            at: item.at,
            turn: item.turn,
            outcome: notice.outcome,
            activeMs: notice.active_ms,
            waitedMs: notice.waited_ms,
          };
    }
    case "hidden":
      return {
        kind: "hidden",
        id: item.id,
        at: item.at,
        checkpoint: item.checkpoint,
        choice: item.choice,
        count: item.count,
        restored: item.restored,
        left: item.left,
        entries: layoutEntries(item.items, createLayoutCache()),
      };
    case "tool": {
      const { detail } = item;
      switch (detail.kind) {
        case "edit":
          return {
            kind: "edit",
            id: item.id,
            at: item.at,
            edit: {
              id: item.id,
              document: detail.document,
              path: detail.path,
              added: detail.added,
              removed: detail.removed,
              toolState: item.state,
            },
          };
        case "call":
          return {
            kind: "call",
            id: item.id,
            at: item.at,
            call: {
              call: detail.call,
              to: detail.to,
              task: detail.task,
              reply: detail.reply,
              status:
                detail.state === null
                  ? null
                  : { state: detail.state, reason: detail.fail_reason },
              toolState: item.state,
              session: detail.session,
            },
          };
        case "question":
          // 풀리지 않은 묶음은 `pending.question`의 카드가 보인다.
          return detail.outcome === null && item.state === "running"
            ? null
            : {
                kind: "questions",
                id: item.id,
                at: item.at,
                group: detail.group ?? item.id,
                outcome: detail.outcome ?? "cancelled",
                lines: detail.lines,
              };
        case "consent":
          return {
            kind: "release-consent",
            id: item.id,
            at: item.at,
            release: detail.release,
          };
        case "generic":
        case "subagent":
          return null;
      }
    }
  }
}

/** 순번 순서의 항목을 줄로. 사이에 다른 줄이 없는 일반 tool call은 종류별로 묶는다. */
export function layoutEntries(
  items: readonly (AcpItem | AcpEntry)[],
  cache: LayoutCache,
): ThreadEntry[] {
  const out: ThreadEntry[] = [];
  let run: ToolCallView[] = [];
  let runTurn: string | null = null;
  const flush = () => {
    for (const calls of groupToolCalls(run)) {
      const first = calls[0]!;
      const known = cache.groups.get(first);
      if (
        known !== undefined &&
        known.calls.length === calls.length &&
        known.calls.every((call, index) => call === calls[index])
      ) {
        out.push(known.entry);
        continue;
      }
      const entry: ThreadEntry = {
        kind: "tools",
        id: first.id,
        at: first.startedAt ?? "",
        calls,
      };
      cache.groups.set(first, { calls, entry });
      out.push(entry);
    }
    run = [];
  };
  for (const item of items) {
    if (
      item.kind === "tool" &&
      (item.detail.kind === "generic" || item.detail.kind === "subagent")
    ) {
      if (item.turn !== runTurn) flush();
      runTurn = item.turn;
      run.push(callViewOf(item, cache));
      continue;
    }
    let entry = cache.entries.get(item);
    if (entry === undefined) {
      entry = entryOf(item);
      cache.entries.set(item, entry);
    }
    if (entry === null) continue;
    flush();
    out.push(entry);
  }
  flush();
  return out;
}

export function layoutOf(
  state: AcpState,
  cache: LayoutCache = createLayoutCache(),
): ThreadView {
  const { turn, pending } = state;
  return {
    entries: layoutEntries(state.items, cache),
    turn:
      turn === null
        ? null
        : {
            id: turn.id,
            phase: turn.phase,
            startedAt: turn.started_at,
            elapsed:
              turn.elapsed === null
                ? null
                : { activeMs: turn.elapsed.active_ms, at: turn.elapsed.at },
          },
    queued: state.queued.map((queued) => ({
      id: queued.id,
      at: queued.at,
      text: blocksText(queued.content),
      summary: blocksSummary(queued.content),
    })),
    pending: {
      approval: pending.approval,
      questions:
        pending.question === null
          ? null
          : {
              group: pending.question.group,
              toolCall: pending.question.tool_call,
              questions:
                pending.question.questions?.map((question, index) => ({
                  id: `q${index + 1}`,
                  header: question.header,
                  question: question.question,
                  options: question.options.map((option) => ({
                    label: option.label,
                    description: option.description,
                  })),
                  multiSelect: question.multiSelect,
                })) ?? null,
            },
    },
    live: state.writing,
    session: state.session,
    plan: state.plan,
  };
}
