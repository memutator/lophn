// jobs 탭 kind. 값은 core에 있어 layout에는 탭이 있다는 사실만 남는다. 어느 workspace에서든 열린다.
import { z } from "zod";

import { defineTabKind } from "./kind.ts";
import { tabKey } from "./values.ts";

const layout = z.strictObject({
  kind: z.literal("jobs"),
  key: tabKey,
});

type Layout = z.infer<typeof layout>;

export const jobsKind = defineTabKind<Layout>({
  kind: "jobs",
  layout,
  restore: (tab) => Promise.resolve({ kind: "tab", tab }),
});
