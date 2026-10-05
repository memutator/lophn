// app test 자식 fixture. harness로 플랫폼 필수 검사와 선언 code별 실패 경로를
// 돌리고 관측 frame을 scratch의 frames.jsonl에 쓴다. 인자는 `-- <scratch>`이고
// 검사 계획과 driver 설정은 scratch의 child.json이다.
import { createEmitter } from "../harness/emit.ts";
import { observeFailurePath, runPlatformChecks } from "../harness/checks.ts";
import type { HarnessPlan } from "../harness/driver.ts";
import { loadSources } from "../harness/source-scan.ts";
import {
  fixtureDriver,
  type FixtureDriverOptions,
} from "../testing/app-driver.ts";

type ChildInput = {
  plan: HarnessPlan;
  driver: FixtureDriverOptions;
  source_dir: string;
};

Deno.test({
  name: "problems/tests#R6: app test fixture child (실제 자식으로만 돈다)",
  ignore: Deno.args.length === 0,
}, async () => {
  const scratch = Deno.args[0];
  const input = JSON.parse(
    await Deno.readTextFile(`${scratch}/child.json`),
  ) as ChildInput;
  const emitter = createEmitter({
    side: "single",
    test_hash: input.plan.test_hash,
    write: (bytes) => {
      const line = new Uint8Array(bytes.byteLength + 1);
      line.set(bytes);
      line[bytes.byteLength] = 10;
      Deno.writeFileSync(`${scratch}/frames.jsonl`, line, {
        append: true,
        create: true,
      });
    },
  });
  const driver = fixtureDriver(input.driver);
  const sources = await loadSources(input.source_dir);
  const ran = await runPlatformChecks({
    driver,
    plan: input.plan,
    emitter,
    sources,
  });
  if (!ran.ok) throw new Error("platform checks failed to emit");
  for (const [command, code] of Object.entries(input.driver.failure_commands)) {
    await observeFailurePath({
      driver,
      plan: input.plan,
      emitter,
      code,
      command,
      command_input: {},
    });
  }
});
