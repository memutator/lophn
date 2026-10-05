// `lophn harness list|detect|refresh|inspect` command의 route 표와 실행
// 결정이다(T28, cli#R40 일부, coding-agent/harnesses#R2–R4). list는 catalog를,
// detect는 최초 감지를, refresh는 사람 요청 재감지를, inspect는 제품별
// 감지 json을 낸다. 감지 명령은 core ledger command가 아니므로 표에
// route가 없다(architecture, coding-agent/harnesses 배치표). screen 재진입·
// 빈 결과·timeout에 자동 재감지·설치가 없다(R2 확인).
import type { HarnessId } from "../../../contracts/coding-agent/mod.ts";
import {
  cliHarnessDetectSchema,
  cliHarnessInspectSchema,
  cliHarnessListSchema,
  cliHarnessRefreshSchema,
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
];

// 사람 요청대의 재감지다(R2). refresh command만 재감지를 먹는다. detect·
// inspect는 사람 요청이 아니라 화면 재진입이어도 자동 재감지가 없다(R2 확인).
export function refreshRequestedBy(
  command: string,
): boolean {
  return command === "harness refresh";
}

// inspect에서 고른 제품이다. schema가 이미 harness enum을 검사했다.
export function inspectTargetOf(
  input: { harness?: HarnessId },
): HarnessId | undefined {
  return input.harness;
}
