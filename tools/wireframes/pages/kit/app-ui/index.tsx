import type { Area } from "../../types.ts";
import { KitAppUi } from "./page.tsx";

export const appUiArea: Area = {
  id: "app-ui",
  title: "app-ui",
  summary: "앱 선언의 tool을 버튼으로 두는 @lophn/app-ui 예제.",
  pages: [
    {
      id: "kit-app-ui",
      title: "Kit · app-ui",
      description:
        "@lophn/app-ui 예제 order-actions. 앱 선언의 tool을 버튼으로 두고 누르면 바로 호출한다. 앱 bridge가 없어 눌러도 실패 문구가 나온다.",
      render: () => <KitAppUi />,
    },
  ],
};
