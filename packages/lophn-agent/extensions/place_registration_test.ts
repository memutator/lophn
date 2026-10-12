import type { LedgerTestRegistration } from "../../../apps/core/testing/ledger.ts";
import type { McpServerConfig } from "../../contracts/lophn-agent/mod.ts";
import type { Tx } from "../../contracts/platform/mod.ts";
import {
  createNodePlaceFiles,
  createNodeSkillFiles,
} from "./adapters/node-fs.ts";
import {
  createPlaceExtensionCommands,
  createPlaceExtensionReads,
  type PlaceExtensionDeps,
} from "./mod.ts";

// 자리 확장 설정의 ledger 시험 등록. 파일은 실제 임시 폴더(ledger 파일이 있는 폴더가 data root다)에 쓰고
// project·app 존재와 전역 등록(MCP 서버, skill 등록 폴더)은 고정한 값으로 갈음한다.
// writer와 reader는 이 module을 따로 올리므로 상태를 module에 두지 않는다.

export const PRJ = "prj_01arz3ndektsv4rrffq69g5fa1";
export const OTHER_PRJ = "prj_01arz3ndektsv4rrffq69g5fa9";
export const APP = "app_01arz3ndektsv4rrffq69g5fa2";
export const MISSING_PRJ = "prj_01arz3ndektsv4rrffq69g5fzz";

// 전역에 등록된 서버 하나다. 같은 이름을 자리에 더하면 거절이다(R33).
export const GLOBAL_SERVER_NAME = "shared";

const GLOBAL_SERVER: McpServerConfig = {
  name: GLOBAL_SERVER_NAME,
  revision: 1,
  enabled: true,
  transport: "stdio",
  call_timeout_ms: 60_000,
  classifications: {},
  stdio: { executable: "/usr/bin/shared", args: [], cwd: null, env: {} },
};

type Sql = Pick<Tx["sql"], "get" | "all">;

function rootOf(sql: Sql): string {
  const row = sql.get(
    "select file from pragma_database_list where name = 'main'",
    [],
  );
  const file = String(row?.["file"]);
  return file.slice(0, file.lastIndexOf("/"));
}

// 전역 skill 출처는 data root 아래 registered(등록 폴더), skills(개인 보관소), bundled(동봉)다.
export function createLedgerTestRegistration(): LedgerTestRegistration {
  const deps: PlaceExtensionDeps = {
    files: createNodePlaceFiles(),
    skillFiles: createNodeSkillFiles(),
    lookups: (sql) => ({
      placeExists: (place) =>
        place.id === PRJ || place.id === OTHER_PRJ || place.id === APP,
      globalServers: () => [GLOBAL_SERVER],
      skillSources: () => ({
        registered: [`${rootOf(sql)}/registered`],
        personal: `${rootOf(sql)}/skills`,
        bundled: `${rootOf(sql)}/bundled`,
      }),
    }),
  };
  const commands = createPlaceExtensionCommands(deps);
  const reads = createPlaceExtensionReads(deps);
  return {
    schemaSteps: [],
    commands: [commands.change],
    reads: [reads.read],
  };
}
