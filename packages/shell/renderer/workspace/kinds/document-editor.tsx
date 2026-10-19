// document_editor 탭 kind. 파일 하나를 연다. 탭 key는 파일 경로이고 project 안팎 어느 파일이든
// 같다. 확장자로 viewer를 고른다(md, text, 이미지, pdf).
import { useEffect, useState } from "react";
import { FileIcon } from "@lophn/ui/primitives";

import { workspaceIcons } from "../../icons/mod.ts";
import { transferEditor } from "../../editor/transfer.ts";
import { DocumentView } from "../../editor/document-view.tsx";
import { fileKindOf, fileNameOf, isInsideFolders } from "../../editor/model.ts";
import type { TabItem } from "../model.ts";
import type { WorkspaceSource } from "../source.ts";
import type { TabHost } from "./host.ts";
import { openArtifactFile } from "./artifact.tsx";
import type { TabKindDef } from "./kind.ts";

/**
 * 파일을 탭으로 연다. 탭 key는 경로이고 이미 그 칸에 있으면 고르기만 한다. preview면 그 칸의 preview 탭
 * 자리를 바꿔 쓰는 탭으로 연다(Explorer 한 번 클릭). line이 있으면(검색
 * 결과) 열린 탭도 그 줄로 간다. 사이드바·팔레트·검색·대화의 결과 링크가 모두 이 함수를 부른다.
 * .html은 artifact 탭으로 열고, `source`면 소스를 text 편집기로 연다.
 */
export function openFile(
  host: TabHost,
  path: string,
  options: {
    readonly line?: number;
    readonly preview?: boolean;
    readonly source?: boolean;
  } = {},
): void {
  if (fileKindOf(path) === "html" && options.source !== true) {
    openArtifactFile(host, path);
    return;
  }
  const fields = options.line === undefined
    ? undefined
    : { line: options.line, nonce: Date.now() };
  host.openTab({
    key: path,
    kind: "document_editor",
    title: fileNameOf(path),
    ...(fields === undefined ? {} : { fields }),
    ...(options.preview === true ? { preview: true } : {}),
  });
  if (fields !== undefined) host.patchTab(path, { fields });
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
  return (
    <DocumentView
      key={tab.key}
      path={tab.key}
      sessions={editor.sessions}
      readingWidth={editor.readingWidth}
      outside={folders !== null && !isInsideFolders(tab.key, folders)}
      line={lineOf(tab)}
      lineNonce={typeof tab.fields?.nonce === "number" ? tab.fields.nonce : 0}
      onDelete={async () => {
        const reply = await editor.sessions.files.delete({ path: tab.key });
        if (reply.ok) host.removeTab(tab.key);
        return reply.ok;
      }}
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
  iconOf: (tab) => <FileIcon name={tab.title} size={14} />,
  pathOf: (tab) => tab.key,
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
  // 받는 창은 디스크에서 다시 연다. 마지막 고침이 디스크에 닿지 않으면 옮기지 않는다.
  transfer(tab, host) {
    const sessions = host.props.editor?.sessions;
    return sessions
      ? transferEditor(sessions, tab.key)
      : Promise.resolve({ value: null, views: [] });
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
