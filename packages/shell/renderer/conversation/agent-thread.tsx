// Agent 화면의 대화 줄. source가 준 시간순 줄을 그린다. 내 말은 오른쪽 bubble, 받은 메시지는 보낸 쪽 chip을 단
// 왼쪽 메시지, 그 밖(agent의 말, tool 줄, call 블록, 편집 카드, 질문 요약, 허락 결과, 끝 줄, 오류)은 사이에 내 말이 없는
// 동안 agent 한 덩어리로 묶는다. agent가 일하는 동안에는 끝에 일하는 중 줄이 서고, 쓰는 중인 글은 끝 agent 묶음의
// 마지막에 선다.
import type { ReactElement, ReactNode } from "react";
import { StatusMark } from "@lophn/ui/feedback";
import { t } from "@lophn/i18n";

import { EditCard } from "./activity/file-edit-card.tsx";
import type { ViewDetail } from "./activity/model.ts";
import { ToolLine } from "./activity/tool-line.tsx";
import { WorkedFor } from "./activity/worked-for.tsx";
import {
  clockTime,
  messageTime,
  shownEntries,
  taskOfCall,
  textOfBody,
} from "./agent-view-model.ts";
import type {
  AgentFace,
  AgentTabSource,
  EvidenceRef,
  ThreadEntry,
  ThreadMessage,
} from "./agent-tab-source.ts";
import type { LiveText } from "./live-text.ts";
import { ApprovalResult } from "./approval-card/approval-card.tsx";
import { deliveryAction, type Outgoing } from "./delivery-state.ts";
import type { DraftStore } from "./drafts.ts";
import {
  agentReplyIds,
  useThreadAnnouncement,
} from "./message-list/announce.ts";
import {
  AgentTurn,
  Said,
  UserMessage,
  WorkingRow,
} from "./message-list/agent-turn.tsx";
import { LiveMessage, useThrottledLive } from "./message-list/live-message.tsx";
import { MessageBody, UserBody } from "./message-list/message-body.tsx";
import { ThreadScroll } from "./message-list/thread-scroll.tsx";
import { QuestionSummary } from "./question-card/question-card.tsx";
import { HiddenRange } from "./session-rewind/hidden-range.tsx";
import { CallBlock } from "./thread/call-block.tsx";
import { ProviderError } from "./thread/provider-error.tsx";
import { ReceivedMessage } from "./thread/received-message.tsx";
import type { ArtifactsSlice } from "../workspace/kinds/host.ts";
import turns from "./message-list/turns.module.css";
import styles from "./agent-view.module.css";

interface AgentThreadProps {
  agent: Pick<AgentFace, "name" | "profile">;
  entries: readonly ThreadEntry[];
  detail: ViewDetail;
  /** 아직 저장되지 않은 model 호출 하나의 글. */
  live: LiveText | null;
  /** 아직 확정되지 않은 보낸 말. 같은 id의 확정 메시지가 오면 그것으로 바뀐다. */
  outgoing: Outgoing | null;
  /** agent가 일하는 중이다. `clock`은 core가 센 active와 그 기준 시각(ms)이고 모르면 null이다. */
  working: {
    readonly clock: { activeMs: number; at: number } | null;
    /** 사람의 답을 기다리는 중이면 그 종류다. 일하는 중 줄이 Working 대신 이것을 말한다. */
    readonly waiting?: "approval" | "answer";
  } | null;
  now: () => number;
  /** 내 말에 첨부한 이미지의 그림 주소. */
  imageUrl: (id: string) => Promise<string | null>;
  /** archive한 session이다. 내 말의 Rewind·Fork 단추가 없다. */
  readOnly: boolean;
  drafts: DraftStore;
  source: Pick<
    AgentTabSource,
    "envelope" | "callState" | "cancelCall" | "retryTurn" | "toolCallBody"
  >;
  initialScroll: number | null;
  onScroll: (position: number | null) => void;
  /** rewind panel이 열려 있는 시점 메시지. */
  rewindOpen: string | null;
  onRewind: (message: string) => void;
  onFork: (message: string) => void;
  onCheck: () => void;
  onResend: () => void;
  /** 끝난 turn의 입력을 새 메시지로 다시 보낸다. */
  onRetry: (turn: string) => void;
  /** 편집 카드의 [Open]. 없으면 단추가 아무것도 하지 않는다. */
  onOpenFile: ((path: string) => void) | undefined;
  /** 받은 메시지 panel의 근거 링크. */
  onOpenRef: ((ref: EvidenceRef) => void) | undefined;
  /** 받은 메시지 panel의 보낸 session 링크. */
  onOpenSession: ((session: string) => void) | undefined;
  /** 글 안 artifact path를 link로 그리는 길. */
  artifacts: ArtifactsSlice | undefined;
}

