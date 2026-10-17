import type { Area } from "../../types.ts";
import { KitPrimitives } from "./page.tsx";

export const primitivesArea: Area = {
  id: "primitives",
  title: "primitives",
  summary: "버튼·아이콘처럼 어디서나 쓰는 작은 조각.",
  pages: [
    {
      id: "kit-primitives",
      title: "Kit · primitives",
      description:
        "@lophn/ui/primitives의 Button(variant·크기·아이콘·비활성), IconButton, Kbd, CopyButton을 실제 component로 보인다.",
      render: () => <KitPrimitives />,
    },
  ],
};
