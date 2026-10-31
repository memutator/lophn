// project settings 탭 kind. 이름·폴더·고정 앱 패널을 고치는 화면이고 project 창에 하나다.
// 값은 모두 project 등록에 있어 layout에는 탭이 있다는 사실만 남는다.
import { z } from "zod";

import { defineTabKind } from "./kind.ts";
import { tabKey } from "./values.ts";

const layout = z.strictObject({
  kind: z.literal("project_settings"),
  key: tabKey,
});

type ProjectSettingsLayout = z.infer<typeof layout>;

export const projectSettingsKind = defineTabKind<ProjectSettingsLayout>({
  kind: "project_settings",
  layout,
  restore: (tab) => Promise.resolve({ kind: "tab", tab }),
});
