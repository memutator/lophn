// app detail 탭 kind. 앱 workspace의 앱 상세(Icon, Folders, Version·Access·Activity)이고 앱 workspace에 하나다.
// 앱은 workspace가 정하고 값은 core에 있어 탭은 열려 있다는 사실만 남는다.
import { z } from "zod";

import { defineTabKind } from "./kind.ts";
import { tabKey } from "./values.ts";

const layout = z.strictObject({
  kind: z.literal("app_detail"),
  key: tabKey,
});

type Layout = z.infer<typeof layout>;

export const appDetailKind = defineTabKind<Layout>({
  kind: "app_detail",
  layout,
  restore: (tab) => Promise.resolve({ kind: "tab", tab }),
});
