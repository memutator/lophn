import type { Area } from "../types.ts";
import type { CoreSource } from "../../../../packages/shell/renderer/desktop/connection/connection.ts";
import {
  HomeEmpty,
  HomeJobs,
  HomeNewApp,
  HomeNoPlaces,
  HomeRegister,
  HomeRowMenu,
  HomeSession,
} from "./home/home-pages.tsx";
import { StartFailures } from "./home/start-failure-page.tsx";
import { MockDesktop } from "../../mock/mock-desktop.tsx";

type FailureState = "failed-start" | "failed-sandbox" | "failed-schema";

// core 연결이 이 상태로 고정된 창. Home 자리에 시작 실패 화면이 선다.
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

export const homeArea: Area = {
  id: "home",
  title: "Home",
  summary:
    "처음 여는 Home place. project 창과 같은 shell을 쓴다: 왼쪽 place·session, 가운데 tab(Home lophn session 등), 오른쪽 Places·Jobs. desk 단추는 없다(Main 하나). core가 준비되지 않았거나 시작에 실패하면 shell 대신 연결·시작 실패 화면.",
  pages: [
    {
      id: "home-empty",
      title: "Home · empty",
      description:
        "탭이 없는 Home. 가운데 card가 빈 desk 안내(New session, Open document)를 보이고, 오른쪽 sidebar는 Places panel이다(Projects와 Apps 줄을 누르면 그 place로 가고, 각 구역 머리의 단추가 등록과 New app dialog를 연다. 보관한 것은 접힌 Archived 구역). title bar에 desk 단추가 없다.",
      render: () => <HomeEmpty />,
    },
    {
      id: "home-session",
      title: "Home · lophn session",
      description:
        "Home의 lophn session을 탭으로 연 상태. Home의 lophn session도 다른 place와 같이 tab으로 열린다. Home session의 탭은 project 폴더가 필요한 terminal, Explorer, domain, workflow를 두지 않는다.",
      render: () => <HomeSession />,
    },
    {
      id: "home-places-menu",
      title: "Home · Places row menu",
      description: "project 줄 ⋯ 메뉴: Details, 새 위치 고르기, Archive.",
      render: () => <HomeRowMenu />,
    },
    {
      id: "home-no-places",
      title: "Home · no places",
      description:
        "project도 앱도 없는 Home. Places panel의 두 구역이 비었음 안내를 보인다.",
      render: () => <HomeNoPlaces />,
    },
    {
      id: "home-jobs",
      title: "Home · Jobs panel",
      description:
        "오른쪽 Jobs panel. project 창의 Jobs와 같은 모양이고 Home에서는 모든 place의 job이 보인다.",
      render: () => <HomeJobs />,
    },
    {
      id: "home-register",
      title: "Home · register project",
      description:
        "Places panel의 Register project 단추가 여는 dialog. 이름, 목적, 폴더와 폴더 설명을 받는다.",
      render: () => <HomeRegister />,
    },
    {
      id: "home-new-app",
      title: "Home · new app",
      description:
        "Places panel의 New app 단추가 여는 dialog. 이름과 한 줄 목적을 받고, 만들면 그 앱 place가 앱 화면과 lophn 새 session을 붙인 split으로 열린다.",
      render: () => <HomeNewApp />,
    },
    {
      id: "home-start-failed",
      title: "Start failure · start",
      description:
        "core가 시작하지 못했을 때 Home 자리에 뜨는 화면. shell 없이 실패 종류와 다음 행동 하나만 보인다.",
      render: () => <MockDesktop core={failedCore("failed-start")} />,
    },
    {
      id: "home-sandbox-failed",
      title: "Start failure · sandbox",
      description:
        "sandbox를 세우지 못했을 때의 시작 실패 화면. start failure와 구별되는 종류 이름과 다음 행동 하나를 보인다.",
      render: () => <MockDesktop core={failedCore("failed-sandbox")} />,
    },
    {
      id: "home-schema-failed",
      title: "Start failure · schema",
      description:
        "core와 shell의 schema 판이 맞지 않을 때의 시작 실패 화면. 업데이트 확인이 다음 행동이다.",
      render: () => <MockDesktop core={failedCore("failed-schema")} />,
    },
    {
      id: "home-start-failure-cases",
      title: "Start failure · cases",
      description:
        "높은 schema, hash가 다른 이력, 손상 원본 세 경우를 나란히 놓았다. 셋 모두 원본을 그대로 두고 시작하지 않았다는 안내와 update 안내, [Try again]이 있다.",
      render: () => <StartFailures />,
    },
  ],
};
