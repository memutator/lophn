import type { Area } from "../../types.ts";
import { KitReading } from "./page.tsx";

export const readingArea: Area = {
  id: "reading",
  title: "reading",
  summary: "Markdown·code·diff·목차를 읽는 글로 그리는 renderer.",
  pages: [
    {
      id: "kit-reading",
      title: "Kit · reading",
      description:
        "@lophn/ui/reading의 DiffMark와 목차가 있는 읽기 틀 예제 weekly-report를 보인다.",
      render: () => <KitReading />,
    },
  ],
};
