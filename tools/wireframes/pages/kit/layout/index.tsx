import type { Area } from "../../types.ts";
import { KitLayout } from "./page.tsx";

export const layoutArea: Area = {
  id: "layout",
  title: "layout",
  summary: "page와 영역을 짜는 frame.",
  pages: [
    {
      id: "kit-layout",
      title: "Kit · layout",
      description:
        "@lophn/ui/layout의 Card와 페이지 틀(Form·Dashboard·ListDetail·Table·Reading), 앱 shell 예제 orders-app을 보인다.",
      render: () => <KitLayout />,
    },
  ],
};
