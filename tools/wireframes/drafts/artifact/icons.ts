// artifact가 새로 쓰는 아이콘. 화면 task가 renderer `icons/*.ts` 묶음으로 옮긴다. Annotate는 앱 공간과 같은 editorIcons.edit다.
import { ChartColumn, FileCode, FolderX } from "lucide-react";

export const artifactIcons = {
  kind: ChartColumn,
  editSource: FileCode,
  missing: FolderX,
} as const;
