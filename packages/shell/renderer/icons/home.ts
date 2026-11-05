import {
  Ellipsis,
  FolderOpen,
  FolderPlus,
  Info,
  type LucideIcon,
  Plus,
  X,
} from "lucide-react";

// Home의 Workspaces panel·등록 dialog·추적 미리보기가 쓰는 아이콘. 화면이 lucide를 직접 들이지 않도록 이 묶음이 고른다.
export const homeIcons = {
  register: Plus,
  addFolder: FolderPlus,
  chooseFolder: FolderOpen,
  remove: X,
  more: Ellipsis,
  details: Info,
} as const satisfies Record<string, LucideIcon>;
