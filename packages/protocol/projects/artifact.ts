// artifact의 공통 값과 순수 함수. shell main(목록), core(prompt의 목록), renderer(대화 글의 link)가
// 같은 규칙을 써야 하므로 protocol에 둔다. 의존성·IO가 없다.

import { slugSchema } from "./values.ts";

// artifact는 project 폴더 아래 `artifacts/<name>/index.html` 하나와 선택적인 `data/_entries.json`이다.
export const ARTIFACTS_FOLDER = "artifacts";
export const ARTIFACT_ENTRY = "index.html";
export const ARTIFACT_DATA_FOLDER = "data";
export const ARTIFACT_ENTRIES_FILE = "_entries.json";

// 이름이 곧 폴더 이름이라 slug다.
export const artifactNameSchema = slugSchema;

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
  const m = new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i")
    .exec(tag);
  return m ? (m[1] ?? m[2]) : null;
}

// 호출하는 쪽이 HTML 앞쪽만 넘긴다. 제목과 설명은 HTML에서 읽는다.
export function parseArtifactMeta(
  html: string,
  fallbackTitle: string,
): ArtifactMeta {
  const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  const title = titleMatch ? clean(titleMatch[1], TITLE_MAX) : "";
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
const FOLDER_PREFIX = `${ARTIFACTS_FOLDER}/`;

// 대화 글에서 이 project의 artifact를 가리키는 path 조각의 위치.
export function artifactMentions(
  text: string,
  names: readonly string[],
): ArtifactMention[] {
  const mentions: ArtifactMention[] = [];
  for (const match of text.matchAll(FRAGMENT)) {
    const fragment = match[0].replace(TRAILING_PUNCTUATION, "");
    for (let i = 0; i < fragment.length; i++) {
      if (i > 0 && fragment[i - 1] !== "/") continue;
      if (!fragment.startsWith(FOLDER_PREFIX, i)) continue;
      const from = i + FOLDER_PREFIX.length;
      const slash = fragment.indexOf("/", from);
      const name = fragment.slice(from, slash < 0 ? undefined : slash);
      if (!names.includes(name)) continue;
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
