import type { Area } from "../../types.ts";
import { KitData } from "./page.tsx";

export const dataArea: Area = {
  id: "data",
  title: "data",
  summary: "표·목록·트리·차트처럼 data를 보이는 component.",
  pages: [
    {
      id: "kit-data",
      title: "Kit · data",
      description:
        "@lophn/ui/data의 Tree·List·Table·StatTile·StatRow와 예제 orders-table·orders-summary·sales-dashboard를 보인다.",
      render: () => <KitData />,
    },
  ],
};
