import {
  AppWindow,
  type LucideIcon,
  Maximize2,
  Minimize2,
  PanelRight,
} from "lucide-react";

// 앱 공간 바와 apps 화면이 쓰는 아이콘. 화면이 lucide를 직접 들이지 않도록 이 묶음이 고른다.
export const appSpaceIcons = {
  app: AppWindow,
  appDetails: PanelRight,
  // 오른쪽 패널의 전체 모드와 그 해제.
  panelFull: Maximize2,
  panelRestore: Minimize2,
} as const satisfies Record<string, LucideIcon>;
