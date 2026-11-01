// project settings 탭 kind. 이름·폴더·빠른 실행을 고치는 화면이고 project 창에 하나다.
// 값은 project 등록과 layout의 `quick`에 있어 탭은 열려 있다는 사실만 남는다.
import { z } from "zod";

import { defineTabKind } from "./kind.ts";
import { tabKey } from "./values.ts";

const layout = z.strictObject({
  kind: z.literal("project_settings"),
  key: tabKey,
});

type Layout = z.infer<typeof layout>;

export const projectSettingsKind = defineTabKind<Layout>({
  kind: "project_settings",
  layout,
  restore: (tab) => Promise.resolve({ kind: "tab", tab }),
});