export function AgentThread(props: AgentThreadProps): ReactElement {
  const { entries, outgoing } = props;
  const live = useThrottledLive(props.live, props.now);
  const announcement = useThreadAnnouncement({
    agent: props.agent.name,
    live: live !== null,
    replies: agentReplyIds(entries),
  });
  const shown = shownEntries(entries, props.detail, (id) =>
    props.drafts.body(id),
  );
  const nodes = itemsOf(shown, props, entries, false, live);
  // 확정 메시지가 오면 같은 key의 줄로 바뀌어 다시 그려지지 않는다.
  if (outgoing !== null && !hasEntry(entries, outgoing.id)) {
    nodes.push(
      <UserMessage
        key={outgoing.id}
        id={outgoing.id}
        sending={outgoing.phase === "sending"}
      >
        <UserBody
          message={outgoing.id}
          body={props.drafts.body(outgoing.id)}
          fallback={props.drafts.textOf(outgoing.id)}
          artifacts={props.artifacts}
          imageUrl={props.imageUrl}
          onOpenFile={props.onOpenFile}
          action={deliveryAction(outgoing)}
          onCheck={props.onCheck}
          onResend={props.onResend}
        />
      </UserMessage>,
    );
  }
  if (props.working !== null) {
    nodes.push(
      <WorkingRow
        key="working"
        clock={props.working.clock}
        now={props.now}
        {...(props.working.waiting === undefined
          ? {}
          : { waiting: props.working.waiting })}
        streaming={live !== null && live.text !== ""}
      />,
    );
  }
  return (
    <ThreadScroll
      count={nodes.length}
      initialScroll={props.initialScroll}
      onScroll={props.onScroll}
      announcement={announcement}
    >
      {nodes.length === 0 ? (
        <p className={styles.empty} data-empty-thread="">
          {t("conversation.empty.no-messages")}
        </p>
      ) : (
        <div className={turns.turns}>{nodes}</div>
      )}
    </ThreadScroll>
  );
}

function hasEntry(entries: readonly ThreadEntry[], id: string): boolean {
  return entries.some(
    (entry) =>
      entry.id === id ||
      (entry.kind === "hidden" && hasEntry(entry.entries, id)),
  );
}

interface Group {
  readonly id: string;
  readonly at: string;
  readonly time: string;
  readonly items: ReactNode[];
  readonly said: ThreadMessage[];
}

/**
 * 그 turn-end가 들어가는 덩어리의 첫 entry id. 거꾸로 내 말이나 받은 메시지, 숨긴 구간을 만날 때까지 간다.
 * `itemsOf`가 덩어리를 끊는 자리와 같다.
 */
function groupStartOf(
  list: readonly ThreadEntry[],
  endId: string,
): string | null {
  const index = list.findLastIndex((entry) => entry.id === endId);
  if (index < 0) return null;
  let start = index;
  while (start > 0) {
    const previous = list[start - 1]!;
    if (
      previous.kind === "hidden" ||
      (previous.kind === "message" && previous.actor !== "agent")
    ) {
      break;
    }
    start -= 1;
  }
  return list[start]!.id;
}

/**
 * 줄을 화면 항목으로 바꾼다. agent 쪽 항목은 사이에 내 말이나 받은 메시지가 없는 동안 한 덩어리에 쌓이고,
 * 덩어리 위의 시각은 첫 항목의 것이다. `nested`는 숨긴 구간 안이라 읽기만 한다.
 */
