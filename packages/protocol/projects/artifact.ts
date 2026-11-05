// artifact의 공통 값과 순수 함수. shell main(목록), core(prompt의 목록), renderer(대화 글의 link)가
// 같은 규칙을 써야 하므로 protocol에 둔다. shell main(node test, noUncheckedIndexedAccess tsc)도 import하므로
// import를 두지 않는다. 이름 schema는 projects/values.ts의 artifactNameSchema다.

// artifact는 그릇(project나 앱)의 data 자리 아래 `artifacts/<name>/`이고 입구는 `index.html`이다.
export const ARTIFACT_ENTRY = "index.html";
export const ARTIFACTS_FOLDER = "artifacts";

// artifact를 담는 그릇. `Workspace`의 project·앱 쪽과 같은 모양이다.
export type ArtifactWorkspace = { kind: "project" | "app"; id: string };

// data root 아래 상대 자리. path 조각을 찾을 때도 같은 글을 쓴다.
function relativeFolder(workspace: ArtifactWorkspace): string {
  return `${workspace.kind === "project" ? "projects" : "apps"}/${workspace.id}/${ARTIFACTS_FOLDER}`;
}

export function artifactsFolder(
  dataRoot: string,
  workspace: ArtifactWorkspace,
): string {
  return `${dataRoot}/${relativeFolder(workspace)}`;
}

// 신원 `{project, name}`이나 `{app, name}`에서 그릇을 꺼낸다.
export function artifactWorkspaceOf(
  ref:
    | {
        project: string;
      }
    | { app: string },
): ArtifactWorkspace {
  return "app" in ref
    ? { kind: "app", id: ref.app }
    : { kind: "project", id: ref.project };
}

export type ArtifactMeta = { title: string; description: string };

// prompt에 싣는 글이라 상한이 있다.
const TITLE_MAX = 120;
const DESCRIPTION_MAX = 300;

function clean(raw: string, max: number): string {
  return raw
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&") // 마지막이어야 `&amp;lt;`가 두 번 풀리지 않는다.
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function attr(tag: string, name: string): string | null {
  const m = new RegExp(
    `(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`,
    "i",
  ).exec(tag);
  return m ? (m[1] ?? m[2] ?? null) : null;
}

// 호출하는 쪽이 HTML 앞쪽만 넘긴다. 제목과 설명은 HTML에서 읽는다.
export function parseArtifactMeta(
  html: string,
  fallbackTitle: string,
): ArtifactMeta {
  const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  const title = titleMatch ? clean(titleMatch[1] ?? "", TITLE_MAX) : "";
  let description = "";
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    if (attr(tag, "name")?.trim().toLowerCase() === "description") {
      description = clean(attr(tag, "content") ?? "", DESCRIPTION_MAX);
      break;
    }
  }
  return { title: title || fallbackTitle, description };
}

export type ArtifactMention = { start: number; end: number; name: string };

const FRAGMENT = /[^\s"'`()]+/g;
const TRAILING_PUNCTUATION = /[.,;:!?]+$/;

// 대화 글에서 이 그릇의 아는 artifact를 가리키는 `…/projects/<prj>/artifacts/<name>` 또는 `…/apps/<app>/artifacts/<name>`
// path 조각의 위치.
export function artifactMentions(
  text: string,
  workspace: ArtifactWorkspace,
  known: readonly string[],
): ArtifactMention[] {
  const prefix = `${relativeFolder(workspace)}/`;
  const mentions: ArtifactMention[] = [];
  for (const match of text.matchAll(FRAGMENT)) {
    const fragment = match[0].replace(TRAILING_PUNCTUATION, "");
    for (let i = 0; i < fragment.length; i++) {
      if (i > 0 && fragment[i - 1] !== "/") continue;
      if (!fragment.startsWith(prefix, i)) continue;
      const nameFrom = i + prefix.length;
      const slash = fragment.indexOf("/", nameFrom);
      const name = fragment.slice(nameFrom, slash < 0 ? undefined : slash);
      if (!known.includes(name)) continue;
      mentions.push({
        start: match.index,
        end: match.index + fragment.length,
        name,
      });
      break;
    }
  }
  return mentions;
}
