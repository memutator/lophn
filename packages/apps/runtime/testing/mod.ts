/**
 * apps/runtime의 team-brief testing fixture다. mod.ts에서 내보내지 않는다.
 *
 * runtime 표현은 ledger에 저장하지 않는다(domain-model apps/runtime). 테스트
 * 흐름에 필요한 관측 준비는 이 fixture가 writer transaction 안에서 남긴다.
 *
 * ```ts
 * const opened = await createLedgerHarness({
 *   registrationModules: [documents, registration, runtimeFixtures],
 *   credentials: [user, machine],
 * });
 * // active_release 기입:
 * await opened.command(machine, envelope("runtime.tests.adopt_release", {
 *   app: id, release,
 * }));
 * ```
 * record_*는 supervisor 관측 사실의 기록이므로 여기 남기지 않는다.
 */
import { z } from "zod";
import { ok, type Result } from "../../../base/mod.ts";
import {
  type AuthenticatedContext,
  type CommandDefinition,
  defineCommand,
  type Tx,
} from "../../../contracts/platform/mod.ts";

export const adoptRelease = defineCommand({
  resource: "runtime",
  method: "adopt-release",
  name: "runtime.tests.adopt_release",
  input: z.object({ app: z.string(), release: z.string() }),
  output: z.object({ adopted: z.boolean() }),
  actors: ["user", "machine"],
  errors: [],
});

// probeWrite는 rollback되므로 원본 표 기록은 writer transaction 안에서
// dispatch하는 이 fixture command로 남긴다(R2).
const adoptReleaseCommand: CommandDefinition<typeof adoptRelease> = {
  route: adoptRelease,
  handle(tx: Tx, _ctx, input) {
    // active_release는 releases 조립이 채택한다. 가져온 release를 기록한다.
    tx.sql.run("UPDATE apps SET active_release = ? WHERE id = ?", [
      input.release,
      input.app,
    ]);
    return ok({ adopted: true });
  },
};

export { adoptReleaseCommand };

// public harness는 이 함수를 부른다. fixture command만 등록한다.
export function createLedgerTestRegistration() {
  return {
    testCommands: [adoptReleaseCommand],
  };
}