function itemsOf(
  list: readonly ThreadEntry[],
  props: AgentThreadProps,
  all: readonly ThreadEntry[],
  nested: boolean,
  live: LiveText | null,
): ReactElement[] {
  const out: ReactElement[] = [];
  // 마지막으로 끝난 turn의 덩어리. 그 덩어리에만 [Retry]를 둔다. 숨긴 구간 안에서는 다시 하지 않는다.
  const lastEnded = nested
    ? null
    : ([...list].reverse().find((entry) => entry.kind === "turn-end") ?? null);
  const retryGroup =
    nested || lastEnded === null ? null : groupStartOf(list, lastEnded.id);
  // 묶음은 닫혀 있을 때 group이 null이다. closure가 열고 닫으므로 상자에 담아 읽는다(TS는 closure의 대입을
  // 흐름 분석에 넣지 않는다).
  const open: { group: Group | null } = { group: null };
  const flush = () => {
    const group = open.group;
    if (group === null) return;
    const said = group.said;
    const actions = !nested && !props.readOnly && said.length > 0;
    const retry =
      retryGroup === null || retryGroup !== group.id ? null : lastEnded!.turn;
    out.push(
      <AgentTurn
        key={`turn-${group.id}`}
        agent={props.agent}
        time={group.time}
        actionTime={
          nested ? undefined : messageTime(group.at, new Date(props.now()))
        }
        {...(actions
          ? {
              copyText: () => copyTextOf(said, props),
              onFork: () => props.onFork(said[said.length - 1]!.id),
            }
          : {})}
        {...(retry === null || props.readOnly
          ? {}
          : { onRetry: () => props.onRetry(retry) })}
      >
        {group.items}
      </AgentTurn>,
    );
    open.group = null;
  };
  const add = (
    entry: { readonly id: string; readonly at: string },
    node: ReactNode,
    said: ThreadMessage | null = null,
  ) => {
    open.group ??= {
      id: entry.id,
      at: entry.at,
      time: clockTime(entry.at),
      items: [],
      said: [],
    };
    open.group.items.push(node);
    if (said !== null) open.group.said.push(said);
  };

  for (const entry of list) {
    switch (entry.kind) {
      case "message":
        if (entry.actor === "agent") {
          add(
            entry,
            <Said key={entry.id} id={entry.id}>
              <MessageBody
                message={entry.id}
                body={props.drafts.body(entry.id)}
                fallback={entry.text ?? undefined}
                artifacts={props.artifacts}
                reasoning={props.detail !== "messages"}
              />
            </Said>,
            entry,
          );
        } else {
          flush();
          out.push(
            entry.actor === "user"
              ? userMessage(entry, props, nested)
              : receivedMessage(entry, props, all),
          );
        }
        break;
      case "tools":
        add(
          entry,
          <ToolLine
            key={entry.id}
            calls={entry.calls}
            detail={props.detail === "everything" ? "expanded" : "collapsed"}
            now={props.now}
            readBody={props.source.toolCallBody}
          />,
        );
        break;
      case "edit":
        // 숨긴 구간의 편집은 되돌아간 것이라 다시 그리지 않는다.
        if (!nested) {
          add(
            entry,
            <EditCard
              key={entry.id}
              path={entry.edit.path}
              added={entry.edit.added}
              removed={entry.edit.removed}
              call={entry.edit.id}
              readInput={props.source.toolCallBody}
              onOpen={() => props.onOpenFile?.(entry.edit.path)}
            />,
          );
        }
        break;
      case "call":
        add(
          entry,
          <CallBlock
            key={entry.id}
            call={entry.call}
            source={props.source}
            onOpenSession={props.onOpenSession}
          />,
        );
        break;
      case "questions":
        add(
          entry,
          <QuestionSummary
            key={entry.id}
            outcome={entry.outcome}
            lines={entry.lines}
          />,
        );
        break;
      case "approval-result":
        add(entry, <ApprovalResult key={entry.id} result={entry.result} />);
        break;
      case "turn-end": {
        const node =
          entry.outcome === "failed" ? (
            <div key={entry.id} data-turn-failed="">
              <StatusMark
                tone="serious"
                label={t("conversation.label.status-stopped")}
              />
            </div>
          ) : (
            <WorkedFor
              key={entry.id}
              activeMs={entry.activeMs}
              waitedMs={entry.waitedMs}
              stopped={entry.outcome === "stopped"}
            />
          );
        // agent가 아무 말도 하기 전에 끝난 turn은 이름 없이 끝 줄만 남는다.
        if (open.group === null) out.push(node);
        else add(entry, node);
        break;
      }
      case "provider-error":
        add(
          entry,
          <ProviderError
            key={entry.id}
            turn={entry.turn}
            code={entry.code}
            message={entry.message}
            source={props.source}
          />,
        );
        break;
      case "hidden":
        flush();
        out.push(
          <HiddenRange
            key={entry.id}
            choice={entry.choice}
            count={entry.count}
            restored={entry.restored}
            left={entry.left}
          >
            <div className={turns.turns}>
              {itemsOf(
                shownEntries(entry.entries, props.detail, (id) =>
                  props.drafts.body(id),
                ),
                props,
                all,
                true,
                null,
              )}
            </div>
          </HiddenRange>,
        );
        break;
    }
  }
  if (
    live !== null &&
    (live.text !== "" || (props.detail !== "messages" && live.reasoning !== ""))
  ) {
    const id = `live-${live.modelCall}`;
    add(
      { id, at: live.at },
      <LiveMessage
        key={id}
        live={live}
        reasoning={props.detail !== "messages"}
        artifacts={props.artifacts}
      />,
    );
  }
  flush();
  return out;
}

