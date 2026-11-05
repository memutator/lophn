import {
  ChevronLeft,
  ChevronRight,
  FolderOpen,
  House,
  type LucideIcon,
} from "lucide-react";

// 왼쪽 sidebar의 workspace 줄(Home, project)과 Recent 접기·page 화살표. 나머지 아이콘은 shellIcons를 쓴다.
export const sidebarIcons = {
  home: House,
  project: FolderOpen,
  collapsed: ChevronRight,
  previous: ChevronLeft,
  next: ChevronRight,
} as const satisfies Record<string, LucideIcon>;
