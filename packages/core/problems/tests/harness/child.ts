// 플랫폼 harness의 test 자식 본문이다. runner가 요청마다 만든 고정 진입 파일이 이것을 부른다. 입력은
// scratch의 `child.json`이고 앱 자식·broker·DB는 만지지 않는다: 모든 접근은 runner가 쥔 AppDriver를
// private 호출 통로(rpc.ts)로 부른다. 관측 frame은 scratch의 `frames.jsonl`에 쓴다(stdout이 아니다).
import { createEmitter } from "./emit.ts";
import { runChecks } from "./checks.ts";
import type { HarnessPlan } from "./driver.ts";
import { rpcDriver } from "./rpc.ts";

export type HarnessChildInput = { plan: HarnessPlan };

export async function runHarnessChild(scratch: string): Promise<void> {
  const input = JSON.parse(
    await Deno.readTextFile(`${scratch}/child.json`),
  ) as HarnessChildInput;
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
  const ran = await runChecks({
    driver: rpcDriver(scratch),
    plan: input.plan,
    emitter,
  });
  if (!ran.ok) throw new Error("platform checks failed to emit");
}
