// Agent 화면의 대화 줄. source가 준 시간순 줄을 그린다. 내 말은 오른쪽 bubble, 받은 메시지는 보낸 쪽 chip을 단
// 왼쪽 메시지, 그 밖(agent의 말, tool 줄, call 블록, 편집 카드, 질문 요약, 허락 결과, 끝 줄, 오류)은 사이에 내 말이 없는
// 동안 agent 한 덩어리로 묶는다.
import type { ReactElement, ReactNode } from "react";
import { StatusMark } from "@lophn/design/components";
import { t } from "@lophn/wording";

import { EditCard } from "./activity/file-edit-card.tsx";
import type { ViewDetail } from "./activity/model.ts";
import { ToolLine } from "./activity/tool-line.tsx";
import { WorkedFor } from "./activity/worked-for.tsx";
import {
  clockTime,
  CONFIRMED,
  outgoingDelivery,
  shownEntries,
  taskOfCall,
} from "./agent-view-model.ts";
import type {
  AgentFace,
  AgentTabSource,
  EvidenceRef,
  ThreadEntry,
  ThreadMessage,
} from "./agent-tab-source.ts";
import { ApprovalResult } from "./approval-card/approval-card.tsx";
import { deliveryAction, type Outgoing } from "./delivery-state.ts";
import type { DraftStore } from "./drafts.ts";
import { AgentTurn, Said, UserMessage } from "./message-list/agent-turn.tsx";
import { MessageBody, UserBody } from "./message-list/message-body.tsx";
import { ThreadScroll } from "./message-list/thread-scroll.tsx";
import { QuestionSummary } from "./question-card/question-card.tsx";
import { HiddenRange } from "./session-rewind/hidden-range.tsx";
import { CallBlock } from "./thread/call-block.tsx";
import { ProviderError } from "./thread/provider-error.tsx";
import { ReceivedMessage } from "./thread/received-message.tsx";
import turns from "./message-list/turns.module.css";
import styles from "./agent-view.module.css";

export interface AgentThreadProps {
  agent: Pick<AgentFace, "name" | "profile">;
  entries: readonly ThreadEntry[];
  detail: ViewDetail;
  /** 아직 확정되지 않은 보낸 말. 같은 id의 확정 메시지가 오면 그것으로 바뀐다. */
  outgoing: Outgoing | null;
  /** archive한 session이다. 내 말의 Rewind·Fork 단추가 없다. */
  readOnly: boolean;
  drafts: DraftStore;
  source: Pick<
    AgentTabSource,
    "envelope" | "callState" | "cancelCall" | "retryTurn"
  >;
  initialScroll: number | null;
  onScroll: (position: number | null) => void;
  /** rewind panel이 열려 있는 시점 메시지. */
  rewindOpen: string | null;
  onRewind: (message: string) => void;
  onFork: (message: string) => void;
  onCheck: () => void;
  onResend: () => void;
  /** 편집 카드의 [Open]. 없으면 단추가 아무것도 하지 않는다. */
  onOpenFile: ((path: string) => void) | undefined;
  /** 받은 메시지 panel의 근거 링크. */
  onOpenRef: ((ref: EvidenceRef) => void) | undefined;
  /** 받은 메시지 panel의 보낸 session 링크. */
  onOpenSession: ((session: string) => void) | undefined;
}

export function AgentThread(props: AgentThreadProps): ReactElement {
  const { entries, outgoing } = props;
  const shown = shownEntries(entries, props.detail);
  const nodes = itemsOf(shown, props, entries, false);
  if (outgoing !== null && !hasEntry(entries, outgoing.id)) {
    nodes.push(
      <UserMessage key={`out-${outgoing.id}`} id={outgoing.id}>
        <UserBody
          message={outgoing.id}
          body={props.drafts.body(outgoing.id)}
          fallback={props.drafts.textOf(outgoing.id)}
          delivery={outgoingDelivery(outgoing)}
          provisional
          action={deliveryAction(outgoing)}
          onCheck={props.onCheck}
          onResend={props.onResend}
        />
      </UserMessage>,
    );
  }
  return (
    <ThreadScroll
      count={nodes.length}
      initialScroll={props.initialScroll}
      onScroll={props.onScroll}
    >
      {nodes.length === 0
        ? (
          <p className={styles.empty} data-empty-thread="">
            {t("conversation.empty.no-messages")}
          </p>
        )
        : <div className={turns.turns}>{nodes}</div>}
    </ThreadScroll>
  );
}

function hasEntry(entries: readonly ThreadEntry[], id: string): boolean {
  return entries.some((entry) =>
    entry.id === id ||
    (entry.kind === "hidden" && hasEntry(entry.entries, id))
  );
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
): ReactElement[] {
  const out: ReactElement[] = [];
  let group: { id: string; time: string; items: ReactNode[] } | null = null;
  const flush = () => {
    if (group === null) return;
    out.push(
      <AgentTurn key={`turn-${group.id}`} agent={props.agent} time={group.time}>
        {group.items}
      </AgentTurn>,
    );
    group = null;
  };
  const add = (entry: ThreadEntry, node: ReactNode) => {
    group ??= { id: entry.id, time: clockTime(entry.at), items: [] };
    group.items.push(node);
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
              />
            </Said>,
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
            tool={entry.tool}
            detail={props.detail === "everything" ? "expanded" : "collapsed"}
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
              onOpen={() => props.onOpenFile?.(entry.edit.path)}
            />,
          );
        }
        break;
      case "call":
        add(
          entry,
          <CallBlock key={entry.id} call={entry.call} source={props.source} />,
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
      case "turn-end":
        add(
          entry,
          entry.outcome === "completed"
            ? <WorkedFor key={entry.id} durationMs={entry.durationMs} />
            : (
              <div key={entry.id} data-turn-stopped="">
                <StatusMark
                  tone="serious"
                  label={t("conversation.label.status-stopped")}
                />
              </div>
            ),
        );
        break;
      case "provider-error":
        add(
          entry,
          <ProviderError
            key={entry.id}
            turn={entry.turn}
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
                shownEntries(entry.entries, props.detail),
                props,
                all,
                true,
              )}
            </div>
          </HiddenRange>,
        );
        break;
    }
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
      rewindOpen={props.rewindOpen === message.id}
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
        delivery={CONFIRMED}
        provisional={false}
        action="none"
        onCheck={props.onCheck}
        onResend={props.onResend}
      />
    </UserMessage>
  );
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
