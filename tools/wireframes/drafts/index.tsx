import type { Area } from "../pages/types.ts";
import { ContextWays } from "./ways-page.tsx";

export const draftsArea: Area = {
  id: "experiments",
  title: "Experiments",
  summary:
    "승인 전 실험. renderer에 같은 component가 아직 없는 모양을 먼저 그려 본다.",
  pages: [
    {
      id: "new-ways-to-open",
      title: "Context · ways to open",
      description:
        "Context 탭을 여는 길 여덟을 한 장에 모았다. 길마다 try it을 누르면 그 길을 눌러 볼 수 있는 page로 간다.",
      render: () => <ContextWays />,
    },
  ],
};