function userMessage(
  message: ThreadMessage,
  props: AgentThreadProps,
  nested: boolean,
): ReactElement {
  const actions = !nested && !props.readOnly;
  return (
    <UserMessage
      key={message.id}
      id={message.id}
      steer={message.delivery === "steer"}
      time={messageTime(message.at, new Date(props.now()))}
      rewindOpen={props.rewindOpen === message.id}
      {...(nested ? {} : { copyText: () => textOf(message, props) })}
      {...(actions
        ? {
            onRewind: () => props.onRewind(message.id),
            onFork: () => props.onFork(message.id),
          }
        : {})}
    >
      <UserBody
        message={message.id}
        body={props.drafts.body(message.id)}
        fallback={message.text ?? props.drafts.textOf(message.id)}
        artifacts={props.artifacts}
        imageUrl={props.imageUrl}
        onOpenFile={props.onOpenFile}
        action="none"
        onCheck={props.onCheck}
        onResend={props.onResend}
      />
    </UserMessage>
  );
}

/** 복사할 메시지 글. 본문을 읽었으면 그 글이고, 아니면 이 창이 아는 글이다. */
function textOf(message: ThreadMessage, props: AgentThreadProps): string {
  return (
    textOfBody(props.drafts.body(message.id)) ??
    message.text ??
    props.drafts.textOf(message.id) ??
    ""
  );
}

/** 묶음의 복사 글. 뒤에서부터 글이 있는 첫 message다(reasoning뿐인 message는 글을 내지 않는다). */
function copyTextOf(
  messages: readonly ThreadMessage[],
  props: AgentThreadProps,
): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const text = textOf(messages[index]!, props);
    if (text !== "") return text;
  }
  return "";
}

function receivedMessage(
  message: ThreadMessage,
  props: AgentThreadProps,
  all: readonly ThreadEntry[],
): ReactElement {
  const body = (
    <MessageBody
      message={message.id}
      body={props.drafts.body(message.id)}
      fallback={message.text ?? undefined}
      artifacts={props.artifacts}
    />
  );
  // 보낸 쪽을 모르는 받은 메시지는 없다. 있어도 본문은 잃지 않게 chip 없이 놓는다.
  if (message.sender === null) {
    return (
      <div key={message.id} data-message={message.id} data-actor="received">
        {body}
      </div>
    );
  }
  return (
    <ReceivedMessage
      key={message.id}
      message={message.id}
      sender={message.sender}
      time={clockTime(message.at)}
      replyTo={taskOfCall(all, message.replyTo)}
      source={props.source}
      onOpenRef={props.onOpenRef}
      onOpenSession={props.onOpenSession}
    >
      {body}
    </ReceivedMessage>
  );
}
