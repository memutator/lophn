// Agent 탭의 틀과 부품. 탭 안 맨 위의 view bar(agent header), 대화 줄(내 메시지는 오른쪽 bubble, agent 메시지는
// 왼쪽에 avatar·이름·시각), composer 위에 붙는 질문·승인 카드, composer(보내기 방식, `/` 명령 메뉴, 권한 요약),
// 접히는 tool 줄, 편집 카드, 대화 화면 안 panel(rewind, 권한). 실제 Button·IconButton·Menu·Popover·Card·Kbd를 쓰고,
// 입력칸(Field 없이 쓰는 textarea·검색 input), 상태 점, context chip은 같은 token으로 짠 look-alike다.
import { type ReactNode, useEffect, useRef, useState } from "react";
import {
  Button,
  Card,
  Icon,
  IconButton,
  iconPixels,
  Menu,
  Popover,
} from "@lophn/design/components";
import {
  conversationIcons,
  editorIcons,
  lophnSpaceIcons,
  workspaceIcons,
} from "../../../../packages/shell/renderer/icons/mod.ts";

import { Avatar } from "./agent-avatar.tsx";
import {
  ApprovalCard,
  type ApprovalDecision,
  QuestionCard,
  QuestionSummary,
} from "./agent-tab/cards.tsx";
import {
  ANSWERS,
  APPROVAL_MCP,
  ASKED,
  grantSummary,
  type QuestionAnswer,
} from "./agent-tab/data.ts";
import { PermissionsView } from "./agent-tab/permissions-view.tsx";
import { QueuedMessages } from "./agent-tab/queued.tsx";
import { RecapCard } from "./agent-tab/recap.tsx";
import t from "./agent-tab/agent-tab.module.css";
import {
  type ChatInit,
  DEMO_PICKER,
  SESSION_MODEL,
  type SessionRow,
} from "./agents-data.ts";
import { ViewBar } from "./documents.tsx";
import type { ModelSelection } from "./model-options.ts";
import { ModelPicker } from "./model-picker.tsx";
import { SessionSwitcher } from "./session-switcher.tsx";
import { SlashMenu, slashQuery } from "./slash-menu.tsx";
import styles from "./compose.module.css";
import a from "./agents.module.css";

export type Detail = "messages" | "compact" | "everything";
const DETAILS: readonly { id: Detail; label: string }[] = [
  { id: "messages", label: "Messages" },
  { id: "compact", label: "Compact" },
  { id: "everything", label: "Everything" },
];

const TASKS: readonly {
  text: string;
  state: "done" | "now" | "later";
}[] = [
  { text: "Read last week's findings", state: "done" },
  { text: "Search eval", state: "done" },
  { text: "Write report", state: "now" },
  { text: "Link findings", state: "later" },
];
const TASK_MARK = { done: "✓", now: "●", later: "○" } as const;

/** 진행 chip. 누르면 Tasks popover가 열린다. */
function ProgressChip() {
  const [open, setOpen] = useState(false);
  const done = TASKS.filter((task) => task.state === "done").length;
  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      placement="beside"
      trigger={
        <Button size="sm" variant="secondary" aria-label="Tasks">
          {`${done}/${TASKS.length}`}
        </Button>
      }
    >
      <div className={a.tasks}>
        <p className={a.popHead}>Tasks · {done} of {TASKS.length}</p>
        <ol className={a.taskList}>
          {TASKS.map((task) => (
            <li key={task.text} className={a[`task_${task.state}`]}>
              <span className={a.taskMark}>{TASK_MARK[task.state]}</span>
              {task.text}
            </li>
          ))}
        </ol>
      </div>
    </Popover>
  );
}

function Chevron({ down }: { down: boolean }) {
  return (
    <Icon
      icon={down ? lophnSpaceIcons.collapse : lophnSpaceIcons.expand}
      pixels={iconPixels("small")}
    />
  );
}

/** 처음 model. page가 picker를 연 채 시작하면 고정된 시연 값에서 시작한다. */
function startModel(chat: ChatInit): ModelSelection {
  if (chat.modelDemo === "picker") return DEMO_PICKER;
  return chat.model ?? SESSION_MODEL;
}

/**
 * composer. 입력칸 안 아래 줄에 [+] … [model · option ▾] [↑], 입력칸 밖 아래 줄에 [project] [권한 요약].
 * agent를 고르는 칸은 없다(session 안에서 agent를 바꾸지 않는다). "/"를 치면 명령 메뉴가 위로 뜬다.
 * 보내기에 고르는 방식은 없다. agent가 일하는 중에 보낸 메시지는 composer 위에 "다음 turn에 들어감" 줄로 쌓이고,
 * 그 줄의 [Send now]를 누르면 도는 turn에 steer로 들어간다. archive한 session은 입력칸 없이 안내만 보인다.
 */
