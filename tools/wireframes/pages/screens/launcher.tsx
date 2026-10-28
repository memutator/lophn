import type { Area } from "../types.ts";
import type { CoreSource } from "../../../../packages/shell/renderer/desktop/connection/connection.ts";
import {
  LauncherArchived,
  LauncherCardMenu,
  LauncherEmpty,
  LauncherLophn,
  LauncherNewApp,
  LauncherProjectDetail,
  LauncherProjects,
  LauncherRegister,
  LauncherSubfolderAdd,
  LauncherSubfolderEdit,
} from "./launcher/launcher-pages.tsx";
import { StartFailures } from "./launcher/start-failure-page.tsx";
import { MockDesktop } from "../../mock/mock-desktop.tsx";

type FailureState = "failed-start" | "failed-sandbox" | "failed-schema";

// core 연결이 이 상태로 고정된 창. 런처가 시작 실패 화면을 보인다.
function failedCore(state: FailureState): CoreSource {
  const current = { state, confirmedAt: null } as const;
  return {
    subscribe(listener) {
      listener(current);
      return () => {};
    },
    current: () => current,
    call: () =>
      Promise.resolve({
        ok: false,
        error: { code: "unavailable", message: "wireframes gallery" },
      }),
  };
}

export const launcherArea: Area = {
  id: "launcher",
  title: "Launcher",
  summary:
    "처음 여는 런처. project와 앱을 다루는 유일한 화면이다. 카드와 ⋯ 메뉴, 보관과 복원, 폴더 다시 잡기, project detail, 비었음 안내, 프로젝트 등록, New app, lophn 패널, 시작 실패 화면.",
  pages: [
    {
      id: "launcher-empty",
      title: "Launcher · empty",
      description:
        "처음 여는 런처. 프로젝트도 앱도 없어 두 section이 각자 비었음 안내를 보인다. first-project 흐름의 1단계(아직 프로젝트 없음)이고, install-lophn은 설치 뒤 처음 여는 자리다.",
      render: () => <MockDesktop emptyLauncher />,
    },
    {
      id: "launcher-projects",
      title: "Launcher · with projects",
      description:
        "프로젝트 카드가 있는 런처. 카드는 이름·목적·문서 수·추적 상태를 보이고, 카드를 누르면 그 프로젝트 작업대로 간다.",
      render: () => <MockDesktop />,
    },
    {
      id: "launcher-lophn",
      title: "Launcher · lophn panel",
      description:
        "오른쪽 아래 Ask lophn 단추를 눌러 연 대화 패널. 그 구석에서 열리고 열린 동안 단추는 숨는다. 런처 위에 떠 있고 제목 줄을 끌어 옮기고 가장자리로 크기를 바꾸며 닫아도 session은 남는다. 안은 탭과 같은 Agent 화면이다.",
      render: () => <LauncherLophn />,
    },
    {
      id: "launcher-start-failed",
      title: "Start failure · start",
      description:
        "core가 시작하지 못했을 때 런처 자리에 뜨는 화면. 일반 런처 모양 없이 실패 종류와 다음 행동 하나만 보인다.",
      render: () => <MockDesktop core={failedCore("failed-start")} />,
    },
    {
      id: "launcher-sandbox-failed",
      title: "Start failure · sandbox",
      description:
        "sandbox를 세우지 못했을 때의 시작 실패 화면. start failure와 구별되는 종류 이름과 다음 행동 하나를 보인다.",
      render: () => <MockDesktop core={failedCore("failed-sandbox")} />,
    },
    {
      id: "launcher-schema-failed",
      title: "Start failure · schema",
      description:
        "core와 shell의 schema 판이 맞지 않을 때의 시작 실패 화면. 업데이트 확인이 다음 행동이다.",
      render: () => <MockDesktop core={failedCore("failed-schema")} />,
    },
    {
      id: "new-launcher-projects",
      title: "Launcher · project cards",
      description:
        "런처의 project 카드(이름, 목적, 폴더 수 또는 Folder not found와 [Choose new location])와 앱 카드다. 카드마다 ⋯ 메뉴가 있고, 오른쪽 위 톱니 단추가 Settings로 간다. 보관한 것은 맨 아래 접힌 Archived에 있다.",
      render: () => <LauncherProjects />,
    },
    {
      id: "new-launcher-empty",
      title: "Launcher · empty",
      description:
        "project도 앱도 없는 런처다. Projects와 Apps section이 각자 비었음 안내와 행동 단추 하나(프로젝트 등록, New app)를 보인다.",
      render: () => <LauncherEmpty />,
    },
    {
      id: "new-launcher-card-menu",
      title: "Launcher · card menu",
      description:
        "project 카드의 ⋯ 메뉴다. Details는 detail dialog를 열고 Archive는 카드를 Archived로 보낸다. 앱 카드의 메뉴에는 Archive 하나가 있다.",
      render: () => <LauncherCardMenu />,
    },
    {
      id: "new-launcher-archived",
      title: "Launcher · archived",
      description:
        "맨 아래 접힌 Archived 묶음을 펼친 상태다. 보관한 project와 앱이 한 줄씩이고 [Unarchive]로 되살린다. 되살린 앱은 사람이 시작하기 전에는 멈춰 있다.",
      render: () => <LauncherArchived />,
    },
    {
      id: "new-launcher-project-detail",
      title: "Launcher · project detail",
      description:
        "카드의 Details가 여는 dialog다. 이름 하나, 목적, 폴더와 폴더 설명, 등록 폴더 아래 들여 쓴 하위 폴더를 고치고 [Save changes]로 저장한다. 사라진 폴더 줄에 Not found와 [Choose new location]이 있다.",
      render: () => <LauncherProjectDetail />,
    },
    {
      id: "new-launcher-subfolder-add",
      title: "Launcher · add subfolder",
      description:
        "등록 폴더 안의 하위 폴더를 더하는 dialog다. 폴더 고르기는 그 등록 폴더 안으로만 열리고, 이미 더한 폴더는 Added로 보인다. 고른 폴더에 설명을 달아 더한다.",
      render: () => <LauncherSubfolderAdd />,
    },
    {
      id: "new-launcher-subfolder-edit",
      title: "Launcher · edit subfolders",
      description:
        "하위 폴더 설명을 고친 상태와 하위 폴더 하나를 뺀 상태다. 빼도 폴더 자체는 그대로이고 [Undo]가 있다.",
      render: () => <LauncherSubfolderEdit />,
    },
    {
      id: "new-launcher-register",
      title: "Launcher · register project",
      description:
        "project 등록 dialog다. 이름, 목적, 폴더와 폴더 설명을 받고 짧은 이름 고르기는 없다.",
      render: () => <LauncherRegister />,
    },
    {
      id: "new-launcher-new-app",
      title: "Launcher · new app",
      description:
        "Apps section의 + 단추나 비었음 안내가 여는 dialog다. 이름과 한 줄 목적을 받고, 만들면 그 앱 공간이 그 앱 place의 lophn 새 session과 함께 열린다. 이름이 겹치면 dialog에 오류가 보인다.",
      render: () => <LauncherNewApp />,
    },
    {
      id: "new-start-failure",
      title: "Launcher · start failure",
      description:
        "높은 schema, hash가 다른 이력, 손상 원본 세 경우를 나란히 놓았다. 셋 모두 원본을 그대로 두고 시작하지 않았다는 안내와 update 안내, [Try again]이 있다.",
      render: () => <StartFailures />,
    },
  ],
};
