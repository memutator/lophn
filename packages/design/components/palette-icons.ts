import {
  AppWindow,
  File,
  FileText,
  FolderKanban,
  LayoutGrid,
  Library,
  type LucideIcon,
  PanelRight,
  PanelsTopLeft,
  Search,
  SquareArrowOutUpRight,
  SquareTerminal,
} from "lucide-react";

// 명령 팔레트 행 앞의 아이콘. 화면이 lucide를 직접 들이지 않도록 design이 고른다.
export const paletteIcons = {
  tab: PanelsTopLeft,
  document: FileText,
  file: File,
  context: Library,
  project: FolderKanban,
  app: AppWindow,
  launcher: LayoutGrid,
  screen: SquareArrowOutUpRight,
  terminal: SquareTerminal,
  panel: PanelRight,
  search: Search,
} as const satisfies Record<string, LucideIcon>;
