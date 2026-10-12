// document_editor 탭 kind. 문서 하나를 편집기로 읽고 고친다(shell/workspace#R1, R6, R7, R9).
import { workspaceIcons } from "@lophn/design/components";

import { DocumentView } from "../../editor/document-view.tsx";
import type { DocumentRow } from "../source.ts";
import type { TabHost } from "./host.ts";
import type { TabKindDef } from "./kind.ts";

const DOC_ID = /^doc_[0-7][0-9a-hjkmnp-tv-z]{25}$/;

/**
 * 문서를 탭으로 연다. 탭 key는 문서 ID이고 이미 그 칸에 있으면 고르기만 한다. 사이드바·팔레트·
 * 대화의 결과 링크가 모두 이 함수를 부른다.
 */
export function openDocument(host: TabHost, document: DocumentRow): void {
  host.openTab({
    key: document.id,
    kind: "document_editor",
    title: host.document.fileName(document.id) ?? document.title,
  });
}

export const documentEditorKind: TabKindDef = {
  kind: "document_editor",
  labelKey: "project-workspace.label.kind-document-editor",
  icon: workspaceIcons.documentEditor,
  fromStored(stored, { key, position }) {
    if (stored.document !== key || !DOC_ID.test(key)) return null;
    return {
      key,
      kind: "document_editor",
      title: "",
      ...(position === undefined ? {} : { readPosition: position }),
    };
  },
  toStored(tab, { position }) {
    if (!DOC_ID.test(tab.key)) return null;
    return {
      kind: "document_editor",
      key: tab.key,
      document: tab.key,
      ...(position === undefined ? {} : { read_position: position }),
    };
  },
  // 판을 아직 모르는 문서 탭은 뺀다. 열지 못한 문서를 열린 탭으로 알리지 않는다.
  hint(tab, ctx) {
    const shown = ctx.presentation[tab.key];
    if (shown === undefined || shown.version === "") return null;
    return { kind: "document_editor", key: tab.key, document: tab.key };
  },
  pending(tab, ctx) {
    const shown = ctx.presentation[tab.key];
    return shown === undefined || shown.version === "";
  },
  render(tab, _active, host) {
    const editor = host.props.editor;
    if (!editor) return null;
    return (
      <DocumentView
        key={tab.key}
        documentId={tab.key}
        projectId={host.projectId}
        source={editor.source}
        core={editor.core}
        readingWidth={editor.readingWidth}
        menu={editor.menu}
        files={editor.files}
        infoOpen={host.document.infoShown}
        onToggleInfo={host.document.toggleInfo}
        versions={editor.versions}
        compare={host.document.compareOf(tab.key)}
        onCompare={(target) => host.document.showCompare(tab.key, target)}
        onVersionsChanged={host.document.versionsChanged}
        onMeta={(meta) => host.document.noteMeta(tab.key, meta)}
        onPresentation={(shown) =>
          host.document.notePresentation(tab.key, shown)}
        initialPosition={tab.readPosition}
        onReadPosition={(position) =>
          host.document.noteReadPosition(tab.key, position)}
        onOpenDocument={(id) => {
          const row = host.document.rows.find((item) => item.id === id);
          openDocument(
            host,
            row ?? { id, title: host.document.fileName(id) ?? id },
          );
        }}
      />
    );
  },
  // 문서 탭은 마지막 고침을 보내 편집을 끝내고, 저장이 남으면 사람이 고른다(editor#R1).
  beforeClose(tab, host) {
    const files = host.props.editor?.files;
    return files ? files.leave(tab.key) : null;
  },
};
