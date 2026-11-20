// document_editor 탭 kind. 파일 하나를 연다. 탭 key는 파일 경로이고 project 안팎 어느 파일이든
// 같다. 확장자로 viewer를 고른다(md, text, 이미지, pdf).
import { useEffect, useState } from "react";
import { FileIcon } from "@lophn/ui/primitives";

import { workspaceIcons } from "../../icons/mod.ts";
import { useMachineGrant } from "../../desktop/machines/context.tsx";
import { transferEditor } from "../../editor/transfer.ts";
import { DocumentView, type EditorDeps } from "../../editor/document-view.tsx";
import { fileKindOf, fileNameOf, isInsideFolders } from "../../editor/model.ts";
import type { TabItem } from "../model.ts";
import type { WorkspaceSource } from "../source.ts";
import type { TabHost } from "./host.ts";
import { openArtifactFile } from "./artifact.tsx";
import { showAfter } from "../open-policy.ts";
import type { TabKindDef } from "./kind.ts";

/** 탭의 기계 묶음에서 editor 통로를 꺼낸다. 같은 기계면 workspace 창 props를 우선 쓴다(gallery·mock 호환). */
function editorOf(tab: TabItem, host: TabHost): EditorDeps | undefined {
  const target = tab.machine ?? host.machine;
  if (target === host.machine && host.props.editor !== undefined) {
    return host.props.editor;
  }
  return host.machineData(target).editor;
}

function sourceOf(tab: TabItem, host: TabHost): WorkspaceSource {
  const target = tab.machine ?? host.machine;
  if (target === host.machine) return host.props.source;
  return host.machineData(target).workspace;
}

/**
 * 파일을 탭으로 연다. 탭 key는 경로이고 이미 열려 있으면 그 자리에서 보인다. preview면 그 칸의 preview 탭
 * 자리를 바꿔 쓰는 탭으로 연다(Explorer 한 번 클릭). line이 있으면(검색
 * 결과) 열린 탭도 그 줄로 간다. 사이드바·팔레트·검색·대화·터미널의 결과 링크가 모두 이 함수를 부른다.
 * `from`은 연 탭의 key이고 새 탭의 자리는 `showAfter`가 정한다. .html은 이 컴퓨터의 project에서만 artifact 탭으로 열고, `source`나 다른 기계면
 * 소스를 text 편집기로 연다.
 */
export function openFile(
  host: TabHost,
  path: string,
  options: {
    readonly line?: number;
    readonly preview?: boolean;
    readonly source?: boolean;
    readonly from?: string;
  } = {},
): void {
  // artifact 파일 탭은 이 컴퓨터에서만 열리므로 다른 기계나 Home에서는 html도 문서로 연다.
  if (
    fileKindOf(path) === "html" &&
    options.source !== true &&
    host.projectId !== null &&
    host.machine === null
  ) {
    openArtifactFile(host, path, options.from);
    return;
  }
  const fields =
    options.line === undefined
      ? undefined
      : { line: options.line, nonce: Date.now() };
  host.openTab(
    {
      key: path,
      kind: "document_editor",
      title: fileNameOf(path),
      ...(fields === undefined ? {} : { fields }),
      ...(options.preview === true ? { preview: true } : {}),
    },
    showAfter(host.desk, options.from),
  );
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
  project: string | null,
): readonly string[] | null {
  const [folders, setFolders] = useState<readonly string[] | null>(null);
  useEffect(() => {
    // Home에는 연결 폴더가 없어 밖의 파일이라는 구분이 없다.
    if (project === null) return;
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
  const remote = (tab.machine ?? host.machine) !== null;
  const grant = useMachineGrant(remote);
  const readOnly = remote && grant === "denied";
  const editor = editorOf(tab, host);
  const folders = useProjectFolders(sourceOf(tab, host), host.projectId);
  if (!editor) return null;
  return (
    <DocumentView
      key={tab.key}
      path={tab.key}
      sessions={editor.sessions}
      readingWidth={editor.readingWidth}
      readOnly={readOnly}
      outside={folders !== null && !isInsideFolders(tab.key, folders)}
      line={lineOf(tab)}
      lineNonce={typeof tab.fields?.nonce === "number" ? tab.fields.nonce : 0}
      onDelete={
        readOnly
          ? undefined
          : async () => {
              const reply = await editor.sessions.files.delete({
                path: tab.key,
              });
              if (reply.ok) host.removeTab(tab.key);
              return reply.ok;
            }
      }
      initialPosition={tab.readPosition}
      onReadPosition={(position) =>
        host.document.noteReadPosition(tab.key, position)
      }
    />
  );
}

export const documentEditorKind: TabKindDef = {
  kind: "document_editor",
  labelKey: "project-workspace.label.kind-document-editor",
  icon: workspaceIcons.documentEditor,
  anyWorkspace: true,
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
    const sessions = editorOf(tab, host)?.sessions;
    return sessions
      ? transferEditor(sessions, tab.key)
      : Promise.resolve({ value: null, views: [] });
  },
  render(tab, _active, host) {
    return <FileTab key={tab.key} tab={tab} host={host} />;
  },
  // 파일 탭은 마지막 고침을 보내고, 저장이 남으면 사람이 고른다.
  beforeClose(tab, host) {
    const sessions = editorOf(tab, host)?.sessions;
    return sessions ? sessions.leave(tab.key) : null;
  },
};
