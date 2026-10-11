// Agent 탭 본문. 탭의 `sub`가 어느 대화인지 정한다: Weekly report(질문·승인·되돌리기가 동작하는 이야기), 새 대화
// (sidebar의 agent나 toast의 [Ask lophn]이 연다), 최근 대화, 그리고 lophn·Context Engineer의 이전 대화.
// 말 속의 context 이름과 객체 id는 링크라서 누르면 탭이 열린다.
import { type ReactNode, useState } from "react";
import { Button } from "@lophn/ui-control";

import {
  AnsweredSummary,
  ApprovalDock,
  ChatShell,
  EditCard,
  QuestionDock,
  Said,
  ToolRow,
  UserMessage,
  WorkedFor,
} from "./agent-chat.tsx";
import { type ChatInit, CONVERSATIONS } from "./agents-data.ts";
import { Link } from "./link.tsx";
import {
  contextTab,
  documentTab,
  experimentTab,
  findingTab,
} from "./phroner-data.ts";
import type { TabSpec } from "./project-window.tsx";
import styles from "./compose.module.css";

type Open = (tab: TabSpec) => void;

interface Turn {
  readonly who: string;
  readonly mine?: boolean;
  readonly text: ReactNode;
}

/** Context Engineer가 묻는 질문. 답 단추를 누르면 답이 대화에 남고 작업이 이어진다. */
export const CE_QUESTION =
  "Some release notes list issues by number, others by title. Should I match titles to issues too?";
export const CE_ANSWERS: readonly string[] = [
  "Yes, match titles",
  "Numbers only",
];

const ASK_LOPHN = "Ask lophn… @ for documents and contexts, / for skills";

function lophnTurns(open: Open): readonly Turn[] {
  const finding = (id: string) => (
    <Link onClick={() => open(findingTab(id))}>{id}</Link>
  );
  return [
    { who: "You", mine: true, text: "Which findings are about C-049?" },
    {
      who: "lophn",
      text: (
        <>
          Three: {finding("F-009")}, {finding("F-010")} and{" "}
          {finding("F-011")}. F-009 and F-010 are improvements, F-011 is a
          regression on query-recipe-gap.
        </>
      ),
    },
    {
      who: "You",
      mine: true,
      text: "Open the regression and compare it with exp-008.",
    },
    {
      who: "lophn",
      text: (
        <>
          Opened {finding("F-011")} next to{" "}
          <Link onClick={() => open(experimentTab("exp-008"))}>exp-008</Link>.
          The regression shows up only on scenarios that need a recipe lookup.
        </>
      ),
    },
    { who: "You", mine: true, text: "Which context are these findings in?" },
    {
      who: "lophn",
      text: (
        <>
          They are in the{" "}
          <Link onClick={() => open(contextTab("eval"))}>eval</Link>{" "}
          context. Two of its documents don't match what it expects yet; see its
          {" "}
          <Link onClick={() => open(contextTab("eval", "violations"))}>
            Violations
          </Link>.
        </>
      ),
    },
  ];
}

const NEW_CONTEXT_TURNS: readonly Turn[] = [
  {
    who: "Context Engineer",
    text:
      "What should the new context help with? Tell me which folders or files to look at, and what you want to find.",
  },
];

function engineerTurns(
  open: Open,
  answer: string | null,
  onAnswer: (answer: string) => void,
): readonly Turn[] {
  const turns: Turn[] = [
    {
      who: "Context Engineer",
      text: (
        <>
          I read the 3 places you picked for{" "}
          <Link onClick={() => open(contextTab("release-notes"))}>
            release-notes
          </Link>: 24 documents. Releases are numbered, issues have a page each,
          and CHANGELOG.md lists entries per version.
        </>
      ),
    },
    {
      who: "Context Engineer",
      text: (
        <>
          <span>{CE_QUESTION}</span>
          {answer === null
            ? (
              <span className={styles.choices}>
                {CE_ANSWERS.map((label, index) => (
                  <Button
                    key={label}
                    variant={index === 0 ? "primary" : "secondary"}
                    onClick={() => onAnswer(label)}
                  >
                    {label}
                  </Button>
                ))}
                <span className={styles.waiting}>Waiting for your answer</span>
              </span>
            )
            : null}
        </>
      ),
    },
  ];
  if (answer !== null) {
    turns.push(
      { who: "You", mine: true, text: answer },
      {
        who: "Context Engineer",
        text: answer === CE_ANSWERS[0]
          ? "Got it. I'll match titles to issues too and go on with the searches."
          : "Got it. Only issue numbers count. I'll go on with the searches.",
      },
    );
  }
  return turns;
}

