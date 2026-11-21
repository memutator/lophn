// browser 탭 kind. url·favicon·browser profile만 저장하고 title과 history는 저장하지 않는다.
import { z } from "zod";

import { browserProfileIdSchema } from "../../../../protocol/shell/browser-profiles.ts";

import { defineTabKind } from "./kind.ts";
import { tabKey } from "./values.ts";

const layout = z.strictObject({
  kind: z.literal("browser"),
  key: tabKey,
  // 빈 글은 빈 주소 칸으로 열린 탭이다.
  url: z.string().max(8192),
  // 접힌 탭은 다시 열어도 mount되지 않아 page가 favicon을 다시 알릴 길이 없다. main이 만든 data URL만 받는다.
  favicon: z
    .string()
    .max(65536)
    .regex(/^data:image\//)
    .optional(),
  // 사람이 켠 Keep alive. 선택 필드라 없는 옛 파일은 꺼진 것이다.
  keep_alive: z.literal(true).optional(),
  // 탭의 browser profile. 없으면 기본 profile이다. 정해지면 바뀌지 않는다.
  profile: browserProfileIdSchema.optional(),
});

type BrowserLayout = z.infer<typeof layout>;
export const browserKind = defineTabKind<BrowserLayout>({
  kind: "browser",
  layout,
  // 주소는 browser view가 load할 때 검사한다.
  restore: (tab) => Promise.resolve({ kind: "tab", tab }),
});
