import type { Area } from "../pages/types.ts";
// jobs-screen
import { jobsScreenPages } from "./jobs-screen/pages.tsx";
// jobs-origin
import { jobsOriginPages } from "./jobs-origin/pages.tsx";

export const draftsArea: Area = {
  id: "experiments",
  title: "Experiments",
  summary:
    "승인 전 실험. renderer에 같은 component가 아직 없는 모양을 먼저 그려 본다.",
  pages: [
    // jobs-screen
    ...jobsScreenPages,
    // jobs-origin
    ...jobsOriginPages,
  ],
};
