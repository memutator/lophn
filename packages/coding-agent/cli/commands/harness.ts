// `lophn harness` command의 route 표와 실행 결정이다(T28·T29, cli#R40,
// coding-agent/harnesses#R2–R4, R6). list는 catalog를, detect는 최초 감지를,
// refresh는 사람 요청 재감지를, inspect는 제품별 감지 json을 낸다.
// plan·install·update·remove는 사람이 고른 exact target만 받고 감지된 다른
// 제품은 고치지 않는다(R6, cli#R40). 감지·설치 명령은 core ledger command가
// 아니므로 표에 route가 없다(architecture, coding-agent/harnesses 배치표).
// screen 재진입·빈 결과·timeout에 자동 재감지·설치가 없다(R2 확인).
import type { HarnessId } from "../../../contracts/coding-agent/mod.ts";
import {
  cliHarnessDetectSchema,
  cliHarnessInspectSchema,
  cliHarnessInstallSchema,
  cliHarnessListSchema,
  cliHarnessPlanSchema,
  cliHarnessRefreshSchema,
  cliHarnessRemoveSchema,
  cliHarnessUpdateSchema,
} from "../../../contracts/coding-agent/mod.ts";
import type { CommandEntry } from "./types.ts";

export const HARNESS_COMMANDS: readonly CommandEntry[] = [
  {
    name: "harness list",
    input: cliHarnessListSchema,
  },
  {
    name: "harness detect",
    input: cliHarnessDetectSchema,
  },
  {
    name: "harness refresh",
    input: cliHarnessRefreshSchema,
  },
  {
    name: "harness inspect",
    input: cliHarnessInspectSchema,
  },
  {
    name: "harness plan",
    input: cliHarnessPlanSchema,
  },
  {
    name: "harness install",
    input: cliHarnessInstallSchema,
  },
  {
    name: "harness update",
    input: cliHarnessUpdateSchema,
  },
  {
    name: "harness remove",
    input: cliHarnessRemoveSchema,
  },
];

// 사람 요청대의 재감지다(R2). refresh command만 재감지를 먹는다. detect·
// inspect는 사람 요청이 아니라 화면 재진입이어도 자동 재감지가 없다(R2 확인).
export function refreshRequestedBy(
  command: string,
): boolean {
  return command === "harness refresh";
}

// 관리 쓰기 command다(cli#R40). 이 command만 파일을 고친다. 고치지 않는
// command는 감지된 제품이 몇이든 무변경이다.
const WRITE_COMMANDS = [
  "harness plan",
  "harness install",
  "harness update",
  "harness remove",
];

export function writesFiles(command: string): boolean {
  return WRITE_COMMANDS.includes(command);
}

// 쓰기는 입력의 exact target 하나만 고친다(R6, cli#R40). 감지된 다른 harness는
// 입력에 없으므로 바뀌지 않는다.
export function writeTargetOf(input: {
  target?: { harness_id: HarnessId };
}): HarnessId | undefined {
  return input.target?.harness_id;
}

// inspect에서 고른 제품이다. schema가 이미 harness enum을 검사했다.
export function inspectTargetOf(
  input: { harness?: HarnessId },
): HarnessId | undefined {
  return input.harness;
}
