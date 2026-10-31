import {
  AppWindow,
  File,
  FileText,
  FolderKanban,
  LayoutGrid,
  type LucideIcon,
  PanelRight,
  PanelsTopLeft,
  Search,
  SquareArrowOutUpRight,
  SquareTerminal,
  Star,
} from "lucide-react";

// 명령 팔레트 행 앞의 아이콘. 화면이 lucide를 직접 들이지 않도록 이 묶음이 고른다.
export const paletteIcons = {
  tab: PanelsTopLeft,
  document: FileText,
  file: File,
  project: FolderKanban,
  app: AppWindow,
  home: LayoutGrid,
  screen: SquareArrowOutUpRight,
  terminal: SquareTerminal,
  panel: PanelRight,
  bookmark: Star,
  search: Search,
} as const satisfies Record<string, LucideIcon>;
