// artifact 탭 kind. domain의 artifact(domain, name), 사람의 폴더에 있는 .html(project, path), project의 workflow artifact
// (project, workflow, view[, instance]) 하나를 연다. 셋 중 정확히 하나다. instance는 view가 instance일 때만 있고 그때는 꼭 있다.
import { z } from "zod";

import {
  artifactNameSchema,
  workflowNameSchema,
} from "../../../ipc/artifact.ts";
import { defineTabKind } from "./kind.ts";
import { idOf, tabKey } from "./values.ts";

const layout = z.strictObject({
  kind: z.literal("artifact"),
  key: tabKey,
  domain: z.string().refine((value) => idOf("dom", value) !== null).optional(),
  name: artifactNameSchema.optional(),
  project: z.string().refine((value) => idOf("prj", value) !== null).optional(),
  path: z.string().min(1).max(4096).optional(),
  workflow: workflowNameSchema.optional(),
  view: z.enum(["static", "instance"]).optional(),
  instance: z.string().refine((value) => idOf("wfi", value) !== null)
    .optional(),
}).refine(
  (tab) => {
    const artifact = tab.domain !== undefined && tab.name !== undefined &&
      tab.project === undefined && tab.path === undefined &&
      tab.workflow === undefined && tab.view === undefined &&
      tab.instance === undefined;
    const file = tab.project !== undefined && tab.path !== undefined &&
      tab.domain === undefined && tab.name === undefined &&
      tab.workflow === undefined && tab.view === undefined &&
      tab.instance === undefined;
    const workflow = tab.project !== undefined && tab.workflow !== undefined &&
      tab.view !== undefined &&
      tab.path === undefined && tab.domain === undefined &&
      tab.name === undefined &&
      (tab.view === "instance") === (tab.instance !== undefined);
    return artifact || file || workflow;
  },
  {
    message:
      "exactly one of (domain, name), (project, path) and (project, workflow, view[, instance])",
  },
);

type ArtifactLayout = z.infer<typeof layout>;
export const artifactKind = defineTabKind<ArtifactLayout>({
  kind: "artifact",
  layout,
  // 폴더가 없어진 탭도 지킨다. 탭이 열릴 때 "없음" 안내와 [Retry]가 보인다.
  restore: (tab) => Promise.resolve({ kind: "tab", tab }),
});
