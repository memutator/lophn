// artifact 탭 kind. domain의 artifact(domain, name) 또는 사람의 폴더에 있는 .html(project, path) 하나를 보인다. layout에는 대상만
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

/** 사람의 폴더에 있는 .html을 탭으로 연다(절대 path). */
export function openArtifactFile(host: TabHost, path: string): void {
  host.openTab({
    key: `artifact-file:${path}`,
    kind: "artifact",
    title: fileNameOf(path),
    fields: { project: host.projectId, path },
  });
}

function sourceOf(tab: TabItem): ArtifactSource | null {
  const { domain, name, project, path } = tab.fields ?? {};
  if (typeof domain === "string" && typeof name === "string") {
    return { kind: "artifact", domain, name };
  }
  if (typeof project === "string" && typeof path === "string") {
    return { kind: "file", project, path };
  }
  return null;
}

export const artifactKind: TabKindDef = {
  kind: "artifact",
  labelKey: "artifact.label.kind",
  icon: artifactIcons.kind,
  fromStored(stored, { key }) {
    const { domain, name, project, path } = stored;
    if (typeof domain === "string" && typeof name === "string") {
      return { key, kind: "artifact", title: name, fields: { domain, name } };
    }
    if (typeof project === "string" && typeof path === "string") {
      return {
        key,
        kind: "artifact",
        title: fileNameOf(path),
        fields: { project, path },
      };
    }
    return null;
  },
  toStored(tab) {
    const source = sourceOf(tab);
    if (source === null) return null;
    return source.kind === "artifact"
      ? {
        kind: "artifact",
        key: tab.key,
        domain: source.domain,
        name: source.name,
      }
      : {
        kind: "artifact",
        key: tab.key,
        project: source.project,
        path: source.path,
      };
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
        projectManagerSession={() => agents?.projectManagerSession() ?? null}
        agentName={(session) => agents?.nameOf(session)}
        onOpenSession={(session) => agents?.openSession(session)}
      />
    );
  },
};
