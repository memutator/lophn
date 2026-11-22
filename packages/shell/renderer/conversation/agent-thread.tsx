// Agent 화면의 대화 줄. ACP 순번 순서의 줄(thread-layout.ts)을 그린다. 내 말은 오른쪽 bubble, 받은 메시지는 보낸 쪽 chip을 단
// 왼쪽 메시지, 그 밖(agent의 말, tool 줄, call 블록, 편집 카드, 질문 요약, 허락 결과, 끝 줄, 오류)은 사이에 내 말이 없는
// 동안 agent 한 덩어리로 묶는다. agent가 일하는 동안에는 끝에 일하는 중 줄이 서고, 쓰는 중인 글은 끝 agent 묶음의
// 마지막에 선다.

import { t } from "@lophn/i18n";
import { StatusMark } from "@lophn/ui/feedback";
import {
  memo,
  type ReactElement,
  type ReactNode,
  type Ref,
  useMemo,
} from "react";
import type { AcpWriting } from "../../../protocol/acp/mod.ts";
import { runToastAction } from "../desktop/connection/toasts/toast-actions.ts";
import { EditCard } from "./activity/file-edit-card.tsx";
import type { ViewDetail } from "./activity/model.ts";
import { SubagentRow } from "./activity/subagent-row.tsx";
import { ToolLine } from "./activity/tool-line.tsx";
import { WorkedFor } from "./activity/worked-for.tsx";
import type {
  AgentFace,
  AgentTabSource,
  EvidenceRef,
  ThreadEntry,
  ThreadMessage,
} from "./agent-tab-source.ts";
import styles from "./agent-view.module.css";
import {
  clockTime,
  messageTime,
  shownEntries,
  taskOfCall,
  textOfParts,
} from "./agent-view-model.ts";
import { ApprovalResult } from "./approval-card/approval-card.tsx";
import {
  deliveryAction,
  type Outgoing,
  waitsInQueue,
} from "./delivery-state.ts";
import {
  AgentTurn,
  Said,
  UserMessage,
  WorkingRow,
} from "./message-list/agent-turn.tsx";
import {
  agentReplyIds,
  useThreadAnnouncement,
} from "./message-list/announce.ts";
import type { ArtifactsSlice } from "./message-list/artifact-text.tsx";
import { LiveMessage } from "./message-list/live-message.tsx";
import { MessageBody, UserBody } from "./message-list/message-body.tsx";
import {
  ThreadScroll,
  type ThreadScrollHandle,
} from "./message-list/thread-scroll.tsx";
import turns from "./message-list/turns.module.css";
import type { ThreadPosition } from "./message-list/virtual-rows.ts";
import { QuestionSummary } from "./question-card/question-card.tsx";
import { HiddenRange } from "./session-rewind/hidden-range.tsx";
import { CallBlock } from "./thread/call-block.tsx";
import { CommandOutput } from "./thread/command-output.tsx";
import { InfoRow } from "./thread/info-row.tsx";
import { ProviderError } from "./thread/provider-error.tsx";
import type { ProviderKeyFix } from "./thread/provider-key.ts";
import { ReceivedMessage } from "./thread/received-message.tsx";
import { ReleaseConsent } from "./thread/release-consent.tsx";
import { ShellRun } from "./thread/shell-run.tsx";
import { partsOfContent } from "./thread-layout.ts";

