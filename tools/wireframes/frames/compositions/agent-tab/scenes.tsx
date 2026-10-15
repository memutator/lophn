// Agent 탭의 새 설계 화면들. 모두 동작하는 ProjectApp 위에 고정 상태로 놓고, 탭 본문은 `body`로 직접 그린다.
// 한 화면은 한 상태다: 보내기, 보낸 쪽 chip, call 블록, 질문 카드, 승인 카드, rewind, 권한, recap.
import type { ReactNode } from "react";

import {
  AgentTurn,
  ChatShell,
  EditCard,
  Said,
  UserMessage,
} from "../agent-chat.tsx";
import { type ChatInit, DEMO_PICKER } from "../agents-data.ts";
import { documentTab } from "../phroner-data.ts";
import { ProjectApp } from "../project-app.tsx";
import type { TabSpec } from "../project-window.tsx";
import { AppCard } from "./app-card.tsx";
import { CallBlock } from "./call-block.tsx";
import {
  ApprovalCard,
  ApprovalResult,
  QuestionCard,
  QuestionSummary,
} from "./cards.tsx";
import {
  ANSWERS,
  APPROVAL_MCP,
  APPROVAL_RESULTS,
  APPROVAL_SETTINGS,
  ASKED,
  CALL_CANCELLED,
  CALL_DONE,
  CALL_FAILED,
  CALL_OPEN,
  FROM_CODING,
  FROM_FAILED,
  FROM_LOPHN,
  FROM_OPERATOR,
  FROM_REACTION,
} from "./data.ts";
import { ErrorMessage } from "./error-message.tsx";
import { RewindPanel } from "./rewind-panel.tsx";
import { ReceivedMessage } from "./sender.tsx";

const DOC = documentTab("eval/experiments/exp-008-query-tools.md");
const SIDEBAR = { foldersClosed: true } as const;

const ASK = "Ask lophn… @ for documents and contexts, / for skills";
const REQUEST = "Write this week's eval report from the new findings.";

interface SceneProps {
  readonly agent?: string;
  readonly session: { id: string; title: string };
  readonly running?: boolean;
  readonly archived?: boolean;
  readonly chat?: ChatInit;
  readonly placeholder?: string;
  readonly dock?: ReactNode;
  readonly panel?: ReactNode;
  readonly queued?: readonly string[];
  readonly tasks?: boolean;
  readonly children: ReactNode;
}

/** 대화 한 장면을 Agent 탭 본문으로 놓는다. */
function Scene(
  {
    agent = "lophn",
    session,
    running = false,
    archived = false,
    chat,
    placeholder,
    dock,
    panel,
    queued,
    tasks = false,
    children,
  }: SceneProps,
) {
  const body = (
    <ChatShell
      agent={agent}
      session={session}
      chat={chat}
      running={running}
      archived={archived}
      tasks={tasks}
      placeholder={placeholder ?? ASK}
      dock={dock}
      panel={panel}
      queued={queued}
    >
      {() => children}
    </ChatShell>
  );
  const tab: TabSpec = {
    key: `scene:${session.id}`,
    kind: "agent",
    title: `${session.title} · ${agent}`,
    body,
  };
  return (
    <ProjectApp
      sidebar={SIDEBAR}
      panes={[{ tabs: [DOC, tab], selected: tab.key }]}
    />
  );
}

const WEEKLY = { id: "weekly", title: "Weekly report" } as const;
const BOARD = {
  id: "board-crash",
  title: "Eval board keeps crashing",
} as const;

/** 일하는 중인 Weekly report의 앞부분. 보내기·rewind 화면이 같이 쓴다. */
function WorkingThread({ steerSent = false }: { steerSent?: boolean }) {
  return (
    <>
      <UserMessage onRewind={() => {}}>{REQUEST}</UserMessage>
      <AgentTurn agent="lophn" time="09:41">
        <Said>
          F-011 is a regression on query-recipe-gap. Here is the run from Eval
          board.
        </Said>
        <AppCard />
        <EditCard
          path="docs/reports/2026-w41.md"
          added={24}
          removed={3}
          onOpen={() => {}}
        />
      </AgentTurn>
      {steerSent
        ? (
          <>
            <UserMessage steer>
              Also add the exp-008 numbers to the report.
            </UserMessage>
            <AgentTurn agent="lophn" time="09:42">
              <Said>
                Got it. I will add the exp-008 numbers when I reach the
                regression section.
              </Said>
            </AgentTurn>
          </>
        )
        : null}
    </>
  );
}

/** 대화와 보내기: 일하는 중에 steer로 보낸 메시지에는 steer 표시가 붙고, 시각 블록은 앱 카드뿐이다. */
export function ConversationScene() {
  return (
    <Scene session={WEEKLY} running tasks>
      <WorkingThread steerSent />
    </Scene>
  );
}

/** 일하는 중에 보낸 메시지가 composer 위에 "다음 turn" 줄로 쌓인다. 줄 오른쪽 끝의 [Send now]를 누르면 도는 turn에 steer로 들어간다. */
export function QueuedMessageScene() {
  return (
    <Scene
      session={WEEKLY}
      running
      tasks
      queued={["Also add the exp-008 numbers to the report."]}
    >
      <WorkingThread />
    </Scene>
  );
}

