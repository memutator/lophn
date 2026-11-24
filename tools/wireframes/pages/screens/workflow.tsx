import type { Area } from "../types.ts";
import {
  Asking,
  Choice,
  ChoiceRun,
  ChoiceSettings,
  Empty,
  Ended,
  Flow,
  FlowBlocked,
  FlowExited,
  FlowMissing,
  FlowRestarted,
  Home,
  HumanTurn,
  Invalid,
  NotHanded,
  RemoteFailed,
  RemoteHeld,
  RemoteTurnEnded,
  Restarted,
  Running,
  RunSettings,
  Start,
  StartFailed,
  StartFlow,
  StartLater,
  Stopped,
} from "./workflow/pages.tsx";

export const workflowArea: Area = {
  id: "workflow",
  title: "Workflow",
  summary:
    "project의 workflow 하나가 탭 하나다. 탭 안의 화면은 둘이다: workflow 화면(도는 run, 새 run 칸과 그 안에 위에서 아래로 선 step, 지난 run)과 run 하나의 화면(위에서 아래로 선 step마다 상태, session, 마지막 report, 산출물). 세부(step의 설정, 시작 입력, Activity, checkpoint)는 접혀 있다. flow도 같은 탭이다.",
  pages: [
    {
      id: "workflow-home",
      title: "Workflow · runs",
      description:
        "workflow 화면이다. 머리 아래에 도는 run(Needs you, Blocked, Running)이 먼저 오고, 새 run 칸(입력 글, 위에서 아래로 선 step과 step마다 접힌 [Settings], [Start]), 지난 run(Earlier)이 온다. run 줄을 누르면 그 run 화면으로 간다.",
      render: () => <Home />,
    },
    {
      id: "workflow-tab-empty",
      title: "Workflow · no runs",
      description:
        "run이 없는 workflow다. 새 run 칸과 step이 있고 목록 자리에는 안내 한 문장이 있다.",
      render: () => <Empty />,
    },
    {
      id: "workflow-tab-running",
      title: "Run · running",
      description:
        "도는 run의 화면이다. 위에 [All runs], run의 이름(시작 입력의 첫 줄)과 [Stop]이 있고 step이 위에서 아래로 선다. 지난 step은 마지막 report 두 줄로 접혀 있고, 지금 step은 펼쳐져 누가 하는지 한 장과 그 step의 session tree(agent 얼굴과 이름, 상태, 마지막 말, [Open session])를 가진다. 아직 닿지 않은 step은 흐리다.",
      render: () => <Running />,
    },
    {
      id: "workflow-tab-asking",
      title: "Run · the agent needs an answer",
      description:
        "agent가 맡은 step인데 그 session이 사람의 답(승인, 질문)을 기다리는 run이다. 그 step 안의 한 장이 사람 차례와 같은 색으로 바뀌고 [Open session]이 주 단추가 된다.",
      render: () => <Asking />,
    },
    {
      id: "workflow-tab-human-turn",
      title: "Run · your turn",
      description:
        "사람 step이다. 그 step 안의 한 장에 Your turn 글과 오른쪽 끝 주 단추 [Open conversation]이 있다. 대화는 workflow 탭 옆 칸에 열린다. agent 탭을 열 수 없는 창에서는 이 단추를 그리지 않는다.",
      render: () => <HumanTurn />,
    },
    {
      id: "workflow-tab-ended",
      title: "Run · ended",
      description:
        "끝난 run이다. step 위의 한 장에 끝난 때와 마지막 report 글 전체가 보인다. step은 모두 report 두 줄로 접혀 있고 누르면 펴진다. [Stop]이 없고 workflow에 artifact가 있어 [Open run artifact]가 있다.",
      render: () => <Ended />,
    },
    {
      id: "workflow-tab-stopped",
      title: "Run · stopped",
      description:
        "사람이 멈춘 run이다. step 위의 한 장에 멈춘 때가 보이고 멈춘 step에 Stopped here가 붙는다. [Stop]이 없다.",
      render: () => <Stopped />,
    },
    {
      id: "workflow-tab-not-handed",
      title: "Run · couldn't send a step",
      description:
        "다음 step을 넘기지 못한 run이다. 그 step이 펼쳐져 한 장에 이유 글과 agent에게 말하라는 안내, 마지막으로 report한 agent의 [Open session]이 있다. 상태는 그대로 Running이다.",
      render: () => <NotHanded />,
    },
    {
      id: "workflow-tab-restarted",
      title: "Run · lophn restarted",
      description:
        "lophn이 다시 켜져 넘긴 step이 끊겼을 수 있는 run이다. 그 step 안의 한 장에 다시 넘겨야 할 수 있다는 글과 그 step을 받은 session의 [Open session]이 있다. 상태는 바꾸지 않는다.",
      render: () => <Restarted />,
    },
    {
      id: "workflow-tab-remote-held",
      title: "Run · step waits on another computer",
      description:
        "다른 컴퓨터의 agent가 맡은 step이 그 컴퓨터에 늦게 닿아 사람의 결정을 기다리는 run이다. 그 step 안의 한 장이 어느 컴퓨터에서 무엇을 하면 되는지 말하고(사람 차례의 색), step의 맡은 쪽에 컴퓨터 이름이 붙는다. 받은 session은 그 컴퓨터에 있어 [Open session]이 없다.",
      render: () => <RemoteHeld />,
    },
    {
      id: "workflow-tab-remote-failed",
      title: "Run · step didn't run on another computer",
      description:
        "다른 컴퓨터로 넘긴 step이 거기서 돌지 못한 run이다. 한 장과 그 step에 core가 적은 이유 글(건너뜀, 만료, 취소, report 없이 닫힘)이 그대로 보인다.",
      render: () => <RemoteFailed />,
    },
    {
      id: "workflow-tab-remote-turn-ended",
      title: "Run · turn on another computer ended without a report",
      description:
        '다른 컴퓨터가 가져간 step의 turn이 거기서 실패해(멈춤, 재시작도 같다) report 없이 끝난 run이다. 그 컴퓨터의 lophn이 쓴 줄이 "lophn on Home server"로 그 step의 마지막 글에 보이고, 한 장이 넘기지 못한 step과 같은 무게로 그 컴퓨터의 session에서 이으라고 말한다. step은 열려 있어 뒤에 낸 report가 닿고 상태는 Running이다.',
      render: () => <RemoteTurnEnded />,
    },
    {
      id: "workflow-choice",
      title: "Workflow · either-or steps",
      description:
        "서로 대신하는 step이 있는 workflow다(조사를 Claude Code가 하거나 Antigravity가 한다. 둘 다 같은 다음 step으로 넘긴다). 둘은 한 단계에 묶여 radio로 하나를 고르고, 고른 step에서 run이 시작된다. 다른 project의 coding agent는 제품 아이콘과 이름으로 보인다.",
      render: () => <Choice />,
    },
    {
      id: "workflow-choice-settings",
      title: "Workflow · step settings open",
      description:
        "둘째 선택지를 고르고 그 단계의 [Settings]를 편 상태다. 그 step이 쓰는 입력(선언의 inputs에 steps로 적은 것)과 session을 탭으로 열지 뒤에서 돌릴지가 그 step 자리에 있다. 접혀 있을 때는 지금 값이 단추 왼쪽에 한 줄로 보인다.",
      render: () => <ChoiceSettings />,
    },
    {
      id: "workflow-start-later",
      title: "Workflow · start at a later step",
      description:
        "뒤 단계의 설정에서 [Start here]를 누른 상태다. 그 단계가 시작 단계로 칠해지고 Starts here가 붙으며, 앞 단계는 Skipped로 흐려진다.",
      render: () => <StartLater />,
    },
    {
      id: "workflow-choice-run",
      title: "Run · either-or steps, sessions per step",
      description:
        "서로 대신하는 step 가운데 하나만 지나간 run이다. 지나간 쪽만 step으로 서고 다른 쪽은 Not used 한 줄로 남는다. 지난 조사 step은 접혀 있고, 사람 차례인 design step에는 한 장과 그 step의 session(lophn, 답을 기다림)이 붙는다. 시작 입력과 고른 값은 머리 아래 접힌 Request and inputs에 있다.",
      render: () => <ChoiceRun />,
    },
    {
      id: "workflow-run-settings",
      title: "Workflow · run settings open",
      description:
        "선언적 inputs가 어느 step에도 붙지 않은 workflow다. 입력은 step 아래 Run settings에 접혀 있고 지금 값이 한 줄로 보인다. 편 상태다: 조건(when)에 맞는 칸만 보인다. 값을 꼭 채워야 하는 칸이 있으면 처음부터 펴져 있다.",
      render: () => <RunSettings />,
    },
    {
      id: "workflow-tab-flow-blocked",
      title: "Run · durable flow blocked",
      description:
        "checkpoint를 가진 durable flow가 막힌 run이다. 한 장에 [Resume], [Resume with updated code]가 있고, 자식 sub-workflow가 줄로 보이며, checkpoint 목록은 아래에 접혀 있다(개수만 보인다).",
      render: () => <FlowBlocked />,
    },
    {
      id: "workflow-tab-invalid",
      title: "Workflow · invalid declaration",
      description:
        "선언이 틀린 workflow다. 머리 아래에 이유 글이 있고 새 run 칸과 run 목록이 없다.",
      render: () => <Invalid />,
    },
    {
      id: "workflow-tab-flow",
      title: "Run · flow",
      description:
        "flow의 도는 run이다. step은 program이 맡아 얼굴이 program 아이콘이고 report는 Program이 쓴다. session이 없어 [Open session]이 없다.",
      render: () => <Flow />,
    },
    {
      id: "workflow-tab-flow-exited",
      title: "Run · flow program exited",
      description:
        "flow의 program이 오류로 끝나 닫힌 run이다. 한 장에 끝 code 줄과 stderr 끝 줄(코드 블록)이 보인다.",
      render: () => <FlowExited />,
    },
    {
      id: "workflow-tab-flow-restarted",
      title: "Run · flow closed by restart",
      description:
        "flow가 도는 중에 lophn이 다시 켜져 닫힌 run이다. 한 장 아래에 flow가 끝났고 다시 시작하지 않는다는 글이 보인다.",
      render: () => <FlowRestarted />,
    },
    {
      id: "workflow-tab-flow-missing",
      title: "Workflow · flow file missing",
      description:
        "flow.ts가 없는 flow workflow다. 새 run 칸이 꺼져 있고 [Start]의 tooltip이 이유를 보인다(열어 둠).",
      render: () => <FlowMissing />,
    },
    {
      id: "workflow-tab-artifact",
      title: "Run · with artifacts",
      description:
        "artifact가 있는 workflow의 run이다. run 머리의 [Open run artifact]가 그 run의 것을 연다. workflow 전체의 것은 workflow 화면 머리의 [Open artifact]다.",
      render: () => <Ended />,
    },
    {
      id: "workflow-start-dialog",
      title: "New run",
      description:
        "새 run 칸에 입력 글을 적은 상태다. 그 아래 step이 위에서 아래로 서고 step마다 오른쪽 끝에 지금 값(Tab, Background)과 접힌 [Settings]가 있다. 첫 단계가 시작 단계로 칠해져 있다. [Start]는 줄 오른쪽 끝이다(Ctrl·Cmd+Enter도 된다).",
      render: () => <Start />,
    },
    {
      id: "workflow-start-dialog-flow",
      title: "New run · flow",
      description:
        "flow의 새 run 칸이다. step은 program이 차례로 돌아 step마다의 설정이 없고, session을 탭으로 열지는 접힌 Run settings에 있다. flow는 입력 글을 program의 입력으로 받는다.",
      render: () => <StartFlow />,
    },
    {
      id: "workflow-start-failed",
      title: "Start failed",
      description:
        "시작이 실패한 상태다. 적은 글이 그대로 있고 탭 위쪽에 toast가 뜬다. 멈춤이 실패해도 같은 자리다.",
      render: () => <StartFailed />,
    },
  ],
};