// 최근 대화 중 Weekly report 말고는 짧은 이야기 하나씩이다.
const PAST: Record<string, readonly Turn[]> = {
  failing: [
    { who: "You", mine: true, text: "Why did 3 scenarios fail last night?" },
    {
      who: "Context Engineer",
      text:
        "I'm reading the three runs: query-recipe-gap, sched-edit and wake-plant. The first two fail on the same recipe lookup.",
    },
  ],
  nightly: [
    {
      who: "Nightly scenario check",
      text:
        "Ran 44 scenarios at 02:00. 3 failed: query-recipe-gap, sched-edit, wake-plant. I left the run notes in eval/runs/2026-10-10.md.",
    },
  ],
  "release-notes": [
    { who: "You", mine: true, text: "Is the release-notes context ready?" },
    {
      who: "Context Engineer",
      text:
        "Yes. It is applied as version r1 and its tests passed. Searches for releases, issues and changelog entries are ready to use.",
    },
  ],
};

function Turns({ turns }: { turns: readonly Turn[] }) {
  return (
    <>
      {turns.map((turn, index) =>
        turn.mine
          ? (
            <div key={index} className={`${styles.turn} ${styles.mine}`}>
              <span className={styles.who}>{turn.who}</span>
              <div className={styles.said}>{turn.text}</div>
            </div>
          )
          : <Said key={index} who={turn.who}>{turn.text}</Said>
      )}
    </>
  );
}

/** lophn과 Context Engineer의 이전 대화와 최근 대화. */
function PlainChat(
  { agent, title, turns, running = false, placeholder }: {
    agent: string;
    title: string;
    turns: readonly Turn[];
    running?: boolean;
    placeholder?: string;
  },
) {
  return (
    <ChatShell
      title={`${agent} · ${title}`}
      agent={agent}
      running={running}
      placeholder={placeholder ??
        `Ask ${agent}… @ for documents and contexts, / for skills`}
    >
      {() => <Turns turns={turns} />}
    </ChatShell>
  );
}

/** 새 대화. sidebar의 agent나 toast의 [Ask lophn]이 연다. 첫 context가 붙어 있으면 chip으로 보인다. */
function FreshChat({ chat }: { chat: ChatInit }) {
  const agent = chat.agent ?? "lophn";
  const [chip, setChip] = useState(chat.chip);
  return (
    <ChatShell
      title={`${agent} · New session`}
      agent={agent}
      chat={chat}
      chip={chip}
      onChip={() => setChip(undefined)}
      placeholder={chip === undefined
        ? `Ask ${agent}… @ for documents and contexts, / for skills`
        : `What should ${agent} do about this?`}
    >
      {() => (
        <p className={styles.muted}>
          {chip === undefined
            ? `New session with ${agent}.`
            : `${agent} will see the context below with your first message.`}
        </p>
      )}
    </ChatShell>
  );
}

/**
 * Weekly report 대화. 이야기는 하나이고 진행(stage)만 다르다: 질문 카드 → 답한 뒤 → 일이 끝남, 그리고 승인 카드.
 * 질문은 [Submit]·[Skip]으로, 승인은 [Allow ▾]·[Deny]로 이어진다.
 */
