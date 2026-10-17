// 팔레트의 파일 묶음이 쓰는 project 키워드 검색. place가 없으면 보관하지 않은 모든 project에서 찾는다.
// 실패는 빈 목록이라 다른 묶음은 그대로 보인다.
import type { LophnSource } from "../../source-result.ts";
import type { FileSearchSource } from "../../workspace/search/source.ts";
import type { FileSearch } from "./host.tsx";
import type { FileFound } from "./model.ts";

/** project 하나에서 보이는 줄 수. */
const PER_PROJECT = 12;

export function fileSearch(
  lophn: LophnSource,
  files: FileSearchSource,
): FileSearch {
  return async (query, place) => {
    if (query.trim() === "") return [];
    let projects: readonly string[];
    if (place === null) {
      const catalog = await lophn.catalog();
      if (!catalog.ok) return [];
      projects = catalog.value.projects.map((row) => row.id);
    } else projects = [place.id];
    const found = await Promise.all(projects.map(async (project) => {
      const result = await files.search({ project, query });
      if (!result.ok) return [];
      return result.value.slice(0, PER_PROJECT).map((match): FileFound => ({
        project,
        path: match.path,
        file: `${match.folder.replace(/\/+$/, "")}/${match.path}`,
        line: match.line,
        text: match.text.trim(),
      }));
    }));
    return found.flat();
  };
}
