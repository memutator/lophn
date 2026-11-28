import { homedir } from "node:os";
import { z } from "zod";
import { declareSetting } from "../../../protocol/config/mod.ts";
import { absolutePathSchema } from "../../../protocol/projects/mod.ts";
import { validateWorktreesRoot } from "./paths.ts";

// 관리되는 git worktree의 기본 루트 폴더다. 비어 있으면 `<data>/worktrees`를 쓴다.
// 파일시스템 루트와 홈 디렉터리(및 그 상위)는 저장할 때 거절한다. 저장소 내부·상위는 project마다 달라 만들 때 거절한다.
export const projectsWorktreesFolderSetting = declareSetting({
  key: "projects.worktrees_folder",
  type: z.union([z.literal(""), absolutePathSchema]),
  default: "",
  description:
    "The root folder where lophn creates managed git worktrees on this computer. Empty uses <data>/worktrees.",
  locked: true,
  check: (value) => {
    if (value === "") return [];
    const checked = validateWorktreesRoot(value, { homeDir: homedir() });
    return checked.ok
      ? []
      : [{ level: "reject", message: checked.error.message }];
  },
});
