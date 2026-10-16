import { AppWindow, type LucideIcon, PanelRight } from "lucide-react";

// 앱 공간 바와 apps 화면이 쓰는 아이콘. 화면이 lucide를 직접 들이지 않도록 이 묶음이 고른다.
export const appSpaceIcons = {
  app: AppWindow,
  appDetails: PanelRight,
} as const satisfies Record<string, LucideIcon>;
