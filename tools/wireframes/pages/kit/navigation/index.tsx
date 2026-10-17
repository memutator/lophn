import type { Area } from "../../types.ts";
import { KitNavigation } from "./page.tsx";

export const navigationArea: Area = {
  id: "navigation",
  title: "navigation",
  summary: "화면 안에서 오가는 control.",
  pages: [
    {
      id: "kit-navigation",
      title: "Kit · navigation",
      description: "@lophn/ui/navigation의 Tabs를 비활성 탭과 함께 보인다.",
      render: () => <KitNavigation />,
    },
  ],
};
