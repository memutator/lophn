import type { Area } from "../../types.ts";
import { KitOverlay } from "./page.tsx";

export const overlayArea: Area = {
  id: "overlay",
  title: "overlay",
  summary: "화면 위에 뜨는 component.",
  pages: [
    {
      id: "kit-overlay",
      title: "Kit · overlay",
      description:
        "@lophn/ui/overlay의 Menu·Popover·Tooltip·Dialog·Sheet·Palette·Toast를 열어 둔 채로 보이고, 예제 overlays를 연다.",
      render: () => <KitOverlay />,
    },
  ],
};
