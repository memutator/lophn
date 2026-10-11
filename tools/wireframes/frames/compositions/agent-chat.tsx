// 대화 탭의 틀과 부품. 탭 안 맨 위의 view bar, 대화 줄, composer 위에 붙는 질문·승인 dock, composer와
// model picker, 접히는 tool 줄, 편집 카드, Rewind menu. 실제 Button·IconButton·Menu·Popover·Card·Kbd를 쓰고,
// 입력칸(Field 없이 쓰는 textarea·검색 input)과 Rewind menu, 상태 점, context chip은 같은 token으로 짠 look-alike다.
import { type ReactNode, useEffect, useRef, useState } from "react";
import {
  Button,
  Card,
  conversationIcons,
  editorIcons,
  Icon,
  IconButton,
  iconPixels,
  Kbd,
  lophnSpaceIcons,
  Menu,
  paletteIcons,
  Popover,
  workspaceIcons,
} from "@lophn/design/components";

import menuStyles from "../../../../packages/design/components/menu/menu.module.css";
import {
  AGENT_ROWS,
  type ChatInit,
  type Effort,
  EFFORTS,
  PROVIDER_MODELS,
} from "./agents-data.ts";
import { ViewBar } from "./documents.tsx";
import styles from "./compose.module.css";
import a from "./agents.module.css";

export type Detail = "messages" | "compact" | "everything";
const DETAILS: readonly { id: Detail; label: string }[] = [
  { id: "messages", label: "Messages" },
  { id: "compact", label: "Compact" },
  { id: "everything", label: "Everything" },
];

export const TASKS: readonly {
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
function ProgressChip({ open: initial }: { open: boolean }) {
  const [open, setOpen] = useState(initial);
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

/** model picker. 검색칸, 연결된 provider별 model, effort, 이 대화에만 쓴다는 말, 기본값 바꾸기. */
function ModelPicker(
  { defaultOpen, model, effort, onModel, onEffort }: {
    defaultOpen: boolean;
    model: string;
    effort: Effort;
    onModel: (model: string) => void;
    onEffort: (effort: Effort) => void;
  },
) {
  const [open, setOpen] = useState(defaultOpen);
  const [query, setQuery] = useState("");
  const [stars, setStars] = useState<ReadonlySet<string>>(
    new Set(["Sonnet 5.5"]),
  );
  const needle = query.trim().toLowerCase();
  const groups = PROVIDER_MODELS.map((group) => ({
    ...group,
    models: group.models.filter((name) => name.toLowerCase().includes(needle)),
  })).filter((group) => group.models.length > 0);
  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      trigger={
        <Button size="sm" variant="ghost">{`${model} · ${effort} ▾`}</Button>
      }
    >
      <div className={a.modelMenu}>
        <label className={a.modelSearch}>
          <Icon icon={paletteIcons.search} pixels={iconPixels("base")} />
          <input
            className={a.bareInput}
            aria-label="Search models"
            placeholder="Search models"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <div className={a.modelList} role="listbox" aria-label="Models">
          {groups.length === 0
            ? <p className={a.noMatch}>No models match.</p>
            : groups.map((group) => (
              <div key={group.provider} role="presentation">
                <p className={a.modelGroup}>{group.provider}</p>
                {group.models.map((name) => (
                  <div
                    key={name}
                    role="option"
                    aria-selected={name === model}
                    className={`${menuStyles.item} ${a.modelRow}`}
                    data-highlighted={name === model ? "" : undefined}
                    onClick={() => onModel(name)}
                  >
                    <button
                      type="button"
                      className={a.star}
                      aria-label={stars.has(name)
                        ? `Remove ${name} from favorites`
                        : `Add ${name} to favorites`}
                      aria-pressed={stars.has(name)}
                      onClick={(event) => {
                        event.stopPropagation();
                        const next = new Set(stars);
                        if (!next.delete(name)) {
                          next.add(name);
                        }
                        setStars(next);
                      }}
                    >
                      {stars.has(name) ? "★" : "☆"}
                    </button>
                    <span className={a.modelName}>{name}</span>
                    {name === model
                      ? <span className={a.modelCheck}>✓</span>
                      : null}
                  </div>
                ))}
              </div>
            ))}
        </div>
        <div className={a.effortRow}>
          <span className={a.effortLabel}>Effort</span>
          <div className={a.effort} role="group" aria-label="Effort">
            {EFFORTS.map((item) => (
              <Button
                key={item}
                size="sm"
                variant={item === effort ? "secondary" : "ghost"}
                aria-pressed={item === effort}
                onClick={() => onEffort(item)}
              >
                {item}
              </Button>
            ))}
          </div>
        </div>
        <p className={a.modelNote}>
          Only this session. Default comes from the agent.
        </p>
        <div className={a.modelFoot}>
          <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
            Change defaults…
          </Button>
        </div>
      </div>
    </Popover>
  );
}

const PERMISSIONS = [
  { id: "ask", label: "Ask first" },
  { id: "edits", label: "Allow document edits" },
  { id: "all", label: "Allow everything in phroner" },
] as const;

/** composer. 입력칸 안 아래 줄에 [+] … [agent ▾] [model · effort ▾] [↑], 입력칸 밖 아래 줄에 [project] [Permissions ▾]. */
function Composer(
  { agent, placeholder, running, chat, chip, onChip }: {
    agent: string;
    placeholder: string;
    running: boolean;
    chat: ChatInit;
    chip?: string;
    onChip?: () => void;
  },
) {
  const [who, setWho] = useState(agent);
  const [model, setModel] = useState("Sonnet 5.5");
  const [effort, setEffort] = useState<Effort>("Medium");
  const [permission, setPermission] = useState<string>(PERMISSIONS[0].id);
  const permissionLabel = PERMISSIONS.find((item) => item.id === permission)
    ?.label;
  return (
    <div className={a.composerWrap}>
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
        />
        <div className={a.cRow}>
          <IconButton
            icon={lophnSpaceIcons.add}
            label="Add attachment"
            size="sm"
          />
          <span className={a.spacer} />
          <Menu
            trigger={<Button size="sm" variant="ghost">{`${who} ▾`}</Button>}
            items={AGENT_ROWS.filter((row) => row.id !== "operators").map((
              row,
            ) => ({ id: row.name, label: row.name }))}
            onSelect={setWho}
          />
          <ModelPicker
            defaultOpen={chat.model === true}
            model={model}
            effort={effort}
            onModel={setModel}
            onEffort={setEffort}
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
            : (
              <IconButton
                icon={conversationIcons.send}
                label="Send"
                variant="secondary"
                size="sm"
              />
            )}
        </div>
      </div>
      <div className={a.scopeRow}>
        <span className={a.scope}>
          <Icon icon={workspaceIcons.folder} pixels={iconPixels("small")} />
          phroner
        </span>
        <Menu
          trigger={
            <Button size="sm" variant="ghost">
              {`Permissions: ${permissionLabel} ▾`}
            </Button>
          }
          items={PERMISSIONS.map((item) => ({
            id: item.id,
            label: item.label,
          }))}
          onSelect={setPermission}
        />
      </div>
    </div>
  );
}

