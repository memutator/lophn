import type { Area } from "../types.ts";
import {
  Empty,
  Ended,
  Flow,
  FlowExited,
  FlowMissing,
  FlowRestarted,
  HumanTurn,
  Invalid,
  NotHanded,
  Restarted,
  Running,
  StartDialog,
  StartDialogFlow,
  StartFailed,
  Stopped,
} from "./workflow/pages.tsx";

export const workflowArea: Area = {
  id: "workflow",
  title: "Workflow",
  summary:
    "project의 workflow 하나가 탭 하나다. instance 목록과 instance 하나의 기본 view(step마다 마지막 report와 줄, 사람 차례, 멈춤), 시작 dialog. flow도 같은 탭이다(Program이 낸 report, 종료 줄).",
  pages: [
    {
      id: "workflow-tab-empty",
      title: "Workflow tab · no instances",
      description:
        "instance가 없는 workflow의 탭이다. 머리에 이름과 [Start]가 있고 본문에는 안내 한 문장과 [Start]가 있다.",
      render: () => <Empty />,
    },
    {
      id: "workflow-tab-running",
      title: "Workflow tab · running",
      description:
        "도는 instance를 고른 탭이다. step마다 담당, 마지막 report 글, 줄 펼침이 있고 지금 step은 In progress로 보이며 줄이 펼쳐져 있다. 머리에 [Stop]이 있다.",
      render: () => <Running />,
    },
    {
      id: "workflow-tab-human-turn",
      title: "Workflow tab · your turn",
      description:
        "사람 step이다. Your turn 표시와 그 step을 받은 agent 이름, 오른쪽 끝 [Open conversation]이 있다. agent 탭을 열 수 없는 창에서는 이 단추를 그리지 않는다.",
      render: () => <HumanTurn />,
    },
    {
      id: "workflow-tab-ended",
      title: "Workflow tab · ended",
      description:
        "끝난 instance다. 모든 step이 Reported이고 머리 아래 Ended 줄이 있다. [Stop]이 없고 workflow에 artifact가 있어 [Open instance artifact]가 있다.",
      render: () => <Ended />,
    },
    {
      id: "workflow-tab-stopped",
      title: "Workflow tab · stopped",
      description:
        "사람이 멈춘 instance다. 상태가 Stopped이고 멈춘 step에 Stopped here, 머리 아래에 멈춘 시각이 보인다. [Stop]이 없다.",
      render: () => <Stopped />,
    },
    {
      id: "workflow-tab-not-handed",
      title: "Workflow tab · couldn't send a step",
      description:
        "다음 step을 넘기지 못한 instance다. 그 step 줄 안에 이유 글 한 줄이 보인다. 상태는 그대로 Running이다.",
      render: () => <NotHanded />,
    },
    {
      id: "workflow-tab-restarted",
      title: "Workflow tab · lophn restarted",
      description:
        "lophn이 다시 켜져 넘긴 step이 끊겼을 수 있는 instance다. 그 step 줄에 다시 넘겨야 할 수 있다는 글이 보인다. 상태는 바꾸지 않는다.",
      render: () => <Restarted />,
    },
    {
      id: "workflow-tab-invalid",
      title: "Workflow tab · invalid declaration",
      description:
        "선언이 틀린 workflow다. 머리 아래에 이유 글이 있고 [Start]가 없다.",
      render: () => <Invalid />,
    },
    {
      id: "workflow-tab-flow",
      title: "Workflow tab · flow",
      description:
        "startable flow의 도는 instance다. step은 program이 맡아 담당 글이 없고 report는 Program이 쓴다.",
      render: () => <Flow />,
    },
    {
      id: "workflow-tab-flow-exited",
      title: "Workflow tab · flow program exited",
      description:
        "flow의 program이 오류로 끝나 닫힌 instance다. 상태는 Ended이고 머리 아래에 끝 code 줄과 stderr 끝 줄(코드 블록)이 보인다.",
      render: () => <FlowExited />,
    },
    {
      id: "workflow-tab-flow-restarted",
      title: "Workflow tab · flow closed by restart",
      description:
        "flow가 도는 중에 lophn이 다시 켜져 닫힌 instance다. 머리 아래에 flow가 끝났고 다시 시작하지 않는다는 글이 보인다.",
      render: () => <FlowRestarted />,
    },
    {
      id: "workflow-tab-flow-missing",
      title: "Workflow tab · flow file missing",
      description:
        "flow.ts가 없는 flow workflow다. [Start]가 꺼져 있고 이유를 tooltip으로 보인다(열어 둠). instance 목록 절의 빈 안내에는 [Start] 대신 [Refresh]가 있다.",
      render: () => <FlowMissing />,
    },
    {
      id: "workflow-tab-artifact",
      title: "Workflow tab · with artifacts",
      description:
        "artifact가 있는 workflow다. [Open artifact]가 둘이다: 머리의 것은 workflow 전체(static), instance 머리의 [Open instance artifact]는 고른 instance 것을 연다.",
      render: () => <Ended />,
    },
    {
      id: "workflow-start-dialog",
      title: "Start dialog",
      description:
        "[Start]가 여는 dialog다. 입력 글(필수)과 시작할 step을 받고 기본은 첫 step이다. 글을 채워 [Start]를 누를 수 있는 상태다.",
      render: () => <StartDialog />,
    },
    {
      id: "workflow-start-dialog-flow",
      title: "Start dialog · flow",
      description:
        "flow의 시작 dialog다. 입력 글만 받고 first step 칸이 없다. flow는 입력 글을 program의 입력으로 받는다.",
      render: () => <StartDialogFlow />,
    },
    {
      id: "workflow-start-failed",
      title: "Start failed",
      description:
        "시작이 실패한 상태다. dialog는 입력을 지킨 채 열려 있고 탭 위쪽에 toast가 뜬다. 멈춤이 실패해도 같은 자리다.",
      render: () => <StartFailed />,
    },
  ],
};
