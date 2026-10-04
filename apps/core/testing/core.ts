/**
 * 다른 팀의 *_test.ts가 쓰는 test-only public entry. 제품 main.ts에는 없다.
 *
 * 임시 데이터 root로 core 전체를 띄우고, 다섯 actor 어느 것이든 지정 scope·
 * conditions의 테스트 credential을 만든다. coding_agent 발급(T34) 전에도
 * MCP·CLI 테스트가 이 credential로 붙는다.
 */
import { manualClock, seededRandom } from "../../../packages/base/mod.ts";
import type { Result } from "../../../packages/base/mod.ts";
import { err, ok } from "../../../packages/base/mod.ts";
import type {
  ActorKind,
  CredentialConditions,
  CredentialScope,
} from "../../../packages/contracts/platform/mod.ts";
import { CredentialRegistry } from "../../../packages/platform/identity/mod.ts";
import { type Core, startCore } from "../core.ts";
import type { TeamModule } from "../registration.ts";

export type CoreHarnessCredential = {
  actor: ActorKind;
  principal: string;
  scope: CredentialScope;
  conditions: CredentialConditions;
};

export type CoreHarnessOptions = {
  // 팀이 자기 등록 모듈을 넘긴다. 제품 등록과 같은 모양이다.
  teams?: readonly TeamModule[];
  nowMs?: number;
  seed?: number;
};

export type CoreHarness = {
  port: number;
  epoch: string;
  dataRoot: string;
  // 지정 scope·conditions의 테스트 credential. 제품 발급 경로와 별개다.
  credential(input: CoreHarnessCredential): Promise<Result<{ token: string }>>;
  close(): Promise<void>;
};

const ACTORS: readonly ActorKind[] = [
  "user",
  "coding_agent",
  "agent",
  "app",
  "machine",
];

export async function createCoreHarness(
  options: CoreHarnessOptions = {},
): Promise<Result<CoreHarness>> {
  const nowMs = options.nowMs ?? Date.UTC(2026, 9, 4);
  const seed = options.seed ?? 1;
  const clock = manualClock(nowMs);
  const directory = await Deno.makeTempDir({ prefix: "lophn-core-harness-" });
  const started = await startCore({
    lophnHome: directory,
    port: 0,
    teams: options.teams ?? [],
    clock,
    random: seededRandom(seed),
  });
  if (!started.ok) {
    await Deno.remove(directory, { recursive: true });
    return started;
  }
  const core: Core = started.value;
  const random = seededRandom(seed + 1);
  return ok({
    port: core.port,
    epoch: core.epoch,
    dataRoot: core.dataRoot,
    async credential(input) {
      // user·machine만 이 registry가 발급한다. agent·app·coding_agent 발급은 각 소유 작업이 맡는다.
      if (input.actor !== "user" && input.actor !== "machine") {
        return err({
          code: "unavailable",
          message: "그 actor의 테스트 credential 발급은 아직 없다",
        });
      }
      // 요청한 operation만 상한으로 인정한다. 그 밖의 scope 확대는 registry가 거절한다.
      const registry = new CredentialRegistry({
        epoch: core.epoch,
        clock,
        random,
        operations: input.scope.operations.map((name) => ({
          name,
          actors: ACTORS,
          kind: input.actor === "machine"
            ? "command" as const
            : "read" as const,
        })),
      });
      const issued = await registry.issue({ ...input, actor: input.actor });
      if (!issued.ok) return issued;
      return ok({ token: issued.value.token });
    },
    async close() {
      await core.shutdown();
      await Deno.remove(directory, { recursive: true });
    },
  });
}