/** 대화 탭의 틀: view bar, 대화, dock, composer. `children`은 보기 상세에 따라 대화를 그린다. */
export function ChatShell(
  {
    title,
    agent,
    chat = {},
    tasks = false,
    running = false,
    placeholder,
    dock,
    chip,
    onChip,
    onRewind,
    children,
  }: {
    title: string;
    agent: string;
    chat?: ChatInit;
    tasks?: boolean;
    running?: boolean;
    placeholder: string;
    dock?: ReactNode;
    chip?: string;
    onChip?: () => void;
    onRewind?: () => void;
    children: (detail: Detail) => ReactNode;
  },
) {
  const [detail, setDetail] = useState<Detail>("compact");
  // 대화가 길면 맨 아래(질문·승인 카드가 붙은 자리)가 먼저 보인다.
  const scroll = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (scroll.current) scroll.current.scrollTop = scroll.current.scrollHeight;
  }, [dock !== undefined]);
  return (
    <div className={styles.chat}>
      <ViewBar path={title}>
        {tasks ? <ProgressChip open={chat.tasks === true} /> : null}
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
          items={[
            { id: "rename", label: "Rename" },
            { id: "rewind", label: "Rewind…" },
            { id: "close", label: "Close" },
          ]}
          onSelect={(id) => {
            if (id === "rewind") onRewind?.();
          }}
        />
      </ViewBar>
      <div ref={scroll} className={a.scroll}>
        <div className={a.col}>{children(detail)}</div>
      </div>
      <div className={a.dockZone}>{dock}</div>
      <Composer
        agent={agent}
        placeholder={placeholder}
        running={running}
        chat={chat}
        chip={chip}
        onChip={onChip}
      />
    </div>
  );
}

/** 말 한 덩어리. 누가 말했는지 이름이 위에 있다. */
export function Said(
  { who, children }: { who: string; children: ReactNode },
) {
  return (
    <div className={styles.turn}>
      <span className={styles.who}>{who}</span>
      <div className={styles.said}>{children}</div>
    </div>
  );
}

