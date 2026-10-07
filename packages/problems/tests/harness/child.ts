// 플랫폼 harness의 test 자식 본문이다. runner가 요청마다 만든 고정 진입 파일이 이것을 부른다. 입력은
// scratch의 `child.json`이고 앱 자식·broker·DB는 만지지 않는다: 모든 접근은 runner가 쥔 AppDriver를
// private 호출 통로(rpc.ts)로 부른다. 관측 frame은 scratch의 `frames.jsonl`에 쓴다(stdout이 아니다).
import { createEmitter } from "./emit.ts";
import {
  observeDirectFailurePath,
  observeFailurePath,
  runPlatformChecks,
} from "./checks.ts";
import type { HarnessPlan } from "./driver.ts";
import { rpcDriver } from "./rpc.ts";
import { loadSources } from "./source-scan.ts";

// 앱이 낸 실패 경로 test 한 건. 선언 code를 실제 command 호출로 재현하는 입력이다. `direct`는 SDK만
// 직접 부르는 test라서 통과하지 못한다.
export type HarnessFailurePath = {
  code: string;
  command?: string;
  input?: unknown;
  fault?: "store" | "none";
  direct?: boolean;
};

export type HarnessChildInput = {
  plan: HarnessPlan;
  // 정적 code 사용을 읽을 고정 source 폴더(봉인 bundle 사본).
  source_dir: string;
  // runner가 화면 검사 host를 띄울 수 있는지.
  view: boolean;
  failure_paths: HarnessFailurePath[];
};

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
  const driver = rpcDriver(scratch, { view: input.view });
  const sources = await loadSources(input.source_dir);
  const ran = await runPlatformChecks({
    driver,
    plan: input.plan,
    emitter,
    sources,
  });
  if (!ran.ok) throw new Error("platform checks failed to emit");
  for (const path of input.failure_paths) {
    const sent = path.direct || path.command === undefined
      ? await observeDirectFailurePath({
        driver,
        plan: input.plan,
        emitter,
        code: path.code,
      })
      : await observeFailurePath({
        driver,
        plan: input.plan,
        emitter,
        code: path.code,
        command: path.command,
        command_input: path.input ?? null,
        fault: path.fault,
      });
    if (!sent.ok) throw new Error("failure path did not emit");
  }
}
