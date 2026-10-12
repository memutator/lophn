import type { LedgerTestRegistration } from "../../../../apps/core/testing/ledger.ts";
import type { Tx } from "../../../protocol/platform/mod.ts";
import { createNodeSkillFiles } from "./adapters/node-fs.ts";
import { createGlobalSkillReads, type GlobalSkillDeps } from "./mod.ts";

// 전역 skill 목록의 ledger 시험 등록. 파일은 실제 임시 폴더(ledger 파일이 있는 폴더가 data root다)에 두고
// 전역에서 끈 이름은 data root의 skills-off.json 한 줄로 갈음한다(설정 값의 자리). writer와 reader는 이 module을
// 따로 올리므로 상태를 module에 두지 않는다.

type Sql = Pick<Tx["sql"], "get" | "all">;

function rootOf(sql: Sql): string {
  const row = sql.get(
    "select file from pragma_database_list where name = 'main'",
    [],
  );
  const file = String(row?.["file"]);
  return file.slice(0, file.lastIndexOf("/"));
}

export function createLedgerTestRegistration(): LedgerTestRegistration {
  const deps: GlobalSkillDeps = {
    skillFiles: createNodeSkillFiles(),
    lookups: (sql) => ({
      skillSources: () => ({
        registered: [`${rootOf(sql)}/registered`],
        personal: `${rootOf(sql)}/skills`,
        bundled: `${rootOf(sql)}/bundled`,
      }),
      skillsOff: () => {
        try {
          return JSON.parse(
            Deno.readTextFileSync(`${rootOf(sql)}/skills-off.json`),
          ) as string[];
        } catch {
          return [];
        }
      },
    }),
  };
  const reads = createGlobalSkillReads(deps);
  return { schemaSteps: [], commands: [], reads: [reads.read] };
}
