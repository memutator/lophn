// reproduction test 자식의 진입이다. runner가 side마다 만든 고정 진입 파일이 이것을 부른다. 입력은 scratch의
// `child.json`이고 관측 frame은 scratch의 `frames.jsonl`에 쓴다(stdout이 아니다). 앱 자식·broker·DB는
// 만지지 않고 모든 접근은 runner가 쥔 AppDriver를 private 호출 통로로 부른다.
import { createEmitter } from "../harness/emit.ts";
import { rpcDriver } from "../harness/rpc.ts";
import type { ReproductionSide } from "./judge.ts";
import { observeReproduction } from "./observe.ts";
import type { ReproductionScenario } from "./scenario.ts";

export type ReproductionChildInput = {
  side: ReproductionSide;
  test_hash: string;
  scenario: ReproductionScenario;
};

export async function runReproductionChild(scratch: string): Promise<void> {
  const input = JSON.parse(
    await Deno.readTextFile(`${scratch}/child.json`),
  ) as ReproductionChildInput;
  const emitter = createEmitter({
    side: input.side,
    test_hash: input.test_hash,
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
  const ran = await observeReproduction({
    driver: rpcDriver(scratch, { view: false }),
    scenario: input.scenario,
    emitter,
  });
  if (!ran.ok) throw new Error("reproduction observation did not emit");
}
