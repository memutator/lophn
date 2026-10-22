import type { Area } from "../pages/types.ts";
import { workflowPages } from "./workflow/pages.tsx";

export const draftsArea: Area = {
  id: "experiments",
  title: "Experiments",
  summary:
    "승인 전 실험. renderer에 같은 component가 아직 없는 모양을 먼저 그려 본다.",
  pages: [...workflowPages],
};