function WeeklyChat({ open, chat }: { open: Open; chat: ChatInit }) {
  const [stage, setStage] = useState(chat.stage ?? "question");
  const [summary, setSummary] = useState(
    "Answered 2 questions: Report place → docs/reports/ · Include regressions → Yes",
  );
  const [decision, setDecision] = useState<string | null>(null);
  const [rewind, setRewind] = useState(chat.rewind === true);
  const [opened, setOpened] = useState<Record<string, boolean>>({
    search: true,
  });
  const finding = (id: string) => (
    <Link onClick={() => open(findingTab(id))}>{id}</Link>
  );
  const waiting = stage === "question" ||
    (stage === "approval" && decision === null);
  const dock = stage === "question"
    ? (
      <QuestionDock
        onSubmit={(text) => {
          setSummary(text);
          setStage("answered");
        }}
        onSkip={() => {
          setSummary("Skipped 2 questions. lophn will use its defaults.");
          setStage("answered");
        }}
      />
    )
    : stage === "approval" && decision === null
    ? (
      <ApprovalDock
        menuOpen={chat.allowMenu === true}
        onDecide={setDecision}
      />
    )
    : undefined;
  const toggle = (key: string) => setOpened({ ...opened, [key]: !opened[key] });
  return (
    <ChatShell
      title="lophn · Weekly report"
      agent="lophn"
      chat={chat}
      tasks
      running={waiting && stage === "approval"}
      placeholder={stage === "question"
        ? "Add more details (optional)"
        : ASK_LOPHN}
      dock={dock}
      onRewind={() => setRewind(true)}
    >
      {(detail) => {
        const show = detail !== "messages";
        const isOpen = (key: string) => detail === "everything" || opened[key];
        return (
          <>
            <UserMessage rewindOpen={rewind} onRewindOpen={setRewind}>
              Write this week's eval report from the new findings.
            </UserMessage>
            {show
              ? (
                <>
                  <ToolRow
                    label="Read 3 documents"
                    open={isOpen("read")}
                    onToggle={() => toggle("read")}
                  >
                    <li>loop/findings/F-009.md</li>
                    <li>loop/findings/F-011.md</li>
                    <li>docs/reports/2026-w40.md</li>
                  </ToolRow>
                  <ToolRow
                    label="Searched eval · Findings about a change"
                    open={isOpen("search")}
                    onToggle={() => toggle("search")}
                  >
                    <li>
                      Findings about a change · kind: regression, metric: any
                    </li>
                    <li>3 findings found</li>
                  </ToolRow>
                </>
              )
              : null}
            {stage === "report" || stage === "approval"
              ? (
                <>
                  <Said who="lophn">
                    Three new findings since last week: {finding("F-009")} and
                    {" "}
                    {finding("F-010")} are improvements, {finding("F-011")}{" "}
                    is a regression on query-recipe-gap. I wrote the report and
                    linked each finding to it.
                  </Said>
                  <EditCard
                    path="docs/reports/2026-w41.md"
                    added={24}
                    removed={3}
                    onOpen={() => open(documentTab("docs/reports/2026-w41.md"))}
                  />
                  {show ? <WorkedFor text="Worked for 18s" /> : null}
                </>
              )
              : (
                <Said who="lophn">
                  There are 3 new findings since last week. Before I write the
                  report I need two answers.
                </Said>
              )}
            {stage === "answered"
              ? (
                <>
                  <AnsweredSummary text={summary} />
                  <Said who="lophn">
                    Thanks. Writing the report into docs/reports/ with a section
                    for the regressions.
                  </Said>
                  <EditCard
                    path="docs/reports/2026-w41.md"
                    added={24}
                    removed={3}
                    onOpen={() => open(documentTab("docs/reports/2026-w41.md"))}
                  />
                  {show ? <WorkedFor text="Worked for 18s" /> : null}
                </>
              )
              : null}
            {stage === "approval"
              ? (
                <Said who="lophn">
                  Last week's report counts the regressions wrong. I can fix it
                  with the corrected numbers, but I need your OK to change a
                  document I did not just write.
                </Said>
              )
              : null}
            {decision === null ? null : (
              <p className={styles.muted}>
                {decision === "Denied"
                  ? "Denied. docs/reports/2026-w40.md was left as it is."
                  : `${decision}. Rewrote docs/reports/2026-w40.md.`}
              </p>
            )}
          </>
        );
      }}
    </ChatShell>
  );
}

/** Agent 탭. */
export function Conversation(
  { tab, open, answer = null, onAnswer = () => {} }: {
    tab: TabSpec;
    open: Open;
    answer?: string | null;
    onAnswer?: (answer: string) => void;
  },
) {
  const sub = tab.sub ?? "";
  const chat = tab.chat ?? {};
  if (sub === "weekly") return <WeeklyChat open={open} chat={chat} />;
  if (sub === "new") return <FreshChat chat={chat} />;
  if (sub.startsWith("conv:")) {
    const id = sub.slice("conv:".length);
    const row = CONVERSATIONS.find((item) => item.id === id);
    if (id === "c049") {
      return (
        <PlainChat
          agent="lophn"
          title="Findings about C-049"
          turns={lophnTurns(open)}
        />
      );
    }
    const agent = row?.agent === "Operator" ? row.title : row?.agent ?? "lophn";
    return (
      <PlainChat
        agent={agent}
        title={row?.title ?? "Session"}
        turns={PAST[id] ?? []}
        running={row?.state === "working"}
      />
    );
  }
  if (sub.startsWith("engineer")) {
    return (
      <PlainChat
        agent="Context Engineer"
        title={sub === "engineer-new" ? "New context" : "release-notes"}
        turns={sub === "engineer-new"
          ? NEW_CONTEXT_TURNS
          : engineerTurns(open, answer, onAnswer)}
      />
    );
  }
  return <PlainChat agent="lophn" title="Session" turns={lophnTurns(open)} />;
}
