// context.preview의 순수 함수: 만드는 중인 판(draft)을 지금 파일에 돌려 보기만 한다.
// 격리 검사(check/runner.ts)와 같은 단계(runStages)를 쓰되 (1) 개체 수를 type별로 세고 (2) 사람이 저장한
// saved view를 부르지 않으며 (3) 결과를 어디에도 쓰지 않는다. 판·index·ledger를 만지는 port를 받지 않는다.
import type { BundleContent } from "../../../contracts/documents/mod.ts";
import { aborted, runStages } from "../check/mod.ts";
import type { PreviewInput, PreviewOutcome } from "./types.ts";

const STOPPED = { types: [], violation_count: 0, violations: [] };

export function previewDraft(input: PreviewInput): PreviewOutcome {
  try {
    const stages = runStages({
      bundle: input.draft,
      files: input.files,
      appData: input.appData,
      env: input.env,
      user_saved_views: [],
    });
    if (stages.entities === null) {
      return { ...STOPPED, findings: stages.findings };
    }
    // 모양 검사를 지났으므로 type 이름과 순서를 믿어도 된다.
    const types = (input.draft as BundleContent).contract.types;
    const counts = new Map<string, number>();
    for (const entity of stages.entities) {
      counts.set(entity.type, (counts.get(entity.type) ?? 0) + 1);
    }
    return {
      types: types.map((type) => ({
        type: type.name,
        count: counts.get(type.name) ?? 0,
      })),
      findings: stages.findings,
      violation_count: stages.violations.length,
      violations: stages.violations,
    };
  } catch (error) {
    return { ...STOPPED, findings: [aborted(error)] };
  }
}