function Composer(
  {
    agent,
    placeholder,
    running,
    chat,
    chip,
    onChip,
    readOnly,
    onCommand,
    onSend,
  }: {
    agent: string;
    placeholder: string;
    running: boolean;
    chat: ChatInit;
    chip?: string;
    onChip?: () => void;
    readOnly: boolean;
    onCommand: (name: string) => void;
    /** 일하는 중에 보낸 글. 다음 turn 줄에 쌓인다. */
    onSend: (text: string) => void;
  },
) {
  const [selection, setSelection] = useState(() => startModel(chat));
  const [permissions, setPermissions] = useState(false);
  const [text, setText] = useState(chat.slash ?? "");
  const send = () => {
    const body = text.trim();
    if (body === "" || slashQuery(text) !== null) return;
    if (running) onSend(body);
    setText("");
  };
  const query = slashQuery(text);
  if (readOnly) {
    return (
      <div className={a.composerWrap}>
        <p className={t.readOnlyNote}>
          <Icon
            icon={lophnSpaceIcons.archive}
            pixels={iconPixels("base")}
          />
          This session is archived. You can read it, but it takes no new
          messages.
        </p>
      </div>
    );
  }
  return (
    <div className={a.composerWrap}>
      <div className={a.cBoxWrap}>
        {query === null ? null : (
          <SlashMenu
            agent={agent}
            query={query}
            working={running}
            onPick={(command, group) => {
              if (group === "Skills") setText(`/${command.name} `);
              else {
                setText("");
                onCommand(command.name);
              }
            }}
          />
        )}
        <div className={a.cBox}>
          {chip === undefined ? null : (
            <div className={a.chipRow}>
              <span className={a.ctxChip}>
                <Icon
                  icon={workspaceIcons.document}
                  pixels={iconPixels("small")}
                  className={a.ctxChipIcon}
                />
                <span className={a.ctxChipText}>{chip}</span>
                <IconButton
                  icon={workspaceIcons.close}
                  label="Remove context"
                  size="sm"
                  onClick={onChip}
                />
              </span>
            </div>
          )}
          <textarea
            className={a.cInput}
            rows={2}
            aria-label="Message"
            placeholder={placeholder}
            value={text}
            onChange={(event) => setText(event.target.value)}
          />
          {running && query === null
            ? (
              <p className={t.sendHint}>
                {agent}{" "}
                is working. A message you send now waits for the next turn.
              </p>
            )
            : null}
          <div className={a.cRow}>
            <IconButton
              icon={lophnSpaceIcons.add}
              label="Add attachment"
              size="sm"
            />
            <span className={a.spacer} />
            <ModelPicker
              defaultOpen={chat.modelDemo !== undefined}
              selection={selection}
              onSelection={setSelection}
            />
            {running
              ? (
                <Button
                  size="sm"
                  variant="secondary"
                  icon={conversationIcons.stop}
                >
                  Stop
                </Button>
              )
              : null}
            <IconButton
              icon={conversationIcons.send}
              label="Send"
              variant="secondary"
              size="sm"
              onClick={send}
            />
          </div>
        </div>
      </div>
      <div className={a.scopeRow}>
        <span className={a.scope}>
          <Icon icon={workspaceIcons.folder} pixels={iconPixels("small")} />
          phroner
        </span>
        <Popover
          open={permissions}
          onOpenChange={setPermissions}
          placement="beside"
          trigger={
            <Button size="sm" variant="ghost">{`${grantSummary()} ▾`}</Button>
          }
        >
          <PermissionsView agent={agent} popover />
        </Popover>
      </div>
    </div>
  );
}

/**
 * Agent 탭의 틀: agent header가 있는 view bar, 대화, 질문·승인 카드, composer. `children`은 보기 상세에 따라 대화를 그린다.
 * `panel`은 대화 화면 안에 열리는 panel(rewind)이다. `/permissions`와 `/recap`은 이 틀이 직접 연다.
 */