const REWIND_ITEMS = [
  "Restore messages and documents",
  "Restore messages only",
  "Summarize from here",
] as const;

/** 내 메시지. hover하면 Rewind 단추가 보이고, 누르면 Rewind menu가 열린다. */
export function UserMessage(
  { children, rewindOpen, onRewindOpen }: {
    children: ReactNode;
    rewindOpen: boolean;
    onRewindOpen: (open: boolean) => void;
  },
) {
  return (
    <div
      className={`${styles.turn} ${styles.mine} ${a.userMsg}`}
      data-open={rewindOpen ? "" : undefined}
    >
      <span className={styles.who}>You</span>
      <div className={a.userRow}>
        <div className={styles.said}>{children}</div>
        <span className={a.msgActions}>
          <IconButton
            icon={editorIcons.restore}
            label="Rewind to here"
            size="sm"
            aria-expanded={rewindOpen}
            onClick={() => onRewindOpen(!rewindOpen)}
          />
        </span>
      </div>
      {rewindOpen
        ? (
          <div className={a.rewind}>
            <div
              className={`${menuStyles.menu} ${a.rewindMenu}`}
              role="menu"
              aria-label="Rewind to here"
            >
              <div className={styles.menuHead}>Rewind to here</div>
              {REWIND_ITEMS.map((label, index) => (
                <div
                  key={label}
                  role="menuitem"
                  tabIndex={0}
                  className={menuStyles.item}
                  data-highlighted={index === 0 ? "" : undefined}
                  onClick={() => onRewindOpen(false)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") onRewindOpen(false);
                  }}
                >
                  {label}
                </div>
              ))}
              <p className={a.rewindNote}>
                Changes made outside this session are not restored.
              </p>
            </div>
          </div>
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

interface Question {
  readonly id: string;
  readonly title: string;
  readonly short: string;
  readonly options: readonly {
    readonly name: string;
    readonly detail?: string;
    readonly recommended?: boolean;
  }[];
}

const QUESTIONS: readonly Question[] = [
  {
    id: "place",
    title: "Where should the weekly report go?",
    short: "Report place",
    options: [
      {
        name: "docs/reports/",
        detail: "next to last week's reports",
        recommended: true,
      },
      { name: "eval/reports/", detail: "inside the eval folder" },
      { name: "Ask me each week", detail: "no fixed place" },
    ],
  },
  {
    id: "regressions",
    title: "Include regressions in the report?",
    short: "Include regressions",
    options: [
      {
        name: "Yes",
        detail: "list each regression with its scenario",
        recommended: true,
      },
      { name: "No", detail: "only improvements" },
    ],
  },
];

const OTHER = "other";

/**
 * 질문 카드. composer 바로 위에 붙고 질문이 둘이면 한 카드에 다 펼친다(셋을 넘으면 1 of N으로 넘긴다).
 * 답하는 동안 일은 멈춘다. [Submit]은 한 번에 보낸다.
 */
export function QuestionDock(
  { onSubmit, onSkip }: {
    onSubmit: (summary: string) => void;
    onSkip: () => void;
  },
) {
  const [picks, setPicks] = useState<Record<string, string>>({
    place: "docs/reports/",
  });
  const [typed, setTyped] = useState<Record<string, string>>({});
  const [folded, setFolded] = useState(false);
  const answered = (question: Question) =>
    picks[question.id] !== undefined &&
    (picks[question.id] !== OTHER || (typed[question.id] ?? "").trim() !== "");
  const count = QUESTIONS.filter(answered).length;
  const ready = count === QUESTIONS.length;
  const answerOf = (question: Question) =>
    picks[question.id] === OTHER ? typed[question.id] : picks[question.id];
  return (
    <section className={a.dock} aria-label="Questions from lophn">
      <header className={a.dockHead}>
        <span className={a.dockTitle}>
          lophn is asking {QUESTIONS.length} questions
        </span>
        <span className={a.dockCount}>
          {count} of {QUESTIONS.length} answered
        </span>
        <IconButton
          icon={folded ? lophnSpaceIcons.expand : lophnSpaceIcons.collapse}
          label={folded ? "Expand questions" : "Collapse questions"}
          size="sm"
          aria-expanded={!folded}
          onClick={() => setFolded(!folded)}
        />
      </header>
      {folded ? null : (
        <div className={a.dockBody}>
          {QUESTIONS.map((question) => (
            <div
              key={question.id}
              className={a.question}
              role="radiogroup"
              aria-label={question.title}
            >
              <p className={a.qTitle}>{question.title}</p>
              {question.options.map((option, index) => {
                const on = picks[question.id] === option.name;
                return (
                  <button
                    key={option.name}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    className={a.option}
                    onClick={() =>
                      setPicks({ ...picks, [question.id]: option.name })}
                  >
                    <span className={a.optionText}>
                      <span className={a.optionName}>
                        {option.name}
                        {option.recommended
                          ? <span className={a.recommended}>(Recommended)</span>
                          : null}
                      </span>
                      {option.detail === undefined
                        ? null
                        : (
                          <span className={a.optionDetail}>
                            {option.detail}
                          </span>
                        )}
                    </span>
                    <Kbd keys={[String(index + 1)]} />
                  </button>
                );
              })}
              <div
                className={a.option}
                role="radio"
                aria-checked={picks[question.id] === OTHER}
                tabIndex={0}
                onClick={() => setPicks({ ...picks, [question.id]: OTHER })}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    setPicks({ ...picks, [question.id]: OTHER });
                  }
                }}
              >
                <span className={a.otherRow}>
                  <span className={a.optionName}>Other</span>
                  <input
                    className={a.otherInput}
                    aria-label={`Type your own answer: ${question.title}`}
                    placeholder="Type your own answer"
                    value={typed[question.id] ?? ""}
                    onFocus={() => setPicks({ ...picks, [question.id]: OTHER })}
                    onChange={(event) =>
                      setTyped({ ...typed, [question.id]: event.target.value })}
                  />
                </span>
                <Kbd keys={[String(question.options.length + 1)]} />
              </div>
            </div>
          ))}
        </div>
      )}
      <footer className={a.dockFoot}>
        <span className={a.paused}>Work is paused until you answer</span>
        <Button size="sm" onClick={onSkip}>Skip</Button>
        <Button
          size="sm"
          variant="primary"
          disabled={!ready}
          onClick={() =>
            onSubmit(
              `Answered ${QUESTIONS.length} questions: ${
                QUESTIONS.map((question) =>
                  `${question.short} → ${answerOf(question)}`
                ).join(" · ")
              }`,
            )}
        >
          Submit
        </Button>
      </footer>
    </section>
  );
}

