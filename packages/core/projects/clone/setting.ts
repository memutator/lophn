import { z } from "zod";
import { declareSetting } from "../../../protocol/config/mod.ts";
import { absolutePathSchema } from "../../../protocol/projects/mod.ts";

// 폴더는 처음 clone할 때 사람에게 한 번 묻고 여기에 둔다. 비어 있으면 아직 묻지 않은 것이다.
export const projectsFolderSetting = declareSetting({
  key: "projects.folder",
  type: z.union([z.literal(""), absolutePathSchema]),
  default: "",
  description:
    "The folder where lophn puts projects it clones on this computer. lophn asks the first time it clones a project.",
  locked: true,
});
