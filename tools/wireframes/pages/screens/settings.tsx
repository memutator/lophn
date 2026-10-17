import type { Area } from "../types.ts";
import type { ReactNode } from "react";
import { openSettings } from "../../../../packages/shell/renderer/desktop/router.ts";
import {
  SettingsAgentsPage,
  SettingsConnectPage,
  SettingsLophnPage,
  SettingsProvidersPage,
  SettingsToolsPage,
} from "./agent-setup/agent-setup-pages.tsx";
import {
  SettingsAppearance,
  SettingsAppearancePresets,
  SettingsAppearancePresetsDark,
  SettingsCoding,
  SettingsDiagnostics,
  SettingsGeneral,
  SettingsReactions,
  SettingsRequiredEmpty,
} from "./settings-pages.tsx";
import { MockDesktop, type SettingsTab } from "../../mock/mock-desktop.tsx";

function settings(tab: SettingsTab): ReactNode {
  return <MockDesktop route={openSettings()} settingsTab={tab} />;
}

export const settingsArea: Area = {
  id: "settings",
  title: "Settings",
  summary:
    "Settings의 General, Appearance, Providers, Agents, Tools, Coding agents, Reactions, Diagnostics.",
  pages: [
    {
      id: "settings-coding",
      title: "Settings · Coding agents",
      description:
        "Settings의 Coding agents 탭. 감지한 coding agent와 연결을 보고 회수한다.",
      render: () => settings("coding"),
    },
    {
      id: "settings-general",
      title: "Settings · General",
      description:
        "Settings의 General 탭. 기본 model과 읽기 설정, 전역 Instructions 편집기로 가는 길.",
      render: () => settings("general"),
    },
    {
      id: "settings-diagnostics",
      title: "Settings · Diagnostics",
      description:
        "Settings의 Diagnostics 탭. 보안 상태 점검과 doctor 결과를 영향 한 문장과 다음 행동으로 보인다.",
      render: () => settings("diagnostics"),
    },
    {
      id: "new-settings-general",
      title: "Settings · General",
      description:
        "Settings 항목은 sidebar의 Settings 아래 묶음(General, Agents, System)으로 들어가고 항목마다 아이콘이 있다. General은 선언한 항목을 타입대로 보이고, 값을 바꾸는 칸은 줄 오른쪽 끝 고정 열에 있다. 사람이 정한 값과 기본값을 나눠 보이고, 범위를 넘은 값은 거절 이유가 보인다.",
      render: () => <SettingsGeneral />,
    },
    {
      id: "new-settings-required-empty",
      title: "Settings · required setting empty",
      description:
        "필수 설정(기본 model)이 비었을 때다. 탭 위쪽 toast가 그 기능(lophn과 project agent)만 시작하지 않는다고 알리고 고르러 가는 길을 준다.",
      render: () => <SettingsRequiredEmpty />,
    },
    {
      id: "new-settings-appearance",
      title: "Settings · Appearance",
      description:
        "화면 모양을 정하는 Settings 항목이다. Theme(Light, Dark, System이 기본), Accent와 Background(색 견본), Font와 Code font(Custom은 설치된 글꼴 이름을 적는다), 글자 크기, 문서 읽기 폭, 화면 밀도가 있다. 고르면 바로 모든 화면에 적용된다. 줄마다 이름과 설명이 왼쪽, 고르는 칸이 오른쪽 끝 고정 열이다.",
      render: () => <SettingsAppearance />,
    },
    {
      id: "new-settings-appearance-presets",
      title: "Settings · Appearance, presets (light)",
      description:
        "기본이 아닌 preset(Purple, Cool, System UI, Custom 코드 글꼴, Large, Compact)을 고른 상태다. 같은 화면의 색, 글꼴, 글자 크기, 줄 높이가 바뀐다. 다른 화면은 주소에 ?appearance=accent:purple,background:cool을 붙여 본다.",
      render: () => <SettingsAppearancePresets />,
    },
    {
      id: "new-settings-appearance-presets-dark",
      title: "Settings · Appearance, presets (dark)",
      description: "같은 preset을 Dark로 본 상태다.",
      render: () => <SettingsAppearancePresetsDark />,
    },
    {
      id: "new-settings-providers",
      title: "Settings · Providers",
      description:
        "provider마다 연결 하나다. 연결된 것은 끊고 나머지는 [+ Connect]로 연결한다. 계정 목록 같은 계정 기능은 없다.",
      render: () => <SettingsProvidersPage />,
    },
    {
      id: "new-settings-connect",
      title: "Settings · connect a provider",
      description:
        "provider 연결 창이다. API key는 이 창에서 받지 않고 보호 입력으로 받는다.",
      render: () => <SettingsConnectPage />,
    },
    {
      id: "new-settings-agents",
      title: "Settings · Agents",
      description:
        "전역 기본 model 하나, lophn 카드(전체에 하나), 전역 지침, grant 기본값 설명이 있다. role별 기본 model과 요약용 model 줄은 없다.",
      render: () => <SettingsAgentsPage />,
    },
    {
      id: "new-settings-lophn",
      title: "Settings · Agents › lophn",
      description:
        "lophn의 설정이다. agent 설정 화면과 같고 project 지침 칸은 없다. 놓인 곳은 lophn 전체이고 Grants 탭이 있다.",
      render: () => <SettingsLophnPage />,
    },
    {
      id: "new-settings-tools",
      title: "Settings · Tools and skills",
      description:
        "전역 skill 켬과 끔, 전역 MCP server다. 같은 이름은 project나 agent 층이 덮는다는 안내가 있다.",
      render: () => <SettingsToolsPage />,
    },
    {
      id: "new-settings-coding",
      title: "Settings · Coding agents",
      description:
        "제품마다 vendor 아이콘과 실행 파일, version, 로그인, turn 끝 신호 있음과 없음, 첫 prompt를 맡길 수 있는지, skill 설치 실패를 보인다. 기본 제품은 아이콘이 붙은 줄에서 고르고, [Detect again]이 있다. 연결 만들기와 회수는 없다.",
      render: () => <SettingsCoding />,
    },
    {
      id: "new-settings-reactions",
      title: "Settings · Reactions",
      description:
        "새 일을 여는 domain event 다섯마다 Off, Open without asking, Ask를 고른다. 기본은 열고 묻지 않음이고, 항목마다 어느 agent의 session이 열리는지 한 줄이 있다.",
      render: () => <SettingsReactions />,
    },
    {
      id: "new-settings-diagnostics",
      title: "Settings · Diagnostics",
      description:
        "구성 요소마다 지금 쓸 수 있는지, 안전한 불가 이유, 점검한 시각이 있다. 사람이 [Run checks]를 누를 때만 점검한다.",
      render: () => <SettingsDiagnostics />,
    },
  ],
};
