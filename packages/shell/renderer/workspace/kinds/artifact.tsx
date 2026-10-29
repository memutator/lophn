// artifact 탭 kind. domain의 artifact(domain, name), 사람의 폴더에 있는 .html(project, path), project의 workflow artifact
// (project, workflow, view[, instance]) 하나를 보인다. layout에는 대상만
// 남기고 title은 page가 알려 주는 대로 탭 이름에 쓴다. view는 다른 탭으로 가도 남기고 숨긴다(BrowserTab과 같다).
import { ArtifactTab } from "../../artifact/artifact-tab.tsx";
import { fileNameOf } from "../../editor/model.ts";
import { artifactIcons } from "../../icons/mod.ts";
import type { ArtifactSource } from "../../../ipc/artifact.ts";
import { openBrowserTab } from "./browser.tsx";
import { openFile } from "./document-editor.tsx";
import type { TabHost } from "./host.ts";
import type { TabKindDef } from "./kind.ts";
import type { TabItem } from "../model.ts";
import { showAfter } from "../open-policy.ts";

/** domain의 artifact를 탭으로 연다. 이미 열려 있으면 고르기만 한다. */
export function openArtifact(
  host: TabHost,
  domain: string,
  name: string,
): void {
  host.openTab({
    key: `artifact:${domain}:${name}`,
    kind: "artifact",
    title: name,
    fields: { domain, name },
  });
}

/** 사람의 폴더에 있는 .html을 탭으로 연다(절대 path). `from`은 연 탭의 key다(`showAfter`). */
export function openArtifactFile(
  host: TabHost,
  path: string,
  from?: string,
): void {
  host.openTab(
    {
      key: `artifact-file:${path}`,
      kind: "artifact",
      title: fileNameOf(path),
      fields: { project: host.projectId, path },
    },
    showAfter(host.view, from),
  );
}

/** project의 workflow artifact를 탭으로 연다. 탭 이름은 page의 title을 따른다(없으면 workflow). */
export function openWorkflowArtifact(
  host: TabHost,
  open: {
    project: string;
    workflow: string;
    view: "static" | "instance";
    instance?: string;
  },
): void {
  const { project, workflow, view } = open;
  const instance = view === "instance" ? open.instance : undefined;
  host.openTab({
    key: `artifact-workflow:${project}:${workflow}:${view}${
      instance === undefined ? "" : `:${instance}`
    }`,
    kind: "artifact",
    title: workflow,
    fields:
      instance === undefined
        ? { project, workflow, view }
        : { project, workflow, view, instance },
  });
}

// 세 꼴은 workflow 필드의 유무로 가른다(project는 file 꼴에도 있다).
function sourceFrom(
  fields: Readonly<Record<string, unknown>>,
): ArtifactSource | null {
  const { domain, name, project, path, workflow, view, instance } = fields;
  if (workflow !== undefined) {
    if (typeof project !== "string" || typeof workflow !== "string") {
      return null;
    }
    if (view === "static" && instance === undefined) {
      return { kind: "workflow", project, workflow, view };
    }
    if (view === "instance" && typeof instance === "string") {
      return { kind: "workflow", project, workflow, view, instance };
    }
    return null;
  }
  if (typeof domain === "string" && typeof name === "string") {
    return { kind: "artifact", domain, name };
  }
  if (typeof project === "string" && typeof path === "string") {
    return { kind: "file", project, path };
  }
  return null;
}

function sourceOf(tab: TabItem): ArtifactSource | null {
  return sourceFrom(tab.fields ?? {});
}

export const artifactKind: TabKindDef = {
  kind: "artifact",
  labelKey: "artifact.label.kind",
  icon: artifactIcons.kind,
  fromStored(stored, { key }) {
    const source = sourceFrom(stored);
    if (source === null) return null;
    const { kind: _kind, ...fields } = source;
    const title =
      source.kind === "artifact"
        ? source.name
        : source.kind === "file"
          ? fileNameOf(source.path)
          : source.workflow;
    return { key, kind: "artifact", title, fields };
  },
  toStored(tab) {
    const source = sourceOf(tab);
    if (source === null) return null;
    const { kind: _kind, ...fields } = source;
    return { kind: "artifact", key: tab.key, ...fields };
  },
  // 옮길 상태가 없다. 받는 창이 다시 연다.
  transfer: () => Promise.resolve({ value: null, views: [] }),
  keep(tab, shown, host) {
    const source = sourceOf(tab);
    if (source === null) return null;
    const agents = host.agentView;
    return (
      <ArtifactTab
        source={source}
        shown={shown}
        keeps={host.viewKeeps}
        keepKey={tab.key}
        onTitle={(title) => host.patchTab(tab.key, { title }, { later: true })}
        onOpenLink={(url) => openBrowserTab(host, url)}
        onEditSource={(file) => openFile(host, file, { source: true })}
        placeLophnSession={() => agents?.placeLophnSession() ?? null}
        agentName={(session) => agents?.nameOf(session)}
        onOpenSession={(session) => agents?.openSession(session)}
      />
    );
  },
};
