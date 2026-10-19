import type { Result } from "../../../../base/mod.ts";
import type { Sql } from "../../../../protocol/server/mod.ts";
import { openConnection } from "../../../storage/ledger/mod.ts";
import type { WiringFactory } from "./context.ts";

export const projectsWiring: WiringFactory = () => {
  return {
    name: "projects",
    // project 키워드 검색이 project 폴더를 찾는 ledger snapshot. 읽을 때마다 짧은 연결을 연다.
    environment: (ctx) => ({
      projectSearch: {
        snapshot<T>(
          read: (sql: Pick<Sql, "get" | "all">, seq: string) => Result<T>,
        ): Result<T> {
          const opened = openConnection(ctx.ledgerPath);
          if (!opened.ok) return opened;
          try {
            const head = opened.value.sql.get(
              "select coalesce(max(seq), 0) as seq from events",
              [],
            );
            return read(opened.value.sql, String(head?.["seq"] ?? 0));
          } finally {
            opened.value.close();
          }
        },
      },
    }),
  };
};
