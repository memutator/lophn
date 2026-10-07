// fake coding agent 실행이다(T20, Q10). stdio로 lophn-mcp에 붙어 ticket show →
// claim → (app tool 호출) → release 준비 → report를 돌린다. stdout 첫
// 줄은 기계가 읽는 ready 한 줄이다. 제품 coding agent가 아니라 apps 팀 new-app·
// change-app E2E가 coding agent 자리에 쓰는 개발 도구다. step는 인자로 받지
// 않는다. E2E 시나리오가 mod.ts의 startFakeCodingAgent를 직접 부른다.
import { startFakeCodingAgent } from "./mod.ts";

if (import.meta.main) {
  // 뜨는지 확인하는 실행이다. 실제 step는 E2E가 주입한다(report 포함).
  const result = await startFakeCodingAgent({
    command: Deno.execPath(),
    args: [
      "run",
      "--allow-all",
      new URL("../../apps/mcp/main.ts", import.meta.url).pathname,
    ],
    steps: [],
  });
  console.log(JSON.stringify({ ready: true, steps: result.steps.length }));
}
