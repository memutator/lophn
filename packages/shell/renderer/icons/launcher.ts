import {
  ChevronDown,
  ChevronRight,
  Ellipsis,
  Eye,
  Folder,
  FolderPlus,
  Info,
  type LucideIcon,
  Plus,
  RotateCw,
  SlidersHorizontal,
  TriangleAlert,
  X,
} from "lucide-react";

// 런처 카드·프로젝트 등록·추적 미리보기가 쓰는 아이콘. 화면이 lucide를 직접 들이지 않도록 이 묶음이 고른다.
export const launcherIcons = {
  project: Folder,
  register: Plus,
  addFolder: FolderPlus,
  remove: X,
  expand: ChevronRight,
  collapse: ChevronDown,
  addRule: Plus,
  editRules: SlidersHorizontal,
  preview: Eye,
  previewAgain: RotateCw,
  warning: TriangleAlert,
  more: Ellipsis,
  details: Info,
} as const satisfies Record<string, LucideIcon>;
