// Home. 화면은 renderer의 Desktop이 그리는 Home workspace(project 창과 같은 shell)이고 여기서는 dev mock 통로에 이어 준다.
// 오른쪽 sidebar는 Workspaces(project·앱 목록, 등록, 새 앱, 보관한 것)와 Jobs다.
import { useCallback } from "react";

import {
  click,
  press,
  runSteps,
  type Step,
  type,
  useDrive,
} from "../../../mock/drive.ts";
import { registerSteps } from "../../../mock/workspaces/register-panel.tsx";
import { MockDesktop } from "../../../mock/mock-desktop.tsx";

const SESSION_TAB = {
  key: "agent:lophn:1",
  kind: "agent",
  title: "lophn",
} as const;

function Driven({
  steps,
  emptyHome,
  withSession,
}: {
  steps: readonly Step[];
  emptyHome?: boolean;
  withSession?: boolean;
}) {
  useDrive(useCallback(() => runSteps(steps), [steps]));
  return (
    <MockDesktop
      emptyHome={emptyHome}
      {...(withSession ? { homeTabs: [SESSION_TAB] } : {})}
    />
  );
}

/** 탭이 없는 Home. 빈 desk 안내와 New session이 보이고 오른쪽에 Workspaces가 열려 있다. */
export const HomeEmpty = () => <MockDesktop />;

/** project도 앱도 없는 Home. Workspaces panel의 두 구역이 비었음 안내를 보인다. */
export const HomeNoWorkspaces = () => <MockDesktop emptyHome />;

/** Home lophn session을 탭으로 연 상태. Home workspace의 session은 다른 workspace와 같이 tab이다. */
export const HomeSession = () => <MockDesktop homeTabs={[SESSION_TAB]} />;

/** 탭 줄 끝의 + 메뉴를 연 Home. Agent 하위 메뉴 아래 Agents 항목이 Home의 Agents(관리) 탭을 연다. */
export const HomeNewTabMenu = () => (
  <Driven withSession steps={[() => press("[data-new-tab]")]} />
);

/** 오른쪽 Jobs panel. project와 상관없이 모든 job이 보인다. */
export const HomeJobs = () => (
  <Driven withSession steps={[() => click('[role="tab"]', /Jobs/)]} />
);

/** 등록 dialog를 연 Home. */
export const HomeRegister = () => (
  <Driven
    steps={[() => click("[data-register-project]"), ...registerSteps()]}
  />
);

/** New app dialog: 이름과 한 줄 목적. */
export const HomeNewApp = () => (
  <Driven
    steps={[
      () => click("[data-new-app]"),
      () => type("[data-new-app-form] [data-field='name']", "Reading list"),
      () =>
        type(
          "[data-new-app-form] [data-field='purpose']",
          "Books I want to read and what I thought of them",
        ),
    ]}
  />
);

/** project 줄의 ⋯ 메뉴. */
export const HomeRowMenu = () => (
  <Driven steps={[() => press("[data-project] [data-card-menu]")]} />
);