interface AgentThreadProps {
  agent: Pick<AgentFace, "name" | "avatar">;
  entries: readonly ThreadEntry[];
  detail: ViewDetail;
  /** 아직 저장되지 않은 model 호출 하나의 글. */
  live: AcpWriting | null;
  /** 아직 확정되지 않은 보낸 말. 같은 id의 확정 메시지가 오면 그것으로 바뀐다. */
  outgoing: Outgoing | null;
  /**
   * 보냈지만 아직 item이 오지 않은 사람 shell 명령. lophn의 `run_shell`은 끝나야 답하고 item도 그때 와서 그동안
   * 도는 줄을 대신 보인다.
   */
  pendingShell?: readonly { readonly id: string; readonly command: string }[];
  /** agent가 일하는 중이다. `clock`은 core가 센 active와 그 기준 시각(ms)이고 모르면 null이다. */
  working: {
    readonly clock: { activeMs: number; at: number } | null;
    /** 사람의 답을 기다리는 중이면 그 종류다. 일하는 중 줄이 Working 대신 이것을 말한다. */
    readonly waiting?: "approval" | "answer";
  } | null;
  now: () => number;
  /** 메시지 image block의 그림 주소. */
  imageUrl: (id: string) => Promise<string | null>;
  /** archive한 session이다. 내 말의 Rewind 단추와 agent 말의 Fork 단추가 없다. */
  readOnly: boolean;
  /** source가 가진 기능(`session.capabilities`). 없는 기능의 단추는 그리지 않는다. */
  can: {
    readonly rewind: boolean;
    readonly fork: boolean;
    readonly retry: boolean;
  };
  source: Pick<
    AgentTabSource,
    "envelope" | "callState" | "cancelCall" | "retryTurn" | "toolCallBody"
  >;
  initialScroll: ThreadPosition | null;
  onScroll: (position: ThreadPosition | null) => void;
  /** 화면 밖 행도 다 그린다. 대화 안 찾기가 열려 있는 동안이다. */
  renderAll?: boolean;
  /** rewind panel이 열려 있는 시점 메시지. */
  rewindOpen: string | null;
  onRewind: (message: string) => void;
  onFork: (message: string) => void;
  /** subagent 줄을 눌러 그 자식 대화를 연다. */
  onOpenChild: (child: string) => void;
  /** 도는 `!` 명령 하나를 멈춘다(`stop_shell`). source가 못 하면 없다. */
  onStopShell?: ((item: string) => void) | undefined;
  onCheck: () => void;
  onResend: () => void;
  /** 편집 카드의 [Open]. 없으면 단추가 아무것도 하지 않는다. */
  onOpenFile: ((path: string) => void) | undefined;
  /** 받은 메시지 panel의 근거 링크. */
  onOpenRef: ((ref: EvidenceRef) => void) | undefined;
  /** 받은 메시지 panel의 보낸 session 링크. */
  onOpenSession: ((session: string) => void) | undefined;
  /** 글 안 artifact path를 link로 그리는 길. */
  artifacts: ArtifactsSlice | undefined;
  /** provider 오류 줄의 [Enter key]. 읽기 전용 대화에는 없다. 부르는 쪽이 값을 안정되게 쥔다. */
  providerKey?: ProviderKeyFix | undefined;
  /** 화면이 key로 대화를 scroll하는 길. */
  scroll?: Ref<ThreadScrollHandle>;
}

// 글을 칠 때마다 대화 줄 전체를 다시 그리지 않도록 memo다. 부르는 쪽이 새로 만드는 작은 객체는 값으로 비교한다.
export const AgentThread = memo(AgentThreadView, sameProps);

function sameProps(a: AgentThreadProps, b: AgentThreadProps): boolean {
  for (const name of Object.keys(b) as (keyof AgentThreadProps)[]) {
    if (Object.is(a[name], b[name])) continue;
    const same =
      name === "working"
        ? sameWorking(a.working, b.working)
        : name === "can"
          ? a.can.rewind === b.can.rewind &&
            a.can.fork === b.can.fork &&
            a.can.retry === b.can.retry
          : name === "pendingShell"
            ? samePending(a.pendingShell, b.pendingShell)
            : false;
    if (!same) return false;
  }
  return true;
}

function sameWorking(
  a: AgentThreadProps["working"],
  b: AgentThreadProps["working"],
): boolean {
  if (a === null || b === null) return a === b;
  return (
    a.waiting === b.waiting &&
    a.clock?.activeMs === b.clock?.activeMs &&
    a.clock?.at === b.clock?.at
  );
}

function samePending(
  a: AgentThreadProps["pendingShell"],
  b: AgentThreadProps["pendingShell"],
): boolean {
  if (a === undefined || b === undefined) return a === b;
  return (
    a.length === b.length &&
    a.every((one, at) => one.id === b[at]!.id && one.command === b[at]!.command)
  );
}