/** 질문에 답한 뒤 접혀 대화에 남는 요약. */
export function AnsweredSummary({ text }: { text: string }) {
  return (
    <p className={a.answered}>
      <span className={styles.good}>✓</span> {text}
    </p>
  );
}

const ALLOW_ITEMS = [
  "Allow once",
  "Allow for this session",
  "Always allow in phroner",
] as const;

/**
 * 승인 카드. OpenCode처럼 composer 바로 위에 붙는 dock이라 대화 끝에서 늘 보인다. [Allow ▾]는 범위를 펼쳐
 * 고르고, [Deny]는 거절이다(일을 멈추는 것은 composer의 Stop).
 */
export function ApprovalDock(
  { menuOpen, onDecide }: {
    menuOpen: boolean;
    onDecide: (decision: string) => void;
  },
) {
  const [open, setOpen] = useState(menuOpen);
  return (
    <section className={a.dock} aria-label="Approval">
      <div className={a.approval}>
        <p className={a.approvalTitle}>
          <Icon icon={editorIcons.problem} pixels={iconPixels("base")} />
          Rewrite docs/reports/2026-w40.md?
        </p>
        <p className={a.approvalText}>
          lophn wants to replace last week's report with the corrected numbers.
        </p>
        <pre className={a.diff} aria-label="Preview">
          <span className={a.diffDel}>
            {"− Scenarios passed: 41 of 44\n"}
          </span>
          <span className={a.diffAdd}>
            {"+ Scenarios passed: 40 of 44\n"}
          </span>
          <span className={a.diffAdd}>
            {"+ Regressions: query-recipe-gap, sched-edit, wake-plant"}
          </span>
        </pre>
      </div>
      <footer className={a.approvalFoot}>
        <span className={a.split}>
          <Button
            size="sm"
            variant="primary"
            onClick={() => onDecide(ALLOW_ITEMS[0])}
          >
            Allow
          </Button>
          <Menu
            open={open}
            onOpenChange={setOpen}
            trigger={
              <IconButton
                icon={lophnSpaceIcons.collapse}
                label="Allow scope"
                variant="secondary"
                size="sm"
              />
            }
            items={ALLOW_ITEMS.map((label) => ({ id: label, label }))}
            onSelect={onDecide}
          />
        </span>
        <span className={a.deny}>
          <Button size="sm" onClick={() => onDecide("Denied")}>Deny</Button>
          <span className={a.escHint}>Esc</span>
        </span>
      </footer>
    </section>
  );
}
