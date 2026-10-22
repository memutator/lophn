// workflow 탭 kind. project의 workflow 하나(이름)와 그 안에서 고른 instance를 보인다.
// layout 파일은 이름과 고른 instance만 기억한다. workflow가 지워졌는지는 탭이 열릴 때 목록을 읽어 보인다.
import { z } from "zod";

import { workflowNameSchema } from "../../../ipc/artifact.ts";
import { defineTabKind } from "./kind.ts";
import { idOf, tabKey } from "./values.ts";

const layout = z.strictObject({
  kind: z.literal("workflow"),
  key: tabKey,
  workflow: workflowNameSchema,
  instance: z.string().refine((value) => idOf("wfi", value) !== null)
    .optional(),
});

type WorkflowLayout = z.infer<typeof layout>;

export const workflowKind = defineTabKind<WorkflowLayout>({
  kind: "workflow",
  layout,
  restore: (tab) => Promise.resolve({ kind: "tab", tab }),
});
