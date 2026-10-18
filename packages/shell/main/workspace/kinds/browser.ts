// browser 탭 kind. url만 저장하고 title과 history는 저장하지 않는다.
import { z } from "zod";

import { defineTabKind } from "./kind.ts";
import { tabKey } from "./values.ts";

const layout = z.strictObject({
  kind: z.literal("browser"),
  key: tabKey,
  // 빈 글은 빈 주소 칸으로 열린 탭이다.
  url: z.string().max(8192),
});

type BrowserLayout = z.infer<typeof layout>;
export const browserKind = defineTabKind<BrowserLayout>({
  kind: "browser",
  layout,
  // 주소는 browser view가 load할 때 검사한다.
  restore: (tab) => Promise.resolve({ kind: "tab", tab }),
});
