// document_editor 탭 kind. 파일 하나를 편집기로 연다. 대상은 절대 경로다.
import { z } from "zod";

import { defineTabKind } from "./kind.ts";
import { readPositionSchema, tabKey } from "./values.ts";

const layout = z.strictObject({
  kind: z.literal("document_editor"),
  key: tabKey,
  path: z.string().min(1).max(4096),
  read_position: readPositionSchema.optional(),
});

type DocumentEditorLayout = z.infer<typeof layout>;

export const documentEditorKind = defineTabKind<DocumentEditorLayout>({
  kind: "document_editor",
  layout,
  readPosition: (tab) => tab.read_position,
  // 지워진 파일도 탭을 지킨다. 탭이 열릴 때 "없음" 안내를 보인다.
  restore: (tab) => Promise.resolve({ kind: "tab", tab }),
});
