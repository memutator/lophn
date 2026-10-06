import {
  AppWindow,
  FileText,
  type LucideIcon,
  PanelRight,
  SquareArrowOutUpRight,
} from "lucide-react";

// 앱 공간 바와 apps 화면이 쓰는 아이콘. 화면이 lucide를 직접 들이지 않도록 design이 고른다.
export const appSpaceIcons = {
  app: AppWindow,
  appDetails: PanelRight,
  documents: FileText,
  newWindow: SquareArrowOutUpRight,
} as const satisfies Record<string, LucideIcon>;
