import {
  AppWindow,
  ArrowRightToLine,
  ChevronsDownUp,
  ClipboardCopy,
  Columns2,
  Copy,
  Dock,
  FileCheck,
  FilePlus,
  FileText,
  FileX,
  Folder,
  FolderOpen,
  FolderPlus,
  FolderSearch,
  Grid2x2X,
  ListX,
  type LucideIcon,
  PanelRight,
  Pin,
  RefreshCw,
  SquareTerminal,
  SquareX,
  Trash2,
  X,
} from "lucide-react";

// 프로젝트 작업대 틀이 쓰는 아이콘. 화면이 lucide를 직접 들이지 않도록 이 묶음이 고른다.
export const workspaceIcons = {
  folder: Folder,
  document: FileText,
  close: X,
  splitPane: Columns2,
  infoPanel: PanelRight,
  documentEditor: FileText,
  terminal: SquareTerminal,
  appPanel: AppWindow,
  // agent editor의 [Delete]와 [Upload image].
  trash: Trash2,
  // 탭 우클릭 menu.
  closeOthers: ListX,
  closePaneOthers: SquareX,
  closeGroup: Grid2x2X,
  closeRight: ArrowRightToLine,
  closeSaved: FileCheck,
  closeAll: FileX,
  copyPath: Copy,
  copyRelativePath: ClipboardCopy,
  revealInExplorer: FolderSearch,
  keepOpen: Pin,
  // Explorer 머리 단추와 tree 행의 오른쪽 클릭 menu.
  newFile: FilePlus,
  newFolder: FolderPlus,
  refresh: RefreshCw,
  collapseAll: ChevronsDownUp,
  revealInFiles: FolderOpen,
  copy: Copy,
  // floated 패널 위 bar의 [Minimize]와 [Dock].
  dock: Dock,
  // 탭 menu의 [Float]와 [Detach], floated 패널 bar의 [Detach].
  // 접힌 항목을 접기 전 자리로 되돌린다.
} as const satisfies Record<string, LucideIcon>;
