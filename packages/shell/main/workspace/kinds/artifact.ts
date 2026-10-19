// artifact 탭 kind. domain의 artifact(domain, name) 또는 사람의 폴더에 있는 .html(project, path) 하나를 연다. 둘 중 정확히 하나다.
import { z } from "zod";

import { artifactNameSchema } from "../../../ipc/artifact.ts";
import { defineTabKind } from "./kind.ts";
import { idOf, tabKey } from "./values.ts";

const layout = z.strictObject({
  kind: z.literal("artifact"),
  key: tabKey,
  domain: z.string().refine((value) => idOf("dom", value) !== null).optional(),
  name: artifactNameSchema.optional(),
  project: z.string().refine((value) => idOf("prj", value) !== null).optional(),
  path: z.string().min(1).max(4096).optional(),
}).refine(
  (tab) =>
    tab.domain !== undefined && tab.name !== undefined &&
      tab.project === undefined && tab.path === undefined ||
    tab.project !== undefined && tab.path !== undefined &&
      tab.domain === undefined && tab.name === undefined,
  { message: "exactly one of (domain, name) and (project, path)" },
);

type ArtifactLayout = z.infer<typeof layout>;
export const artifactKind = defineTabKind<ArtifactLayout>({
  kind: "artifact",
  layout,
  // 폴더가 없어진 탭도 지킨다. 탭이 열릴 때 "없음" 안내와 [Retry]가 보인다.
  restore: (tab) => Promise.resolve({ kind: "tab", tab }),
});