/** model을 바꾼 뒤 provider가 요청을 거절한 모습. 어떤 오류인지와 [Retry]가 대화 안에 남는다. */
export function RequestErrorScene() {
  return (
    <Scene session={WEEKLY} chat={{ model: DEMO_PICKER }}>
      <UserMessage onRewind={() => {}}>{REQUEST}</UserMessage>
      <ErrorMessage
        title="Request failed"
        detail="OpenAI rejected the request (400): the Priority speed option is not enabled for this account. Nothing was changed."
      />
    </Scene>
  );
}

/** 받은 메시지의 보낸 쪽 chip 셋(program의 reaction, 다른 agent, coding agent). 마지막 chip은 눌러서 panel을 열었다. */
export function SenderChipsScene() {
  return (
    <Scene
      agent="App Engineer"
      session={BOARD}
      running
      placeholder="Ask App Engineer… @ for documents and contexts, / for skills"
    >
      <ReceivedMessage envelope={FROM_REACTION} time="09:30">
        Eval board stopped restarting after 5 crashes in 2 minutes.
      </ReceivedMessage>
      <ReceivedMessage envelope={FROM_LOPHN} time="09:36">
        About the fix for P-12: keep the scenario names as they are.
      </ReceivedMessage>
      <ReceivedMessage envelope={FROM_CODING} time="09:52" defaultOpen>
        The lookup change is done and the checks pass.
      </ReceivedMessage>
    </Scene>
  );
}

/** 보낸 session의 call 블록을 펼친 모습: 받는 곳, 맡긴 글 한 줄, 답 방식, 그때의 상태. 끝나지 않아서 [Cancel]이 있고, 취소한 call은 줄이 그어진다. */
export function CallOpenScene() {
  return (
    <Scene session={WEEKLY} running>
      <UserMessage onRewind={() => {}}>
        Why did those 3 scenarios regress?
      </UserMessage>
      <AgentTurn agent="lophn" time="09:44">
        <Said>
          I will ask the Eval analyst to look for what they have in common, and
          go on with the report meanwhile.
        </Said>
        <CallBlock call={CALL_OPEN} defaultOpen />
        <Said>
          While that runs, I am drafting the sections that do not need it. I
          cancelled the check on the eval context, because the answer changed
          nothing.
        </Said>
        <CallBlock call={CALL_CANCELLED} />
      </AgentTurn>
    </Scene>
  );
}

/** call이 끝난 모습 둘. 답과 실패는 블록이 아니라 그 call에 이어지는 새 메시지로 보인다. */
export function CallRepliesScene() {
  return (
    <Scene session={WEEKLY}>
      <AgentTurn agent="lophn" time="09:44">
        <CallBlock call={CALL_DONE} />
      </AgentTurn>
      <ReceivedMessage
        envelope={FROM_OPERATOR}
        time="09:48"
        replyTo={CALL_DONE.task}
      >
        {FROM_OPERATOR.task}
      </ReceivedMessage>
      <AgentTurn agent="lophn" time="09:49">
        <CallBlock call={CALL_FAILED} defaultOpen />
      </AgentTurn>
      <ReceivedMessage
        envelope={FROM_FAILED}
        time="09:50"
        replyTo={CALL_FAILED.task}
      >
        {FROM_FAILED.task}
      </ReceivedMessage>
    </Scene>
  );
}

const QUESTION_LEAD = (
  <Said>
    There are 3 new findings since last week. Before I write the report I need
    two answers.
  </Said>
);

/** 질문 카드: header, 선택지 2~4개(label과 description), multiSelect, 늘 붙는 Other. 기한도 Skip도 없다. */
export function QuestionScene() {
  return (
    <Scene
      session={WEEKLY}
      placeholder="Answer above, or send a message to end the questions"
      dock={
        <QuestionCard
          agent="lophn"
          questions={ASKED}
          initial={{
            place: [ASKED[0].options[0].label],
            sections: [
              ASKED[1].options[0].label,
              ASKED[1].options[1].label,
            ],
          }}
        />
      }
    >
      <UserMessage onRewind={() => {}}>{REQUEST}</UserMessage>
      <AgentTurn agent="lophn" time="09:41">{QUESTION_LEAD}</AgentTurn>
    </Scene>
  );
}

/** 답한 뒤: 카드가 대화 안의 접힌 요약이 되고 일이 이어진다. */
export function QuestionAnsweredScene() {
  return (
    <Scene session={WEEKLY} running>
      <UserMessage onRewind={() => {}}>{REQUEST}</UserMessage>
      <AgentTurn agent="lophn" time="09:41">
        {QUESTION_LEAD}
        <QuestionSummary outcome="submitted" answers={ANSWERS} />
        <Said>
          Thanks. I am writing the report into docs/reports/ with the sections
          you picked.
        </Said>
      </AgentTurn>
    </Scene>
  );
}

