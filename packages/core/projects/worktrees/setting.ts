import { z } from "zod";
import { declareSetting } from "../../../protocol/config/mod.ts";
import { absolutePathSchema } from "../../../protocol/projects/mod.ts";

// 관리되는 git worktree의 기본 루트 폴더다. 비어 있으면 `<data>/worktrees`를 쓴다.
// 홈 디렉터리·파일시스템 루트·저장소 내부·저장소 상위 디렉터리는 실행 시 거절한다.
export const projectsWorktreesFolderSetting = declareSetting({
  key: "projects.worktrees_folder",
  type: z.union([z.literal(""), absolutePathSchema]),
  default: "",
  description:
    "The root folder where lophn creates managed git worktrees on this computer. Empty uses <data>/worktrees.",
  locked: true,
});
