// 데스크톱 shell 크롬(상단 바·런처·연결 화면)이 쓰는 Lucide 아이콘. 화면이 lucide를 직접 들이지 않도록
// design이 고른다(shell/design-system#R43).
import {
  CircleX,
  CloudOff,
  FolderPlus,
  type LucideIcon,
  RotateCw,
  Settings2,
} from "lucide-react";

/** 런처 바 오른쪽의 lophn 관리 진입점. */
export const lophnEntryIcon: LucideIcon = Settings2;
/** 연결 실패·단절에서 다시 시도·다시 연결. */
export const retryIcon: LucideIcon = RotateCw;
/** 준비하지 못한 연결. */
export const connectionFailedIcon: LucideIcon = CircleX;
/** 최신으로 확인하지 못한 연결. */
export const connectionStaleIcon: LucideIcon = CloudOff;
/** 열 것이 없는 런처. */
export const launcherEmptyIcon: LucideIcon = FolderPlus;
