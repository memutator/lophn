// document_editor 탭 kind. 문서 하나를 편집기로 연다(shell/workspace#R1, R7).
import { z } from "zod";

import { defineTabKind } from "./kind.ts";
import { documentId, idOf, readPositionSchema, tabKey } from "./values.ts";

const layout = z.strictObject({
  kind: z.literal("document_editor"),
  key: tabKey,
  document: documentId,
  read_position: readPositionSchema.optional(),
});

export type DocumentEditorLayout = z.infer<typeof layout>;
export type DocumentEditorHint = {
  kind: "document_editor";
  key: string;
  document: string;
};
export type DocumentEditorView = {
  kind: "document_editor";
  key: string;
  document: string;
  selected: boolean;
};

export const documentEditorKind = defineTabKind<
  DocumentEditorLayout,
  DocumentEditorHint,
  DocumentEditorView
>({
  kind: "document_editor",
  layout,
  readPosition: (tab) => tab.read_position,
  async restore(tab, targets) {
    if (!(await targets.canRead(tab.document))) {
      return {
        kind: "placeholder",
        key: tab.key,
        origin: tab.kind,
        title: tab.document,
        reason: "no_permission",
      };
    }
    if (!(await targets.documentExists(tab.document))) {
      return {
        kind: "placeholder",
        key: tab.key,
        origin: tab.kind,
        title: tab.document,
        reason: "document_missing",
      };
    }
    return { kind: "tab", tab };
  },
  hint(raw, key) {
    const document = idOf("doc", raw.document);
    if (document === null) return null;
    return { kind: "document_editor", key, document };
  },
  scope(hint, reads) {
    reads.allow("document", hint.document, "documents", {
      document: hint.document,
    });
  },
  view(hint, selected, ctx) {
    if (!ctx.refOk(hint.key) || !ctx.refOk(hint.document)) return null;
    if (!ctx.scope.allows("document", hint.document)) return null;
    return {
      kind: hint.kind,
      key: hint.key,
      document: hint.document,
      selected,
    };
  },
  describe: (view) => view.document,
});
