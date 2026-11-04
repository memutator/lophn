// artifact 탭 kind. project나 앱의 artifact(project·app 가운데 하나와 name), 사람의 폴더에 있는 .html(project, path),
// project의 workflow artifact(project, workflow, view[, instance]) 하나를 연다. 넷 중 정확히 하나다.
// instance는 view가 instance일 때만 있고 그때는 꼭 있다.
import { z } from "zod";

import {
  artifactNameSchema,
  workflowNameSchema,
} from "../../../ipc/artifact.ts";
import { defineTabKind } from "./kind.ts";
import { idOf, tabKey } from "./values.ts";

const FIELDS = [
  "project",
  "app",
  "name",
  "path",
  "workflow",
  "view",
  "instance",
] as const;

const layout = z
  .strictObject({
    kind: z.literal("artifact"),
    key: tabKey,
    project: z
      .string()
      .refine((value) => idOf("prj", value) !== null)
      .optional(),
    app: z
      .string()
      .refine((value) => idOf("app", value) !== null)
      .optional(),
    name: artifactNameSchema.optional(),
    path: z.string().min(1).max(4096).optional(),
    workflow: workflowNameSchema.optional(),
    view: z.enum(["static", "instance"]).optional(),
    instance: z
      .string()
      .refine((value) => idOf("wfi", value) !== null)
      .optional(),
  })
  .refine(
    (tab) => {
      const shape = FIELDS.filter((field) => tab[field] !== undefined).join();
      return (
        shape === "project,name" ||
        shape === "app,name" ||
        shape === "project,path" ||
        (shape === "project,workflow,view" && tab.view === "static") ||
        (shape === "project,workflow,view,instance" && tab.view === "instance")
      );
    },
    {
      message:
        "exactly one of (project|app, name), (project, path) and (project, workflow, view[, instance])",
    },
  );

type ArtifactLayout = z.infer<typeof layout>;
export const artifactKind = defineTabKind<ArtifactLayout>({
  kind: "artifact",
  layout,
  // 폴더가 없어진 탭도 지킨다. 탭이 열릴 때 "없음" 안내와 [Retry]가 보인다.
  restore: (tab) => Promise.resolve({ kind: "tab", tab }),
});
