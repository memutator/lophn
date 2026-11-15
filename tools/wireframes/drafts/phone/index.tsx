// lophn phone app drafts. One page per flow, and one page with every flow for reading the whole app at once.
// Open `?frame=phone-all` on its own to see the board at full size.
import type { ReactNode } from "react";
import type { Area, Page } from "../../pages/types.ts";
import { AppsFlow } from "./apps.tsx";
import { CodingFlow } from "./coding.tsx";
import { InboxFlow } from "./inbox.tsx";
import { Board } from "./kit.tsx";
import { OpsFlow, SettingsFlow, WideFlow } from "./more.tsx";
import { SessionFlow } from "./session.tsx";
import { ShellFlow } from "./shell.tsx";
import { StartFlow } from "./start.tsx";
import { WorkspaceFlow } from "./workspace.tsx";

interface FlowPage {
  id: string;
  title: string;
  description: string;
  /** Frame height: a heading and rows of three phones, each with a caption under it. */
  height: number;
  render: () => ReactNode;
}

const rows = (shots: number) => 150 + Math.ceil(shots / 3) * 960;

const FLOWS: readonly FlowPage[] = [
  {
    id: "phone-start",
    title: "Phone · 1 Start and pair",
    description:
      "처음 켰을 때부터 컴퓨터와 pairing이 끝날 때까지. QR scan, 연결 중, 연결됨과 알림, 실패 둘, code 붙여 넣기.",
    height: rows(7),
    render: () => <StartFlow />,
  },
  {
    id: "phone-shell",
    title: "Phone · 2 Home and the sidebar",
    description:
      "앱의 뼈대. Home, desktop과 같은 sidebar, 컴퓨터 바꾸기, 컴퓨터가 꺼졌을 때, 검색.",
    height: rows(5),
    render: () => <ShellFlow />,
  },
  {
    id: "phone-apps",
    title: "Phone · 3 Apps",
    description:
      "사람의 앱을 폰에서 여는 화면. 컴퓨터에서 도는 앱, 폰에서 도는 앱, 앱 menu, 고쳐 달라고 하기, 새 판, 실행 기록, 새 앱.",
    height: rows(8),
    render: () => <AppsFlow />,
  },
  {
    id: "phone-session",
    title: "Phone · 4 Session",
    description:
      "agent와의 대화. 끝난 답, 일하는 중, 승인, 질문, 한 일 상세, diff, 첨부, model, session menu, coding agent, 폰에서 못 하는 것, 새 session.",
    height: rows(13),
    render: () => <SessionFlow />,
  },
  {
    id: "phone-inbox",
    title: "Phone · 5 Inbox",
    description:
      "나를 기다리는 것 전부. Now, 앱 새 판 살펴보기, History, 빈 상태, 잠금 화면 알림.",
    height: rows(5),
    render: () => <InboxFlow />,
  },
  {
    id: "phone-workspace",
    title: "Phone · 6 Project workspace",
    description:
      "project 하나의 session, workflow, file. workflow의 내 차례와 문서 읽기.",
    height: rows(5),
    render: () => <WorkspaceFlow />,
  },
  {
    id: "phone-ops",
    title: "Phone · 7 Jobs and agents",
    description: "Jobs 목록과 상세, Agents 목록과 상세.",
    height: rows(4),
    render: () => <OpsFlow />,
  },
  {
    id: "phone-settings",
    title: "Phone · 8 Settings",
    description: "폰 앱의 설정. 컴퓨터, 알림, 모양.",
    height: rows(4),
    render: () => <SettingsFlow />,
  },
  {
    id: "phone-wide",
    title: "Phone · 9 Wide screens",
    description:
      "600보다 넓은 화면(편 접는 폰, tablet)에서는 sidebar가 늘 열려 두 칸이 된다.",
    height: 1000,
    render: () => <WideFlow />,
  },
  {
    id: "phone-coding",
    title: "Phone · 10 Coding agents and terminal",
    description:
      "컴퓨터의 coding agent를 폰에서 다룬다. project의 coding session 묶음, 앱 깨우기, 승인, 터미널 session을 채팅으로 바꾸기, 새 coding session과 이어 가기, 터미널 화면.",
    height: rows(12),
    render: () => <CodingFlow />,
  },
];

const pages: Page[] = [
  {
    id: "phone-all",
    title: "Phone · all screens",
    description:
      "폰 앱 화면 전체를 흐름 순서로 한 장에 그린다. 따로 열면(?frame=phone-all) 제 크기로 보인다.",
    height: FLOWS.reduce((sum, flow) => sum + flow.height, 0),
    render: () => (
      <Board>
        {FLOWS.map((flow) => (
          <div key={flow.id}>{flow.render()}</div>
        ))}
      </Board>
    ),
  },
  ...FLOWS.map(
    (flow): Page => ({
      id: flow.id,
      title: flow.title,
      description: flow.description,
      height: flow.height,
      render: () => <Board>{flow.render()}</Board>,
    }),
  ),
];

export const phoneArea: Area = {
  id: "phone",
  title: "Phone app",
  summary:
    "lophn 폰 앱의 초안. 컴퓨터와 pairing하는 첫 화면부터 sidebar, 앱, 대화, Inbox, 설정까지 흐름마다 그린다.",
  pages,
};
