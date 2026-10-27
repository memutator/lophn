import { err, ok, type Result } from "../../../base/mod.ts";
import { projectSearch } from "../../../protocol/projects/mod.ts";
import type { ApiReadDefinition, Sql } from "../../../protocol/server/mod.ts";
import { loadProject, searchScopeOf } from "../registry/mod.ts";
import { decodeCursor, encodeCursor, pageLimit } from "./model.ts";
import { scan, type ScanDeps } from "./work.ts";

type ProjectSearchDeps = ScanDeps & {
  // ledger snapshot 하나에서 project를 읽는다. 연결은 읽고 나면 닫는다.
  snapshot<T>(
    read: (sql: Pick<Sql, "get" | "all">, asOfSeq: string) => Result<T>,
  ): Result<T>;
};

// project의 등록 폴더를 색인 없이 훑어 키워드를 찾는다. 사람만 부른다.
export function projectSearchRead(
  deps: ProjectSearchDeps,
): ApiReadDefinition<typeof projectSearch> {
  return {
    route: projectSearch,
    async handle(_ctx, input) {
      const parsed = projectSearch.input.safeParse(input);
      if (!parsed.success) {
        return err({ code: "invalid_input", message: "invalid read input" });
      }
      const { project: id, folder, query, cursor, limit } = parsed.data;
      const loaded = deps.snapshot((sql, asOfSeq) => {
        const project = loadProject(sql, id);
        return project.ok ? ok({ project: project.value, asOfSeq }) : project;
      });
      if (!loaded.ok) return loaded;
      if (loaded.value.project === null) {
        return err({ code: "not_found", message: "project not found" });
      }
      const scope = searchScopeOf(loaded.value.project.folders, folder);
      if (!scope.ok) return scope;
      let start;
      if (cursor !== undefined) {
        const decoded = decodeCursor(cursor);
        if (!decoded.ok) return decoded;
        start = decoded.value;
      }
      const found = await scan(
        {
          scope: scope.value,
          query,
          cursor: start,
          limit: pageLimit(limit),
        },
        deps,
      );
      if (!found.ok) return found;
      return ok({
        matches: found.value.matches,
        next_cursor:
          found.value.next === null ? null : encodeCursor(found.value.next),
        as_of_seq: loaded.value.asOfSeq,
      });
    },
  };
}