/** 기다리는 중 내가 그냥 메시지를 보낸 뒤: 카드가 "Ended by your message"로 접히고, lophn이 그 메시지를 답으로 읽는다. */
export function QuestionEndedScene() {
  return (
    <Scene session={WEEKLY} running>
      <UserMessage onRewind={() => {}}>{REQUEST}</UserMessage>
      <AgentTurn agent="lophn" time="09:41">
        {QUESTION_LEAD}
        <QuestionSummary
          outcome="message"
          headers={ASKED.map((question) => question.header)}
        />
      </AgentTurn>
      <UserMessage onRewind={() => {}}>
        Just put it in docs/reports/ with the regressions, no other sections.
      </UserMessage>
      <AgentTurn agent="lophn" time="09:42">
        <Said>
          Understood. docs/reports/ with the regressions section only.
        </Said>
      </AgentTurn>
    </Scene>
  );
}

const ISSUE_LEAD = (
  <Said>
    F-011 is a regression on query-recipe-gap. I can file it as an issue on
    github. That happens outside lophn, so I need your OK first.
  </Said>
);

/** 승인 카드(MCP tool): 내용은 program 문구(대상, 입력, 효과)이고 선택지는 한 번, 이 session 동안, 항상, 거절이다. */
export function ApprovalScene() {
  return (
    <Scene
      session={WEEKLY}
      running
      dock={<ApprovalCard agent="lophn" kind="tool" content={APPROVAL_MCP} />}
    >
      <UserMessage onRewind={() => {}}>{REQUEST}</UserMessage>
      <AgentTurn agent="lophn" time="09:41">{ISSUE_LEAD}</AgentTurn>
    </Scene>
  );
}

/** [Deny]를 누른 모습: 이유를 적는 칸이 열린다. 적지 않고 보내도 된다. */
export function ApprovalDenyScene() {
  return (
    <Scene
      session={WEEKLY}
      running
      dock={
        <ApprovalCard
          agent="lophn"
          kind="tool"
          content={APPROVAL_MCP}
          denyOpen
          reason="The issue already exists as #212."
        />
      }
    >
      <UserMessage onRewind={() => {}}>{REQUEST}</UserMessage>
      <AgentTurn agent="lophn" time="09:41">{ISSUE_LEAD}</AgentTurn>
    </Scene>
  );
}

/** 설정 고치기(LOPHN.md 쓰기): 선택지는 [Allow]와 [Deny]뿐이고 바뀌는 줄을 보인다. */
export function ApprovalSettingsScene() {
  return (
    <Scene
      session={WEEKLY}
      running
      dock={
        <ApprovalCard
          agent="lophn"
          kind="settings"
          content={APPROVAL_SETTINGS}
        />
      }
    >
      <UserMessage onRewind={() => {}}>
        From now on, put every new report in docs/reports/.
      </UserMessage>
      <AgentTurn agent="lophn" time="09:41">
        <Said>
          I will write that into LOPHN.md so every agent here follows it.
          Changing that file needs your OK.
        </Said>
      </AgentTurn>
    </Scene>
  );
}

/** 결정 뒤 대화에 남는 줄 넷: 허락을 받은 것, 적용된 것, 거절, 일이 끝나 취소된 것을 구별한다. */
export function ApprovalStatesScene() {
  return (
    <Scene session={WEEKLY}>
      <UserMessage onRewind={() => {}}>
        Go on with the issue and the LOPHN.md change.
      </UserMessage>
      <AgentTurn agent="lophn" time="09:41">
        {APPROVAL_RESULTS.map((result) => (
          <ApprovalResult key={result.outcome} result={result} />
        ))}
      </AgentTurn>
    </Scene>
  );
}

/** rewind: 내 메시지에서 그 시점으로 되돌리는 panel이 대화 화면 안에 열린다. 앱은 앱마다 고른다. */
export function RewindScene() {
  return (
    <Scene
      session={WEEKLY}
      tasks
      panel={<RewindPanel initialApps={["Eval board"]} />}
    >
      <UserMessage rewindOpen onRewind={() => {}}>{REQUEST}</UserMessage>
      <AgentTurn agent="lophn" time="09:41">
        <Said>
          I wrote the report and started a run on Eval board for week 41.
        </Said>
        <EditCard
          path="docs/reports/2026-w41.md"
          added={24}
          removed={3}
          onOpen={() => {}}
        />
      </AgentTurn>
      <UserMessage steer>
        Also add the exp-008 numbers to the report.
      </UserMessage>
    </Scene>
  );
}

/** `/recap`: session을 짧게 요약해 보이고 대화 이력은 그대로 둔다. */
export function RecapScene() {
  return (
    <Scene session={WEEKLY} running tasks chat={{ view: "recap" }}>
      <WorkingThread />
    </Scene>
  );
}

/** `/permissions`: 그 agent의 agent grant와 이 session에서 "이 session 동안"으로 허락한 대상. 입력칸 아래 요약을 눌러도 같은 보기가 열린다. */
export function PermissionsScene() {
  return (
    <Scene session={WEEKLY} running tasks chat={{ view: "permissions" }}>
      <WorkingThread />
    </Scene>
  );
}
