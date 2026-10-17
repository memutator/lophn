import type { Area } from "../../types.ts";
import { KitFeedback } from "./page.tsx";

export const feedbackArea: Area = {
  id: "feedback",
  title: "feedback",
  summary: "로딩·빈 상태·오류·상태 표시.",
  pages: [
    {
      id: "kit-feedback",
      title: "Kit · feedback",
      description:
        "@lophn/ui/feedback의 비었음·불러오기 실패·Skeleton·StaleNote·StatusMark와 읽기 결과 상태 예제 orders-status를 보인다.",
      render: () => <KitFeedback />,
    },
  ],
};
