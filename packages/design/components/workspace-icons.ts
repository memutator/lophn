import {
  AppWindow,
  Bell,
  Columns2,
  FileText,
  Folder,
  LayoutGrid,
  Library,
  type LucideIcon,
  PanelLeft,
  PanelRight,
  SquareTerminal,
  X,
} from "lucide-react";

// 프로젝트 작업대 틀이 쓰는 아이콘. 화면이 lucide를 직접 들이지 않도록 design이 고른다.
export const workspaceIcons = {
  launcher: LayoutGrid,
  sidebar: PanelLeft,
  folder: Folder,
  document: FileText,
  context: Library,
  close: X,
  splitPane: Columns2,
  infoPanel: PanelRight,
  documentEditor: FileText,
  terminal: SquareTerminal,
  appPanel: AppWindow,
  notices: Bell,
} as const satisfies Record<string, LucideIcon>;
