// Agent 탭 본문. 탭의 `sub`가 어느 session인지 정한다: Weekly report(질문·승인·되돌리기가 동작하는 이야기), 새 session
// (sidebar의 agent나 toast의 [Ask Project Manager]가 연다), 그리고 agent별 이전 session. archive한 session은 기록만 보인다. 한 탭은 agent 하나에
// 고정이고, 같은 agent의 다른 session은 agent header에서 바꾼다. 말 속의 context 이름과 객체 id는 링크라서
// 누르면 탭이 열린다.
import { type ReactNode, useEffect, useState } from "react";

import {
  AgentTurn,
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
import { type ApprovalDecision, ApprovalResult } from "./agent-tab/cards.tsx";
import {
  ANSWERS,
  APPROVAL_RESULTS,
  type AskedQuestion,
  type QuestionAnswer,
} from "./agent-tab/data.ts";
import { QuestionCard } from "./agent-tab/cards.tsx";
import { RewindPanel } from "./agent-tab/rewind-panel.tsx";
import {
  type ChatInit,
  sessionBySub,
  type SessionRow,
  SESSIONS,
  type SessionState,
} from "./agents-data.ts";
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

/** 탭 줄의 상태 점에 알리는 session 상태(사람을 기다림·일하는 중). */
export type TabState = "waiting" | "working" | null;

/** 탭 안에서 session을 바꾸거나 새로 연다. */
export interface SessionHandlers {
  readonly onSession: (row: SessionRow) => void;
  readonly onNewSession: (agent: string) => void;
  readonly onState: (state: TabState) => void;
}

interface Turn {
  readonly mine?: boolean;
  readonly time?: string;
  readonly text: ReactNode;
}

/** Project Manager가 묻는 질문. 질문 카드에서 답하면 답이 대화에 남고 작업이 이어진다. */
const CE_QUESTION =
  "Some release notes list issues by number, others by title. Should I match titles to issues too?";
const CE_ANSWERS: readonly string[] = [
  "Yes, match titles",
  "Numbers only",
];
const CE_ASKED: AskedQuestion = {
  id: "titles",
  header: "Issue titles",
  question: CE_QUESTION,
  multiSelect: false,
  options: [
    {
      label: CE_ANSWERS[0],
      description: "Count a title in the notes as a mention of its issue",
    },
    {
      label: CE_ANSWERS[1],
      description: "Only issue numbers count",
    },
  ],
};

const ASK_LOPHN = "Ask lophn… @ for documents and contexts, / for skills";
const askPlaceholder = (agent: string) =>
  `Ask ${agent}… @ for documents and contexts, / for skills`;

function lophnTurns(open: Open): readonly Turn[] {
  const finding = (id: string) => (
    <Link onClick={() => open(findingTab(id))}>{id}</Link>
  );
  return [
    {
      mine: true,
      text: "Which findings are about C-049?",
    },
    {
      time: "10:12",
      text: (
        <>
          Three: {finding("F-009")}, {finding("F-010")} and{" "}
          {finding("F-011")}. F-009 and F-010 are improvements, F-011 is a
          regression on query-recipe-gap.
        </>
      ),
    },
    { mine: true, text: "Open the regression and compare it with exp-008." },
    {
      time: "10:13",
      text: (
        <>
          Opened {finding("F-011")} next to{" "}
          <Link onClick={() => open(experimentTab("exp-008"))}>exp-008</Link>.
          The regression shows up only on scenarios that need a recipe lookup.
        </>
      ),
    },
    { mine: true, text: "Which context are these findings in?" },
    {
      time: "10:14",
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
    time: "14:02",
    text:
      "What should the new context help with? Tell me which folders or files to look at, and what you want to find.",
  },
];

function engineerTurns(open: Open, answer: string | null): readonly Turn[] {
  const turns: Turn[] = [
    {
      time: "14:20",
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
    { text: CE_QUESTION },
  ];
  if (answer !== null) {
    turns.push(
      { mine: true, text: answer },
      {
        time: "14:23",
        text: answer === CE_ANSWERS[0]
          ? "Got it. I'll match titles to issues too and go on with the searches."
          : "Got it. Only issue numbers count. I'll go on with the searches.",
      },
    );
  }
  return turns;
}

// Weekly report 말고는 session마다 짧은 이야기 하나씩이다.
const PAST: Record<string, readonly Turn[]> = {
  harness: [
    { mine: true, text: "Summarize this week's harness changes." },
    {
      time: "09:48",
      text:
        "I'm reading the 5 merged changes. So far: the recipe lookup is now one call, and the scheduler tests run faster.",
    },
  ],
  "release-check": [
    {
      mine: true,
      text: "Do the release notes mention every merged change?",
    },
    {
      time: "07:20",
      text:
        "Yes, 12 of 12 changes are listed. One entry has no issue link: C-051.",
    },
  ],
  "eval-questions": [
    { mine: true, text: "What does pass rate mean in the eval context?" },
    {
      time: "Mon 16:40",
      text:
        "It is the share of scenarios that passed in one run, a number from 0 to 1.",
    },
  ],
  "old-1": [
    {
      mine: true,
      text: "Which folders in docs/ are not linked from anywhere?",
    },
    {
      time: "Sep 24 14:05",
      text:
        "Two: docs/drafts/ and docs/old-reports/. Nothing links to them and the newest file is from March.",
    },
    { mine: true, text: "Move both into docs/archive/." },
    {
      time: "Sep 24 14:07",
      text: "Done. I moved 14 files and left a note in docs/archive/README.md.",
    },
  ],
  failing: [
    { mine: true, text: "Why did 3 scenarios fail last night?" },
    {
      time: "09:36",
      text:
        "I'm reading the three runs: query-recipe-gap, sched-edit and wake-plant. The first two fail on the same recipe lookup.",
    },
  ],
  week41: [
    { mine: true, text: "Summarize week 41 for me." },
    {
      time: "08:50",
      text:
        "Pass rate went from 0.91 to 0.93. One regression: query-recipe-gap. I linked F-011 in the summary.",
    },
  ],
  "recipe-gap": [
    { mine: true, text: "Why did query-recipe-gap regress?" },
    {
      time: "Fri 11:05",
      text:
        "It fails only when the answer needs a recipe lookup. exp-008 changed the lookup tool the week before.",
    },
  ],
  "next-experiments": [
    { mine: true, text: "What should we try next for the query tools?" },
    {
      time: "08:44",
      text:
        "Three ideas: retry the lookup once before answering, return only the top 3 recipes, and add the item name to the lookup result.",
    },
  ],
  "exp-013": [
    { mine: true, text: "Plan exp-013 so it isolates the recipe lookup." },
    {
      time: "Tue 15:30",
      text:
        "Run the 5 recipe scenarios with the old and the new tool, 10 times each, and compare pass rates.",
    },
  ],
};

/** 내 말은 오른쪽 bubble, 이어지는 agent 말은 한 덩어리로 묶어 avatar·이름·시각을 첫 말에만 단다. */
function Turns({ agent, turns }: { agent: string; turns: readonly Turn[] }) {
  const out: ReactNode[] = [];
  let group: Turn[] = [];
  const flush = () => {
    if (group.length === 0) return;
    out.push(
      <AgentTurn key={out.length} agent={agent} time={group[0].time ?? "09:41"}>
        {group.map((turn, index) => <Said key={index}>{turn.text}</Said>)}
      </AgentTurn>,
    );
    group = [];
  };
  for (const turn of turns) {
    if (turn.mine) {
      flush();
      out.push(<UserMessage key={out.length}>{turn.text}</UserMessage>);
    } else group.push(turn);
  }
  flush();
  return <>{out}</>;
}

/** 탭 줄의 상태 점을 알린다. */
function useTabState(onState: (state: TabState) => void, state: TabState) {
  useEffect(() => onState(state), [state]);
}

const tabStateOf = (state: SessionState): TabState =>
  state === "idle" ? null : state;

/** lophn과 Project Manager 등의 이전 session. archive한 session이면 입력칸이 없다. */
function PlainChat(
  { agent, row, title, turns, handlers, chat, dock }: {
    agent: string;
    row?: SessionRow;
    title: string;
    turns: readonly Turn[];
    handlers: SessionHandlers;
    chat?: ChatInit;
    dock?: ReactNode;
  },
) {
  const state = row === undefined ? null : tabStateOf(row.state);
  useTabState(handlers.onState, state);
  return (
    <ChatShell
      agent={agent}
      session={{ id: row?.id ?? "", title }}
      chat={chat}
      running={state === "working"}
      archived={row?.group === "archived"}
      dock={dock}
      placeholder={askPlaceholder(agent)}
      onSession={handlers.onSession}
      onNewSession={handlers.onNewSession}
    >
      {() => <Turns agent={agent} turns={turns} />}
    </ChatShell>
  );
}

/** 새 session. sidebar의 agent가 연다. */
function FreshChat(
  { chat, handlers }: { chat: ChatInit; handlers: SessionHandlers },
) {
  const agent = chat.agent ?? "lophn";
  useTabState(handlers.onState, null);
  return (
    <ChatShell
      agent={agent}
      session={{ id: "", title: "New session" }}
      chat={chat}
      placeholder={askPlaceholder(agent)}
      onSession={handlers.onSession}
      onNewSession={handlers.onNewSession}
    >
      {() => <p className={styles.muted}>New session with {agent}.</p>}
    </ChatShell>
  );
}

/**
 * Weekly report session. 이야기는 하나이고 진행(stage)만 다르다: 질문 카드 → 답한 뒤 → 일이 끝남, 그리고 승인 카드.
 * 질문은 [Submit]으로, 승인은 카드의 선택지로 이어진다. 내 메시지의 Rewind 단추는 대화 안 panel을 연다.
 */
function WeeklyChat(
  { open, chat, handlers }: {
    open: Open;
    chat: ChatInit;
    handlers: SessionHandlers;
  },
) {
  const [stage, setStage] = useState(chat.stage ?? "question");
  const [answers, setAnswers] = useState<readonly QuestionAnswer[]>(ANSWERS);
  const [decision, setDecision] = useState<ApprovalDecision | null>(null);
  const [rewind, setRewind] = useState(false);
  const [opened, setOpened] = useState<Record<string, boolean>>({
    search: true,
  });
  const finding = (id: string) => (
    <Link onClick={() => open(findingTab(id))}>{id}</Link>
  );
  const waiting = stage === "question" ||
    (stage === "approval" && decision === null);
  useTabState(handlers.onState, waiting ? "waiting" : null);
  const dock = stage === "question"
    ? (
      <QuestionDock
        onSubmit={(list) => {
          setAnswers(list);
          setStage("answered");
        }}
      />
    )
    : stage === "approval" && decision === null
    ? <ApprovalDock onDecide={setDecision} />
    : undefined;
  const toggle = (key: string) => setOpened({ ...opened, [key]: !opened[key] });
  return (
    <ChatShell
      agent="lophn"
      session={{ id: "weekly", title: "Weekly report" }}
      chat={chat}
      tasks
      running={waiting && stage === "approval"}
      placeholder={stage === "question"
        ? "Add more details (optional)"
        : ASK_LOPHN}
      dock={dock}
      panel={rewind ? <RewindPanel onClose={() => setRewind(false)} /> : null}
      onSession={handlers.onSession}
      onNewSession={handlers.onNewSession}
    >
      {(detail) => {
        const show = detail !== "messages";
        const isOpen = (key: string) => detail === "everything" || opened[key];
        return (
          <>
            <UserMessage
              rewindOpen={rewind}
              onRewind={() => setRewind(!rewind)}
            >
              Write this week's eval report from the new findings.
            </UserMessage>
            <AgentTurn agent="lophn" time="09:41">
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
                    <Said>
                      Three new findings since last week: {finding("F-009")} and
                      {" "}
                      {finding("F-010")} are improvements, {finding("F-011")}
                      {" "}
                      is a regression on query-recipe-gap. I wrote the report
                      and linked each finding to it.
                    </Said>
                    <EditCard
                      path="docs/reports/2026-w41.md"
                      added={24}
                      removed={3}
                      onOpen={() =>
                        open(documentTab("docs/reports/2026-w41.md"))}
                    />
                    {show ? <WorkedFor text="Worked for 18s" /> : null}
                  </>
                )
                : (
                  <Said>
                    There are 3 new findings since last week. Before I write the
                    report I need two answers.
                  </Said>
                )}
              {stage === "answered"
                ? (
                  <>
                    <AnsweredSummary answers={answers} />
                    <Said>
                      Thanks. Writing the report into docs/reports/ with the
                      sections you picked.
                    </Said>
                    <EditCard
                      path="docs/reports/2026-w41.md"
                      added={24}
                      removed={3}
                      onOpen={() =>
                        open(documentTab("docs/reports/2026-w41.md"))}
                    />
                    {show ? <WorkedFor text="Worked for 18s" /> : null}
                  </>
                )
                : null}
              {stage === "approval"
                ? (
                  <Said>
                    I can also file the regression as an issue on github. That
                    happens outside lophn, so I need your OK first.
                  </Said>
                )
                : null}
              {decision === null ? null : (
                <ApprovalResult
                  result={decision === "deny"
                    ? APPROVAL_RESULTS[2]
                    : APPROVAL_RESULTS[0]}
                />
              )}
            </AgentTurn>
          </>
        );
      }}
    </ChatShell>
  );
}

/** Agent 탭. */
export function Conversation(
  { tab, open, answer = null, onAnswer = () => {}, handlers }: {
    tab: TabSpec;
    open: Open;
    answer?: string | null;
    onAnswer?: (answer: string) => void;
    handlers: SessionHandlers;
  },
) {
  const sub = tab.sub ?? "";
  const chat = tab.chat ?? {};
  if (sub === "weekly") {
    return <WeeklyChat open={open} chat={chat} handlers={handlers} />;
  }
  if (sub === "new") return <FreshChat chat={chat} handlers={handlers} />;
  if (sub.startsWith("engineer")) {
    const fresh = sub === "engineer-new";
    return (
      <PlainChat
        agent="Project Manager"
        row={fresh ? undefined : sessionBySub("Project Manager", "engineer")}
        title={fresh ? "New context" : "Release notes context"}
        turns={fresh ? NEW_CONTEXT_TURNS : engineerTurns(open, answer)}
        dock={fresh || answer !== null ? undefined : (
          <QuestionCard
            agent="Project Manager"
            questions={[CE_ASKED]}
            onSubmit={(list) => onAnswer(list[0].answer)}
          />
        )}
        handlers={handlers}
        chat={chat}
      />
    );
  }
  const id = sub.startsWith("conv:") ? sub.slice("conv:".length) : "c049";
  const row = SESSIONS.find((item) => item.id === id) ??
    SESSIONS.find((item) => item.id === "c049")!;
  return (
    <PlainChat
      agent={row.agent}
      row={row}
      title={row.title}
      turns={id === "c049" ? lophnTurns(open) : PAST[id] ?? []}
      handlers={handlers}
      chat={chat}
    />
  );
}
