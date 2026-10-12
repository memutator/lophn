// Agent 화면의 대화 줄. source가 준 시간순 줄을 MessageTurns의 항목으로 바꾼다.
// 메시지는 본문으로, tool 줄·편집 카드·끝 줄·질문 카드는 agent 쪽 block으로 그린다.
import type { ReactElement } from "react";
import { StatusMark } from "@lophn/design/components";
import { t } from "@lophn/wording";

import type { VisualHost } from "../workspace/visuals/block-frame.tsx";
import { EditCard } from "./activity/edit-card.tsx";
import type { EditView, ViewDetail } from "./activity/model.ts";
import { ToolLine } from "./activity/tool-line.tsx";
import { WorkedFor } from "./activity/worked-for.tsx";
import {
  clockTime,
  confirmedDelivery,
  outgoingDelivery,
  shownEntries,
} from "./agent-view-model.ts";
import type {
  AgentFace,
  AgentViewSource,
  ThreadEntry,
  ThreadMessage,
} from "./agent-source.ts";
import { deliveryAction, type Outgoing } from "./delivery-state.ts";
import type { DraftStore } from "./drafts.ts";
import {
  MachineFact,
  MessageBody,
  UserBody,
} from "./message-list/message-body.tsx";
import { MessageTurns, type TurnItem } from "./message-list/turns.tsx";
import { ThreadScroll } from "./message-list/thread-scroll.tsx";
import { AnsweredSummary } from "./question-card/answered-summary.tsx";
import type { GroupAnswer } from "./question-card/model.ts";
import { QuestionCard } from "./question-card/question-card.tsx";
import { type ContextLinks, ResultLinks } from "./result-links.tsx";
import { HiddenRange } from "./rewind/hidden-range.tsx";
import styles from "./agent-view.module.css";

export interface AgentThreadProps {
  agent: Pick<AgentFace, "name" | "profile">;
  entries: readonly ThreadEntry[];
  detail: ViewDetail;
  /** 아직 확정되지 않은 보낸 말. 같은 id의 확정 메시지가 오면 그것으로 바뀐다. */
  outgoing: Outgoing | null;
  sessionClosed: boolean;
  /** 지금 시각(epoch ms). 질문 기한의 남은 시간을 센다. */
  now: number;
  /** 연결이 끊겨 질문 묶음을 보낼 수 없다. */
  offline: boolean;
  drafts: DraftStore;
  titles: Pick<AgentViewSource, "documentTitle">;
  visuals: VisualHost;
  contexts?: ContextLinks | undefined;
  initialScroll: number | null;
  onScroll: (position: number | null) => void;
  onOpenResult?:
    | ((document: string, version: string | null) => void)
    | undefined;
  onRewind: (message: string) => void;
  onFork: (message: string) => void;
  onCheck: () => void;
  onResend: () => void;
  onUndo: (edit: EditView) => void;
  /** 숨긴 구간의 [Redo]. */
  onRedo: (revert: string) => void;
  onAnswer: (group: string, answers: readonly GroupAnswer[]) => void;
  onSkip: (group: string) => void;
}

export function AgentThread(props: AgentThreadProps): ReactElement {
  const { entries, outgoing } = props;
  const shown = shownEntries(entries, props.detail);
  const items = shown.flatMap((entry) => itemsOf(entry, props));
  if (outgoing !== null && !entries.some((entry) => entry.id === outgoing.id)) {
    items.push(outgoingItem(outgoing, props));
  }
  return (
    <ThreadScroll
      count={items.length}
      initialScroll={props.initialScroll}
      onScroll={props.onScroll}
    >
      {items.length === 0
        ? (
          <p className={styles.empty} data-empty-thread="">
            {t("conversation.empty.no-messages")}
          </p>
        )
        : (
          <MessageTurns
            agent={props.agent}
            items={items}
            sessionClosed={props.sessionClosed}
            onRewind={props.onRewind}
            onFork={props.onFork}
          />
        )}
    </ThreadScroll>
  );
}

function userBody(
  message: string,
  props: AgentThreadProps,
  over: {
    correction: boolean;
    delivery: ReturnType<typeof confirmedDelivery>;
    provisional: boolean;
    outgoing: Outgoing | null;
  },
): ReactElement {
  return (
    <UserBody
      message={message}
      body={props.drafts.body(message)}
      fallback={props.drafts.textOf(message)}
      visuals={props.visuals}
      correction={over.correction}
      delivery={over.delivery}
      provisional={over.provisional}
      action={over.outgoing === null ? "none" : deliveryAction(over.outgoing)}
      onCheck={props.onCheck}
      onResend={props.onResend}
    />
  );
}

