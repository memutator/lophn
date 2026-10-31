// 데스크톱 shell 크롬(상단 바·런처·연결 화면)이 쓰는 Lucide 아이콘. 화면이 lucide를 직접 들이지 않도록
// 이 묶음이 고른다.
import {
  Bell,
  CircleX,
  CloudOff,
  Copy,
  FolderPlus,
  type LucideIcon,
  Minus,
  Settings,
  Square,
  X,
} from "lucide-react";

/** 상단 바 오른쪽의 알림(대기 목록) 단추. */
export const notificationsIcon: LucideIcon = Bell;
/** 런처와 작업대 바 오른쪽의 Settings 진입점. */
export const settingsEntryIcon: LucideIcon = Settings;
/** 준비하지 못한 연결. */
export const connectionFailedIcon: LucideIcon = CircleX;
/** 최신으로 확인하지 못한 연결. */
export const connectionStaleIcon: LucideIcon = CloudOff;
/** 열 것이 없는 런처. */
export const launcherEmptyIcon: LucideIcon = FolderPlus;
/** 상단 바 창 단추. */
export const windowMinimizeIcon: LucideIcon = Minus;
export const windowMaximizeIcon: LucideIcon = Square;
/** 최대화 상태에서 되돌리는 단추. */
export const windowRestoreIcon: LucideIcon = Copy;
export const windowCloseIcon: LucideIcon = X;