function AgentThreadView(props: AgentThreadProps): ReactElement {
  const { entries, outgoing, live } = props;
  const replies = useMemo(() => agentReplyIds(entries), [entries]);
  const announcement = useThreadAnnouncement({
    agent: props.agent.name,
    live: live !== null,
    replies,
  });
  // 확정된 줄은 live 글이 자라는 동안 다시 만들지 않는다(같은 element는 React가 건너뛴다).
  const settled = useMemo(
    () => itemsOf(shownEntries(entries, props.detail), props, entries, false),
    // props의 함수와 객체는 부르는 쪽이 바꾸지 않는 한 같다. can은 값으로 센다.
    [
      entries,
      props.detail,
      props.agent,
      props.readOnly,
      props.can.rewind,
      props.can.fork,
      props.can.retry,
      props.now,
      props.artifacts,
      props.rewindOpen,
      props.imageUrl,
      props.source,
      props.onFork,
      props.onRewind,
      props.onOpenFile,
      props.onCheck,
      props.onResend,
      props.onOpenRef,
      props.onOpenSession,
      props.onOpenChild,
      props.onStopShell,
      props.providerKey,
    ],
  );
  const nodes = [...settled.nodes];
  let tail = settled.tail;
  if (
    live !== null &&
    (live.text !== "" || (props.detail !== "messages" && live.reasoning !== ""))
  ) {
    const id = `live-${live.model_call}`;
    const group: Group = tail ?? {
      id,
      key: settled.after,
      at: live.at,
      items: [],
      said: [],
    };
    tail = {
      ...group,
      items: [
        ...group.items,
        <LiveMessage
          key={id}
          live={live}
          reasoning={props.detail !== "messages"}
          artifacts={props.artifacts}
        />,
      ],
    };
  }
  if (tail !== null) nodes.push(turnOf(tail, props, false));
  if (
    outgoing !== null &&
    !waitsInQueue(outgoing) &&
    !hasEntry(entries, outgoing.id)
  ) {
    nodes.push(
      <UserMessage
        key={outgoing.id}
        id={outgoing.id}
        sending={outgoing.phase === "sending"}
      >
        <UserBody
          message={outgoing.id}
          parts={partsOfContent(outgoing.content)}
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
  for (const pending of props.pendingShell ?? []) {
    nodes.push(
      <ShellRun
        key={pending.id}
        id={pending.id}
        command={pending.command}
        state="running"
        output={null}
        readBody={props.source.toolCallBody}
      />,
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
        activity={activityOf(entries, live)}
      />,
    );
  }
  return (
    <ThreadScroll
      rows={nodes}
      empty={
        <p className={styles.empty} data-empty-thread="">
          {t("conversation.empty.no-messages")}
        </p>
      }
      initialPosition={props.initialScroll}
      onScroll={props.onScroll}
      renderAll={props.renderAll === true}
      announcement={announcement}
      sent={outgoing?.id ?? null}
      handle={props.scroll}
    />
  );
}

/** 일하는 중 줄에 붙일 지금 하는 일. 글이 흐르면 그 글이 진행 표시라 붙이지 않는다. */
function activityOf(
  entries: readonly ThreadEntry[],
  live: AcpWriting | null,
): string | undefined {
  if (live !== null) {
    return live.text === "" && live.reasoning !== ""
      ? t("conversation.label.status-thinking")
      : undefined;
  }
  const last = entries.at(-1);
  if (last?.kind !== "tools") return undefined;
  return last.calls.findLast((call) => call.state === "running")?.title;
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
  /**
   * React key. 묶음을 연 줄의 id는 쓰는 중인 글이 저장되거나 snapshot이 줄을 더하면 바뀌어 묶음 전체가 다시 mount된다
   * (깜빡임). 바로 앞 구분 줄(내 말, 받은 메시지, 숨긴 구간)의 id는 그때도 그대로다.
   */
  readonly key: string;
  readonly at: string;
  readonly items: ReactNode[];
  readonly said: ThreadMessage[];
}

/** 한 덩어리를 agent 말 묶음으로. */
function turnOf(
  group: Group,
  props: AgentThreadProps,
  nested: boolean,
): ReactElement {
  const said = group.said;
  const actions = !nested && !props.readOnly && said.length > 0;
  return (
    <AgentTurn
      key={`turn-${group.key}`}
      agent={props.agent}
      actionTime={
        nested ? undefined : messageTime(group.at, new Date(props.now()))
      }
      {...(actions
        ? {
            copyText: () => copyTextOf(said),
            ...(props.can.fork
              ? { onFork: () => props.onFork(said[said.length - 1]!.id) }
              : {}),
          }
        : {})}
    >
      {group.items}
    </AgentTurn>
  );
}

interface Items {
  readonly nodes: ReactElement[];
  /** 마지막에 열려 있는 agent 묶음. 쓰는 중인 글이 여기 붙으므로 닫지 않고 돌려준다. */
  readonly tail: Group | null;
  /** 마지막 구분 줄의 id(새 묶음의 key). */
  readonly after: string;
}

/**
 * 줄을 화면 항목으로 바꾼다. agent 쪽 항목은 사이에 내 말이나 받은 메시지가 없는 동안 한 덩어리에 쌓이고,
 * `nested`는 숨긴 구간 안이라 읽기만 한다.
 */
function itemsOf(
  list: readonly ThreadEntry[],
  props: AgentThreadProps,
  all: readonly ThreadEntry[],
  nested: boolean,
): Items {
  const out: ReactElement[] = [];
  // 묶음은 닫혀 있을 때 group이 null이다. closure가 열고 닫으므로 상자에 담아 읽는다(TS는 closure의 대입을
  // 흐름 분석에 넣지 않는다).
  const open: { group: Group | null } = { group: null };
  let after = "start";
  const flush = () => {
    const group = open.group;
    if (group === null) return;
    out.push(turnOf(group, props, nested));
    open.group = null;
  };
  const add = (
    entry: { readonly id: string; readonly at: string },
    node: ReactNode,
    said: ThreadMessage | null = null,
  ) => {
    open.group ??= {
      id: entry.id,
      key: after,
      at: entry.at,
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
                parts={entry.parts}
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
          after = entry.id;
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
      case "subagent":
        add(
          entry,
          <SubagentRow
            key={entry.id}
            entry={entry}
            now={props.now}
            onOpen={props.onOpenChild}
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
              state={entry.edit.toolState}
              call={entry.edit.id}
              readInput={props.source.toolCallBody}
              // 카드에 보이는 path는 cwd 상대라 열 때는 절대 경로인 document를 쓴다.
              onOpen={() => props.onOpenFile?.(entry.edit.document)}
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
            onOpenSession={
              props.onOpenSession === undefined
                ? undefined
                : (session, machine) =>
                    // 다른 컴퓨터가 받은 session은 그 컴퓨터의 session으로 연다.
                    machine === null
                      ? props.onOpenSession?.(session)
                      : runToastAction({ kind: "session", session, machine })
            }
          />,
        );
        break;
      case "release-consent":
        add(entry, <ReleaseConsent key={entry.id} release={entry.release} />);
        break;
      case "questions":
        add(
          entry,
          <QuestionSummary
            key={entry.id}
            outcome={entry.outcome}
            lines={entry.lines}
            reply={entry.reply}
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
            evidence={entry.evidence}
            source={props.source}
            canRetry={props.can.retry}
            providerKey={props.providerKey}
          />,
        );
        break;
      case "info":
      case "command-output": {
        const node =
          entry.kind === "info" ? (
            <InfoRow key={entry.id} text={entry.text} level={entry.level} />
          ) : (
            <CommandOutput
              key={entry.id}
              command={entry.command}
              text={entry.text}
              format={entry.format}
              at={entry.at}
              artifacts={props.artifacts}
            />
          );
        // turn 밖의 줄은 agent 덩어리에 넣지 않는다(이름과 "Worked for"가 붙지 않는다).
        if (entry.turn === null) {
          flush();
          out.push(node);
          after = entry.id;
        } else add(entry, node);
        break;
      }
      case "shell":
        // 사람이 돌린 명령은 agent 덩어리가 아니라 사람 쪽 줄이다.
        flush();
        out.push(
          <ShellRun
            key={entry.id}
            id={entry.id}
            command={entry.command}
            state={entry.state}
            output={entry.output}
            readBody={props.source.toolCallBody}
            onStop={props.onStopShell}
          />,
        );
        after = entry.id;
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
            <div className={turns.turns}>{nestedItems(entry, props, all)}</div>
          </HiddenRange>,
        );
        after = entry.id;
        break;
    }
  }
  return { nodes: out, tail: open.group, after };
}

function nestedItems(
  entry: Extract<ThreadEntry, { kind: "hidden" }>,
  props: AgentThreadProps,
  all: readonly ThreadEntry[],
): ReactElement[] {
  const { nodes, tail } = itemsOf(
    shownEntries(entry.entries, props.detail),
    props,
    all,
    true,
  );
  return tail === null ? nodes : [...nodes, turnOf(tail, props, true)];
}

function userMessage(
  message: ThreadMessage,
  props: AgentThreadProps,
  nested: boolean,
): ReactElement {
  const actions = !nested && !props.readOnly && props.can.rewind;
  return (
    <UserMessage
      key={message.id}
      id={message.id}
      steer={message.delivery === "steer"}
      {...(message.via === undefined ? {} : { via: message.via })}
      time={messageTime(message.at, new Date(props.now()))}
      rewindOpen={props.rewindOpen === message.id}
      {...(nested ? {} : { copyText: () => textOfParts(message.parts) })}
      {...(actions
        ? {
            onRewind: () => props.onRewind(message.id),
          }
        : {})}
    >
      <UserBody
        message={message.id}
        parts={message.parts}
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

/** 묶음의 복사 글. 뒤에서부터 글이 있는 첫 message다(reasoning뿐인 message는 글을 내지 않는다). */
function copyTextOf(messages: readonly ThreadMessage[]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const text = textOfParts(messages[index]!.parts);
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
      parts={message.parts}
      artifacts={props.artifacts}
      imageUrl={props.imageUrl}
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
