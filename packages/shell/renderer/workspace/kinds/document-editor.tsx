// document_editor 탭 kind. 파일 하나를 연다. 탭 key는 파일 경로이고 project 안팎 어느 파일이든
// 같다. 확장자로 viewer를 고른다(md, text, 이미지, pdf).
import { useEffect, useState } from "react";

import { workspaceIcons } from "../../icons/mod.ts";
import { DocumentView } from "../../editor/document-view.tsx";
import { fileNameOf, isInsideFolders } from "../../editor/model.ts";
import { DocumentContexts } from "../contexts/document-contexts.tsx";
import type { TabItem } from "../model.ts";
import type { DocumentRow, WorkspaceSource } from "../source.ts";
import type { TabHost } from "./host.ts";
import { openContext } from "./context.tsx";
import type { TabKindDef } from "./kind.ts";

/**
 * 파일을 탭으로 연다. 탭 key는 경로이고 이미 그 칸에 있으면 고르기만 한다. line이 있으면(검색
 * 결과) 열린 탭도 그 줄로 간다. 사이드바·팔레트·검색·대화의 결과 링크가 모두 이 함수를 부른다.
 */
export function openFile(
  host: TabHost,
  path: string,
  options: { readonly line?: number } = {},
): void {
  const fields = options.line === undefined
    ? undefined
    : { line: options.line, nonce: Date.now() };
  host.openTab({
    key: path,
    kind: "document_editor",
    title: fileNameOf(path),
    ...(fields === undefined ? {} : { fields }),
  });
  if (fields !== undefined) host.patchTab(path, { fields });
}

/** 작업대가 아직 문서 행으로 여는 곳(사이드바·팔레트)을 위한 입구. 창 정리 뒤 지운다. */
export function openDocument(host: TabHost, document: DocumentRow): void {
  openFile(host, document.id);
}

function lineOf(tab: TabItem): number | undefined {
  const line = tab.fields?.line;
  return typeof line === "number" && Number.isInteger(line) && line >= 1
    ? line
    : undefined;
}

// project에 연결한 폴더 목록. 밖의 파일인지 알려고 한 번 읽는다.
function useProjectFolders(
  source: WorkspaceSource,
  project: string,
): readonly string[] | null {
  const [folders, setFolders] = useState<readonly string[] | null>(null);
  useEffect(() => {
    let live = true;
    void source.project(project).then((read) => {
      if (live) {
        setFolders(read.ok ? read.value.folders.map((item) => item.path) : []);
      }
    });
    return () => {
      live = false;
    };
  }, [source, project]);
  return folders;
}

function FileTab({ tab, host }: { tab: TabItem; host: TabHost }) {
  const editor = host.props.editor;
  const folders = useProjectFolders(host.props.source, host.projectId);
  if (!editor) return null;
  const contexts = host.contexts;
  return (
    <DocumentView
      key={tab.key}
      path={tab.key}
      sessions={editor.sessions}
      readingWidth={editor.readingWidth}
      outside={folders !== null && !isInsideFolders(tab.key, folders)}
      line={lineOf(tab)}
      lineNonce={typeof tab.fields?.nonce === "number" ? tab.fields.nonce : 0}
      contexts={contexts === null ? undefined : (path) => (
        <DocumentContexts
          source={contexts.source}
          project={host.projectId}
          path={path}
          onOpenContext={(context) => openContext(host, context)}
        />
      )}
      onDelete={async () => {
        const reply = await editor.sessions.files.delete({ path: tab.key });
        if (reply.ok) host.removeTab(tab.key);
        return reply.ok;
      }}
      onMeta={(meta) => host.document.noteMeta(tab.key, meta)}
      initialPosition={tab.readPosition}
      onReadPosition={(position) =>
        host.document.noteReadPosition(tab.key, position)}
    />
  );
}

export const documentEditorKind: TabKindDef = {
  kind: "document_editor",
  labelKey: "project-workspace.label.kind-document-editor",
  icon: workspaceIcons.documentEditor,
  fromStored(stored, { key, position }) {
    if (stored.path !== key) return null;
    return {
      key,
      kind: "document_editor",
      title: fileNameOf(key),
      ...(position === undefined ? {} : { readPosition: position }),
    };
  },
  toStored(tab, { position }) {
    return {
      kind: "document_editor",
      key: tab.key,
      path: tab.key,
      ...(position === undefined ? {} : { read_position: position }),
    };
  },
  hint(tab) {
    return { kind: "document_editor", key: tab.key, path: tab.key };
  },
  render(tab, _active, host) {
    return <FileTab key={tab.key} tab={tab} host={host} />;
  },
  // 파일 탭은 마지막 고침을 보내고, 저장이 남으면 사람이 고른다.
  beforeClose(tab, host) {
    const sessions = host.props.editor?.sessions;
    return sessions ? sessions.leave(tab.key) : null;
  },
};
