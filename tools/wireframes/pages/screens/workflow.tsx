import type { Area } from "../types.ts";
import {
  Asking,
  Empty,
  Ended,
  Flow,
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
  Start,
  StartFailed,
  StartFlow,
  Stopped,
} from "./workflow/pages.tsx";

export const workflowArea: Area = {
  id: "workflow",
  title: "Workflow",
  summary:
    "project의 workflow 하나가 탭 하나다. 탭 안의 화면은 둘이다: workflow 화면(step 줄, 새 run 칸, run 목록)과 run 하나의 화면(step 줄, 지금 어디에 있는지 한 장, step마다 맡은 쪽과 마지막 report). flow도 같은 탭이다.",
  pages: [
    {
      id: "workflow-home",
      title: "Workflow · runs",
      description:
        "workflow 화면이다. 머리 아래에 step 줄(step 이름과 맡은 쪽의 얼굴), 새 run 칸, run 목록이 온다. run은 Needs you, Running, Earlier로 묶이고 줄을 누르면 그 run 화면으로 간다.",
      render: () => <Home />,
    },
    {
      id: "workflow-tab-empty",
      title: "Workflow · no runs",
      description:
        "run이 없는 workflow다. step 줄과 새 run 칸이 있고 목록 자리에는 안내 한 문장이 있다.",
      render: () => <Empty />,
    },
    {
      id: "workflow-tab-running",
      title: "Run · running",
      description:
        "도는 run의 화면이다. 위에 [All runs], run의 이름(시작 입력의 첫 줄)과 [Stop], step 줄, 지금 누가 어느 step을 하는지 한 장과 [Open session]이 있다. 아래 step마다 맡은 쪽, 마지막 report, Activity 펼침, 그 step을 받은 session을 여는 [Open session]이 있다.",
      render: () => <Running />,
    },
    {
      id: "workflow-tab-asking",
      title: "Run · the agent needs an answer",
      description:
        "agent가 맡은 step인데 그 session이 사람의 답(승인, 질문)을 기다리는 run이다. 한 장이 사람 차례와 같은 색으로 바뀌고 [Open session]이 주 단추가 된다.",
      render: () => <Asking />,
    },
    {
      id: "workflow-tab-human-turn",
      title: "Run · your turn",
      description:
        "사람 step이다. 한 장에 Your turn 글과 오른쪽 끝 주 단추 [Open conversation]이 있다. 대화는 workflow 탭 옆 칸에 열린다. agent 탭을 열 수 없는 창에서는 이 단추를 그리지 않는다.",
      render: () => <HumanTurn />,
    },
    {
      id: "workflow-tab-ended",
      title: "Run · ended",
      description:
        "끝난 run이다. 한 장에 끝난 때와 마지막 report 글 전체가 보인다. [Stop]이 없고 workflow에 artifact가 있어 [Open run artifact]가 있다.",
      render: () => <Ended />,
    },
    {
      id: "workflow-tab-stopped",
      title: "Run · stopped",
      description:
        "사람이 멈춘 run이다. 한 장에 멈춘 때가 보이고 멈춘 step에 Stopped here가 붙는다. [Stop]이 없다.",
      render: () => <Stopped />,
    },
    {
      id: "workflow-tab-not-handed",
      title: "Run · couldn't send a step",
      description:
        "다음 step을 넘기지 못한 run이다. 한 장에 이유 글과 agent에게 말하라는 안내, 마지막으로 report한 agent의 [Open session]이 있다. 상태는 그대로 Running이다.",
      render: () => <NotHanded />,
    },
    {
      id: "workflow-tab-restarted",
      title: "Run · lophn restarted",
      description:
        "lophn이 다시 켜져 넘긴 step이 끊겼을 수 있는 run이다. 한 장에 다시 넘겨야 할 수 있다는 글과 그 step을 받은 session의 [Open session]이 있다. 상태는 바꾸지 않는다.",
      render: () => <Restarted />,
    },
    {
      id: "workflow-tab-remote-held",
      title: "Run · step waits on another computer",
      description:
        "다른 컴퓨터의 agent가 맡은 step이 그 컴퓨터에 늦게 닿아 사람의 결정을 기다리는 run이다. 한 장이 어느 컴퓨터에서 무엇을 하면 되는지 말하고(사람 차례의 색), step 줄의 맡은 쪽에 컴퓨터 이름이 붙는다. 받은 session은 그 컴퓨터에 있어 [Open session]이 없다.",
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
      id: "workflow-tab-invalid",
      title: "Workflow · invalid declaration",
      description:
        "선언이 틀린 workflow다. 머리 아래에 이유 글이 있고 step 줄, 새 run 칸, run 목록이 없다.",
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
        "새 run 칸에 입력 글을 적은 상태다. step이 여럿이면 시작할 step을 고를 수 있고 기본은 첫 step이다. [Start]는 줄 오른쪽 끝이다(Ctrl·Cmd+Enter도 된다).",
      render: () => <Start />,
    },
    {
      id: "workflow-start-dialog-flow",
      title: "New run · flow",
      description:
        "flow의 새 run 칸이다. 입력 글만 받고 first step 칸이 없다. flow는 입력 글을 program의 입력으로 받는다.",
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
