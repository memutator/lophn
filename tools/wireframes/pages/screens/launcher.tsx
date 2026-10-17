import type { Area } from "../types.ts";
import type { CoreSource } from "../../../../packages/shell/renderer/desktop/connection/connection.ts";
import {
  LauncherEmpty,
  LauncherProjects,
  LauncherRegister,
  StartFailures,
} from "./workspace/pages.tsx";
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
    "처음 여는 런처. 프로젝트 카드, 비었음 안내, 프로젝트 등록, 시작 실패 화면.",
  pages: [
    {
      id: "launcher-empty",
      title: "Launcher · empty",
      description:
        "처음 여는 런처. 프로젝트 카드가 없어 비었음 안내만 보인다. first-project 흐름의 1단계(아직 프로젝트 없음)이고, install-lophn은 설치 뒤 처음 여는 자리다.",
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
        "런처의 project 카드(이름, 목적, 폴더 수 또는 Folder not found)와 앱 카드다. 들어가는 단추의 이름이 Lophn Workspace다.",
      render: () => <LauncherProjects />,
    },
    {
      id: "new-launcher-empty",
      title: "Launcher · empty",
      description:
        "project도 앱도 없는 런처다. 다음 행동 단추의 이름이 Lophn Workspace다.",
      render: () => <LauncherEmpty />,
    },
    {
      id: "new-launcher-register",
      title: "Launcher · register project",
      description:
        "project 등록 dialog다. 이름, 목적, 폴더와 폴더 설명을 받고 짧은 이름 고르기는 없다.",
      render: () => <LauncherRegister />,
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
