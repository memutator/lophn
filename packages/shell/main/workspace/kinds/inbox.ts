// inbox 탭 kind. 값은 core에 있어 layout에는 탭이 있다는 사실만 남는다. 어느 place에서든 열린다.
import { z } from "zod";

import { defineTabKind } from "./kind.ts";
import { tabKey } from "./values.ts";

const layout = z.strictObject({
  kind: z.literal("inbox"),
  key: tabKey,
});

type Layout = z.infer<typeof layout>;

export const inboxKind = defineTabKind<Layout>({
  kind: "inbox",
  layout,
  restore: (tab) => Promise.resolve({ kind: "tab", tab }),
});
