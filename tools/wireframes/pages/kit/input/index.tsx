import type { Area } from "../../types.ts";
import { KitInput } from "./page.tsx";

export const inputArea: Area = {
  id: "input",
  title: "input",
  summary: "값을 받는 입력 control.",
  pages: [
    {
      id: "kit-input",
      title: "Kit · input",
      description:
        "@lophn/ui/input의 Field로 감싼 Input·Textarea·Select, Checkbox·Switch와 예제 control-sizes·orders-filters를 보인다.",
      render: () => <KitInput />,
    },
  ],
};
