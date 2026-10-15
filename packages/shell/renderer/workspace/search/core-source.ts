// FileSearchSource를 core의 `project.search`로 잇는다. 응답은 main의 contract client가 route
// output schema로 이미 검사했다. 더 보기 단추가 없어 한도까지 page를 이어 받고 넘는 것은 버린다.
import type { CoreSource } from "../../desktop/connection/connection.ts";
import type { FileMatch, FileSearchSource } from "./source.ts";

/** 화면이 그리는 결과 한도. */
const RESULT_LIMIT = 500;
const PAGE_SIZE = 200;

interface SearchValue {
  matches: {
    folder_path: string;
    path: string;
    line: number;
    text: string;
    start: number;
    end: number;
  }[];
  next_cursor: string | null;
}

export function coreFileSearchSource(core: CoreSource): FileSearchSource {
  return {
    async search({ project, query, folder }) {
      const matches: FileMatch[] = [];
      let cursor: string | undefined;
      while (matches.length < RESULT_LIMIT) {
        let reply;
        try {
          reply = await core.call({
            kind: "read",
            resource: "projects",
            method: "search",
            body: {
              project,
              query,
              limit: PAGE_SIZE,
              ...(folder === undefined ? {} : { folder }),
              ...(cursor === undefined ? {} : { cursor }),
            },
          });
        } catch {
          return { ok: false, message: "unavailable" };
        }
        if (!reply.ok) {
          return { ok: false, message: reply.error?.code ?? "internal" };
        }
        const value = reply.value as SearchValue;
        for (const match of value.matches) {
          matches.push({
            folder: match.folder_path,
            path: match.path,
            line: match.line,
            text: match.text,
            start: match.start,
            end: match.end,
          });
        }
        if (value.next_cursor === null) break;
        cursor = value.next_cursor;
      }
      return { ok: true, value: matches.slice(0, RESULT_LIMIT) };
    },
  };
}