export function ChatShell(
  {
    agent,
    session,
    chat = {},
    tasks = false,
    running = false,
    archived = false,
    placeholder,
    dock,
    chip,
    onChip,
    panel,
    queued = [],
    onSession,
    onNewSession,
    children,
  }: {
    agent: string;
    /** 지금 session. 새 session이면 id가 없다. */
    session: { id: string; title: string };
    chat?: ChatInit;
    tasks?: boolean;
    running?: boolean;
    /** archive한 session. 기록만 보이고 입력칸이 없다. */
    archived?: boolean;
    placeholder: string;
    dock?: ReactNode;
    chip?: string;
    onChip?: () => void;
    panel?: ReactNode;
    /** 일하는 중에 보내 다음 turn을 기다리는 메시지. */
    queued?: readonly string[];
    onSession?: (row: SessionRow) => void;
    onNewSession?: (agent: string) => void;
    children: (detail: Detail) => ReactNode;
  },
) {
  const [detail, setDetail] = useState<Detail>("compact");
  const [view, setView] = useState<ChatInit["view"]>(chat.view);
  const [waiting, setWaiting] = useState<readonly string[]>(queued);
  // [Send now]로 도는 turn에 넣은 메시지. 대화 끝에 steer 표시가 붙는다.
  const [steered, setSteered] = useState<readonly string[]>([]);
  // 대화가 길면 맨 아래(질문·승인 카드가 붙은 위치)가 먼저 보인다.
  const scroll = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (scroll.current) scroll.current.scrollTop = scroll.current.scrollHeight;
  }, [dock !== undefined, view, waiting.length, steered.length]);
  const shown = panel ??
    (view === "permissions"
      ? <PermissionsView agent={agent} onClose={() => setView(undefined)} />
      : null);
  return (
    <div className={styles.chat}>
      <div className={t.headerGap}>
        <ViewBar
          path={`${agent} · ${session.title}`}
          lead={
            <SessionSwitcher
              key={agent}
              agent={agent}
              currentId={session.id}
              title={session.title}
              demo={chat.switcher}
              onPick={(row) => onSession?.(row)}
              onNew={() => onNewSession?.(agent)}
            />
          }
        >
          {archived ? <span className={t.archivedTag}>Archived</span> : null}
          {tasks ? <ProgressChip /> : null}
          <Menu
            trigger={
              <Button size="sm" variant="ghost">
                {`${DETAILS.find((item) => item.id === detail)?.label} ▾`}
              </Button>
            }
            items={DETAILS.map((item) => ({
              id: item.id,
              label: item.id === detail ? `✓ ${item.label}` : item.label,
            }))}
            onSelect={(id) => setDetail(id as Detail)}
          />
          <Menu
            trigger={
              <IconButton icon={editorIcons.menu} label="More" size="sm" />
            }
            items={archived ? [{ id: "fork", label: "Fork" }] : [
              { id: "rename", label: "Rename" },
              { id: "archive", label: "Archive" },
            ]}
            onSelect={() => {}}
          />
        </ViewBar>
      </div>
      <div className={t.stage}>
        <div ref={scroll} className={a.scroll}>
          <div className={a.col}>
            {children(detail)}
            {steered.map((text) => (
              <UserMessage key={text} steer>{text}</UserMessage>
            ))}
            {view === "recap"
              ? <RecapCard onDismiss={() => setView(undefined)} />
              : null}
          </div>
        </div>
        {shown === null ? null : <div className={t.layer}>{shown}</div>}
      </div>
      <div className={a.dockZone}>
        {dock}
        <QueuedMessages
          items={waiting}
          onSendNow={(text) => {
            setWaiting((now) => now.filter((item) => item !== text));
            setSteered((now) => [...now, text]);
          }}
          onRemove={(text) =>
            setWaiting((now) => now.filter((item) => item !== text))}
        />
      </div>
      <Composer
        agent={agent}
        placeholder={placeholder}
        running={running}
        chat={chat}
        chip={chip}
        onChip={onChip}
        readOnly={archived}
        onSend={(text) => setWaiting((now) => [...now, text])}
        onCommand={(name) => {
          if (name === "Permissions") setView("permissions");
          if (name === "Recap") setView("recap");
        }}
      />
    </div>
  );
}

/**
 * agent의 말 한 덩어리. 왼쪽 열에 avatar(24px)·이름(굵게)·시각이 위에 한 번 있고, 이어지는 말과 tool 줄·카드는
 * 같은 덩어리 안에서 그 아래에 이름 없이 이어진다. 카드는 이 열의 폭을 다 쓴다.
 */
