import { ChartColumn, FileCode, FolderX, type LucideIcon } from "lucide-react";

// artifact 탭이 쓰는 아이콘. Annotate는 앱 공간과 같은 editorIcons.edit다.
export const artifactIcons = {
  kind: ChartColumn,
  editSource: FileCode,
  missing: FolderX,
} as const satisfies Record<string, LucideIcon>;