function outgoingItem(outgoing: Outgoing, props: AgentThreadProps): TurnItem {
  return {
    kind: "message",
    id: outgoing.id,
    actor: "user",
    time: "",
    body: userBody(outgoing.id, props, {
      correction: outgoing.mode === "correction",
      delivery: outgoingDelivery(outgoing),
      provisional: true,
      outgoing,
    }),
  };
}

function messageItem(
  message: ThreadMessage,
  props: AgentThreadProps,
): TurnItem {
  const time = clockTime(message.at);
  const body = (
    <MessageBody
      message={message.id}
      body={props.drafts.body(message.id)}
      visuals={props.visuals}
    />
  );
  if (message.actor === "user") {
    return {
      kind: "message",
      id: message.id,
      actor: "user",
      time,
      // 이 창이 보낸 말이 확정되면 그 말의 접수 표시는 확정 메시지의 것이다.
      body: userBody(message.id, props, {
        correction: message.mode === "correction",
        delivery: confirmedDelivery(message),
        provisional: false,
        outgoing: null,
      }),
    };
  }
  if (message.actor === "machine") {
    return {
      kind: "block",
      id: message.id,
      time,
      node: (
        <MachineFact
          id={message.id}
          body={props.drafts.body(message.id)}
          visuals={props.visuals}
        />
      ),
    };
  }
  return {
    kind: "message",
    id: message.id,
    actor: "agent",
    time,
    body: (
      <>
        {body}
        <ResultLinks
          links={message.results}
          source={props.titles}
          onOpen={props.onOpenResult}
          contexts={props.contexts}
        />
      </>
    ),
  };
}

function itemsOf(entry: ThreadEntry, props: AgentThreadProps): TurnItem[] {
  const time = clockTime(entry.at);
  switch (entry.kind) {
    case "message":
      return [messageItem(entry, props)];
    case "tools":
      return [{
        kind: "block",
        id: entry.id,
        time,
        node: (
          <ToolLine
            tool={entry.tool}
            detail={props.detail === "everything" ? "expanded" : "collapsed"}
          />
        ),
      }];
    case "edit":
      return [{
        kind: "block",
        id: entry.id,
        time,
        node: (
          <EditCard
            edit={entry.edit}
            undone={entry.undone}
            undo={entry.undo}
            onOpen={(edit) => props.onOpenResult?.(edit.document, null)}
            onUndo={props.onUndo}
          />
        ),
      }];
    case "hidden":
      return [{
        kind: "block",
        id: entry.id,
        time,
        node: (
          <HiddenRange
            revert={entry.revert}
            choice={entry.choice}
            count={entry.count}
            restored={entry.restored}
            left={entry.left}
            redo={entry.redo}
            onRedo={props.onRedo}
          >
            <MessageTurns
              agent={props.agent}
              // 숨긴 줄은 읽기만 한다: 다시 시점으로 고르거나 복사하지 않고 Undo도 없다.
              items={shownEntries(entry.entries, props.detail).flatMap((item) =>
                item.kind === "edit" ? [] : itemsOf(item, props)
              )}
              sessionClosed
              onRewind={() => {}}
              onFork={() => {}}
            />
          </HiddenRange>
        ),
      }];
    case "run-end":
      return [{
        kind: "block",
        id: entry.id,
        time,
        node: entry.outcome === "completed"
          ? <WorkedFor durationMs={entry.durationMs} />
          : (
            <div data-run-stopped="">
              <StatusMark
                tone="serious"
                label={t("conversation.label.status-stopped")}
              />
            </div>
          ),
      }];
    case "questions":
      return [{
        kind: "block",
        id: entry.id,
        time,
        node: entry.answered === null
          ? (
            <QuestionCard
              group={entry.group}
              now={props.now}
              disabled={props.offline}
              onSubmit={(answers) => props.onAnswer(entry.group.id, answers)}
              onSkip={() => props.onSkip(entry.group.id)}
            />
          )
          : (
            <AnsweredSummary
              group={entry.group}
              status={entry.answered.status}
              answers={entry.answered.answers}
            />
          ),
      }];
  }
}