export function AgentTurn(
  { agent, time, children }: {
    agent: string;
    time: string;
    children: ReactNode;
  },
) {
  return (
    <div className={a.agentTurn}>
      <div className={a.agentHead}>
        <Avatar agent={agent} />
        <span className={a.agentName}>{agent}</span>
        <span className={a.agentTime}>{time}</span>
      </div>
      <div className={a.agentBody}>{children}</div>
    </div>
  );
}

/** agent의 글. */
export function Said({ children }: { children: ReactNode }) {
  return <div className={a.said}>{children}</div>;
}

/** 내 메시지가 아닌 한 줄 안내(결정을 남기는 말 같은). */
export function Quiet({ children }: { children: ReactNode }) {
  return <p className={a.quiet}>{children}</p>;
}

/**
 * 내 메시지. 오른쪽 bubble이고 이름·avatar는 없다. hover하면 Rewind 단추가 보이고, 누르면 대화 화면 안에 rewind panel이 열린다.
 * 도는 turn에 steer로 보낸 메시지는 rewind 시점이 아니라서 단추 대신 steer 표시가 붙는다.
 */
export function UserMessage(
  { children, steer = false, rewindOpen, onRewind }: {
    children: ReactNode;
    steer?: boolean;
    rewindOpen?: boolean;
    onRewind?: () => void;
  },
) {
  const rewindable = onRewind !== undefined && !steer;
  return (
    <div
      className={a.userTurn}
      data-open={rewindOpen ? "" : undefined}
    >
      <div className={a.userRow}>
        {rewindable
          ? (
            <span className={a.msgActions}>
              <IconButton
                icon={editorIcons.restore}
                label="Rewind to here"
                size="sm"
                aria-expanded={rewindOpen}
                onClick={onRewind}
              />
            </span>
          )
          : null}
        <div className={a.bubble}>{children}</div>
      </div>
      {steer
        ? (
          <span className={t.steerMark}>
            <Icon
              icon={conversationIcons.correction}
              pixels={iconPixels("small")}
            />
            Steer · went into the running turn
          </span>
        )
        : null}
    </div>
  );
}

/** 접히는 tool 줄. 펼치면 하위 줄이 보인다. */
export function ToolRow(
  { label, open, onToggle, children }: {
    label: string;
    open: boolean;
    onToggle: () => void;
    children: ReactNode;
  },
) {
  return (
    <div className={a.tool}>
      <button
        type="button"
        className={a.toolHead}
        aria-expanded={open}
        onClick={onToggle}
      >
        <span>{label}</span>
        <Chevron down={open} />
      </button>
      {open ? <ul className={a.toolSub}>{children}</ul> : null}
    </div>
  );
}

/** 바꾼 문서 카드. */
export function EditCard(
  { path, added, removed, onOpen }: {
    path: string;
    added: number;
    removed: number;
    onOpen: () => void;
  },
) {
  const [undone, setUndone] = useState(false);
  return (
    <Card>
      <div className={a.editCard}>
        <span className={a.editText}>
          {undone ? "Undid the edit to " : "Edited "}
          <span className={styles.mono}>{path}</span>
          {undone ? null : (
            <>
              {" "}
              <span className={styles.good}>+{added}</span>{" "}
              <span className={styles.regression}>−{removed}</span>
            </>
          )}
        </span>
        <span className={a.editActions}>
          <Button size="sm" onClick={onOpen}>Open</Button>
          <Button size="sm" variant="ghost" onClick={() => setUndone(!undone)}>
            {undone ? "Redo" : "Undo"}
          </Button>
        </span>
      </div>
    </Card>
  );
}

export function WorkedFor({ text }: { text: string }) {
  return <p className={a.worked}>{text}</p>;
}

/** Weekly report의 질문 카드. */
export function QuestionDock(
  { onSubmit }: { onSubmit: (answers: readonly QuestionAnswer[]) => void },
) {
  return (
    <QuestionCard
      agent="lophn"
      questions={ASKED}
      initial={{ place: [ASKED[0].options[0].label] }}
      onSubmit={onSubmit}
    />
  );
}

/** 질문에 답한 뒤 접혀 대화에 남는 요약. */
export function AnsweredSummary(
  { answers = ANSWERS }: { answers?: readonly QuestionAnswer[] },
) {
  return <QuestionSummary outcome="submitted" answers={answers} />;
}

/** Weekly report의 승인 카드. */
export function ApprovalDock(
  { onDecide }: { onDecide: (decision: ApprovalDecision) => void },
) {
  return (
    <ApprovalCard
      agent="lophn"
      kind="tool"
      content={APPROVAL_MCP}
      onDecide={onDecide}
    />
  );
}
