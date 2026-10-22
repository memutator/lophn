import type { Area } from "../pages/types.ts";
// jobs-origin
import { jobsOriginPages } from "./jobs-origin/pages.tsx";
// jobs-sidebar
import { jobsSidebarPages } from "./jobs-sidebar/pages.tsx";

export const draftsArea: Area = {
  id: "experiments",
  title: "Experiments",
  summary:
    "승인 전 실험. renderer에 같은 component가 아직 없는 모양을 먼저 그려 본다.",
  pages: [
    // jobs-origin
    ...jobsOriginPages,
    // jobs-sidebar
    ...jobsSidebarPages,
  ],
};
