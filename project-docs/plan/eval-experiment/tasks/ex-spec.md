# ex-spec

experiment 기록 폴더 `tests/eval/experiments/<id>/`의 꼴을 만든다: 사람이 돌리기 전에 쓰는 `spec.json`, program이 쓰는 `result.json`, experimenter가 쓰는 `report.md`. spec 읽기와 검사(경계는 eval-base의 `Result`), spec이 harness 고침보다 먼저 commit됐는지 보는 규칙, 그리고 뒤 task(ex-select, ex-trials, ex-verdict)가 같이 쓰는 type과 세는 함수를 이 task가 내놓는다.

- 단위: ex-spec (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `tests/eval/experiment/spec/**`
  - `tests/eval/types.ts`: `TrialResult`에 칸 하나(`components?: VersionRef[]`)만 더한다. 그 밖의 줄은 고치지 않는다(아래 "할 일 1"의 마지막).
- 읽을 것:
  - 설계 정본: `project-docs/products/roadmap/eval.md`의 "experiment"(표, 예), "trial 수", "특정 시나리오에 맞추지 않기", "역할과 흐름"(spec은 harness를 고치기 전에 확정한다), "정한 것"(채택 규칙, 판정 규칙은 program이 계산한다)
  - 계획: `project-docs/plan/eval-experiment/README.md`("정한 것": experiment 기록, spec의 칸, 판정, 기준 구성, trial 정책). `project-docs/plan/eval-coding/README.md`(이 계획은 그 뒤에 시작한다)
  - 진단 type의 칸: `project-docs/plan/eval-experiment/tasks/ex-overfit.md`(`OverfitWarning`), `ex-repeat.md`(`RepeatFinding`), `ex-assembly.md`(`AssemblyReport`). 이 task가 type을 정의하고 세 task가 여기서 import한다.
  - 먼저 끝난 계획의 코드와 brief(`tests/eval/types.ts`는 main에 있다. 이름과 칸은 그 file이 정본이다): `project-docs/plan/eval-base/tasks/ev-contract.md`(`RunRecord`, `TrialResult`, `CheckResult`, `JudgeItem`, `Scenario`, `VersionRef`, `VersionKind`, `refText`, `parseRef`), `ev-scorecard.md`(run 요약을 읽는 쪽. `tests/eval/runs/<id>.json`)
  - 본보기(registry 파일을 읽고 쓰는 꼴, `JSON.stringify(value, null, 2) + "\n"`): `project-docs/plan/eval-base/tasks/ev-versions.md`의 "registry"
  - 경계 규칙: `AGENTS.md`의 "코드"(오류 코드 일곱, `packages/base`의 `Result`)
  - 코드: `packages/base/mod.ts`(`Result`, `ok`, `err`, `LophnError`, `sha256Hex`), `deno.json`의 `zod`(`npm:zod@4.6.5`, 이미 있는 의존)
- 계약:
  - 쓰는 것:
    - `tests/eval/types.ts`: `RunRecord`, `TrialResult`, `JudgeItem`, `Scenario`(`id`, `n`, `checks`만 쓴다), `VersionRef`, `VersionKind`, `refText(ref): string`, `parseRef(text, kind?): VersionRef`(형식이 틀리면 throw)
    - `packages/base/mod.ts`: `Result`, `ok`, `err`, `LophnError`, `sha256Hex(text): Promise<string>`
  - 내놓는 것(`tests/eval/experiment/spec/mod.ts`가 모두 다시 내보낸다): 아래 "할 일"의 type과 함수. ex-select, ex-trials, ex-verdict, ex-gate, ex-overfit, ex-cli가 이 이름과 칸에 기댄다.

## 할 일

1. **type** (`types.ts`). 칸 이름과 의미가 곧 계약이다. 주석은 "왜"만 짧게 쓴다.

```ts
import type { JudgeItem, VersionKind, VersionRef } from "../../types.ts";

// experiment로 바꿀 수 있는 component. grader(scenario, criterion, judge, checks)와 core, 재료는 대상이 아니다
// (roadmap: grader는 지금 checkout에 고정한다. core는 experiment 대상이 아니다). model과 cli는 checkout을 바꾸는 길이 아니라 뺀다.
export const EXPERIMENT_KINDS: readonly VersionKind[] = [
  "instruction", "skill", "skill-description", "guide", "tool", "assembly", "runtime", "template",
];

// 시나리오 id(n 없음)와 보는 check. checks를 빼면 trial 전체의 통과를 본다.
export type Goal = { scenario: string; checks?: string[] };

export type Policy = { base: number; max: number };   // trial 수: 처음에 도는 수와 상한

export type ExperimentSpec = {
  id: string;                          // 폴더 이름. /^[a-z0-9][a-z0-9-]*$/
  hypothesis: string;                  // 무엇이 왜 나아지나
  start_run: string;                   // 출발점 RunRecord.id. 고치게 된 실패를 보인 run
  model: string;                       // 기준 model(예 claude-sonnet-5-5). 기준 run을 고를 때 낡음 판정에 쓴다
  change: { from: VersionRef; to: VersionRef };   // X@a → X@b. 같은 kind·name, n만 다르다
  target: Goal[];                      // 나아져야 할 것. 하나 이상
  cases: Goal[];                       // 고치기 전에 미리 써 둔 같은 규칙의 case. 하나 이상. target과 시나리오가 겹치지 않는다
  judgment: { rule: "default@1" };     // 판정 규칙의 이름. 계산은 ex-verdict가 한다
  trials: Policy;                      // 1 <= base <= max <= 5. 기본값은 {base: 1, max: 3}이지만 spec에 값을 쓴다
  budget_usd: number;                  // experiment 하나의 $ 상한. 0보다 크다. 기본 100
};

export type Role = "target" | "guard" | "case";

// 한 trial의 결과 한 줄. 모든 task가 같은 눈금으로 세려고 여기서 만든다.
// components = 그 trial에서 진짜 model이 본 것. TrialResult.components가 없으면 run의 합집합을 쓴다(outcomeOf의 둘째 인자).
export type Outcome = { index: number; passed: boolean; checks: Record<string, boolean>; cost_usd: number; components: VersionRef[] };
export type Tally = { passed: number; trials: number };
export type PoolVerdict = "pass" | "fail" | "split" | "none";

// ex-select가 고르고 ex-trials, ex-verdict가 읽는 한 시나리오의 자리.
export type PlanEntry = {
  scenario: string;                    // 시나리오 id
  n: number;                           // 지금 checkout의 시나리오 n
  role: Role;
  checks: string[] | null;             // Goal.checks. guard는 null
  baseline_runs: string[];             // 기준으로 쓴 RunRecord.id. case는 비어 있을 수 있다
  baseline: Outcome[];                 // 그 run들의 trial 전부
};

export type ScenarioResult = {
  scenario: string; n: number; role: Role; checks: string[] | null;
  baseline_runs: string[]; baseline: Tally;
  variant_runs: string[]; variant: Tally;
  remaining: number;                   // 정책이 더 돌리라고 한 trial 수. 0이 아니면 아직 끝나지 않았다
  status: "ok" | "fail" | "not_improved" | "worse" | "incomplete";
  weaker: boolean;                     // guard: 통과율은 기준보다 낮지만 worse는 아니다
  note: string;                        // 한 줄
};

export type ExperimentResult = {
  id: string;
  decision: "adopt" | "reject" | "inconclusive";
  rule: "default@1";
  spec_hash: string;                   // spec.json byte의 sha256. 돌린 뒤 spec이 바뀌면 드러난다
  spec_commit: string | null;
  changed: { from: string; to: string }[];   // refText. 기준 checkout과 variant checkout의 버전이 다른 것 전부
  mixed: boolean;                      // changed가 spec.change 하나가 아니다
  scenarios: ScenarioResult[];
  keep: { scenario: string; runs: string[] }[];       // X를 보지 않아 다시 돌리지 않은 것
  excluded: { scenario: string; reason: string }[];   // 낡아서 기준이 못 된 것
  reasons: string[];                   // 판정 이유, 한 줄씩
  cost_usd: number;
  stopped_by_budget: boolean;
  decided_at: string;
  // 진단. 판정에 들지 않는다. 아래 세 type은 이 task가 정의하고 ex-overfit, ex-repeat, ex-assembly가 import한다.
  overfit?: OverfitWarning[];
  repeats?: RepeatFinding[];
  assembly?: AssemblyReport[];
};

// ex-overfit이 낸다. scenario는 `id@n`, component는 `kind:name@a→@b` 글, line은 더해진 줄(160자까지).
export type OverfitWarning = { scenario: string; component: string; file: string; kind: "name" | "phrase"; term: string; line: string };

// ex-repeat이 낸다. 같은 tool을 같은 인자로 3번 이상 부른 곳 하나를 repeat-kind judge가 본 결과.
export type RepeatFinding = { session: string; tool: string; count: number; calls: string[]; item: JudgeItem };

// ex-assembly가 낸다. layer별 prefix hash가 앞 call과 같은 비율을 녹화한 쪽(baseline)과 다시 조립한 쪽(variant)에서 잰 값.
export type LayerStat = {
  layer: string;
  pairs: number;       // 앞 call과 견준 쌍의 수 (calls - 1)
  stable: number;      // 앞 call과 hash가 같은 쌍의 수
  rate: number | null; // stable / pairs. pairs가 0이면 null
  first_break: { call: number; before: string; after: string } | null;   // call은 1부터. 층이 없어졌거나 새로 생기면 "(absent)"
};
export type SideStat = { calls: number; layers: LayerStat[] };
export type AssemblyReport = {
  run: string; trial: number; session: string | null;
  status: "ok" | "diverged" | "not_replayable";
  reason: string | null;
  diverged_at: number | null;
  compared_calls: number;
  identical_calls: number;
  baseline: SideStat | null;
  variant: SideStat | null;
};
```

   - 진단 type의 칸은 ex-overfit, ex-repeat, ex-assembly의 brief 그대로다. 그쪽이 칸을 바꾸자고 하면 이 task가 따라간다.
   - `tests/eval/types.ts`의 `TrialResult`에 `components?: VersionRef[]; // 이 trial에서 진짜 model이 본 것. RunRecord.components는 trial 전체의 합집합이라 trial마다는 모른다. ex-cli가 채운다`를 더한다. 이유: 합집합만으로는 X@a를 본 run 안에서도 X를 안 본 trial이 기준 통과율에 섞인다. 없는 옛 run 요약은 합집합으로 대신한다(호환 장치가 아니라 칸이 선택이라서 생기는 읽는 쪽 규칙이다).
2. **세는 함수** (`tally.ts`). 기준 run 모으기(ex-select), trial 정책(ex-trials), 판정(ex-verdict)이 같은 눈금으로 센다.

```ts
// passed = settle이 idle이고 모든 CheckResult가 pass(ev-runner의 "trial 통과"와 같다).
// cost_usd = metrics.cost_usd + judge item의 cost_usd 합.
// components = trial.components ?? runComponents (run의 합집합).
export function outcomeOf(trial: TrialResult, runComponents: VersionRef[]): Outcome;
// checks가 null이면 o.passed. 있으면 그 id가 모두 o.checks에 있고 true일 때만 참(없는 id는 거짓: check 이름이 바뀐 것을 통과로 치지 않는다).
export function goalPassed(o: Outcome, checks: string[] | null): boolean;
export function tallyOf(outcomes: Outcome[], checks: string[] | null): Tally;
// trials 0 → "none". passed*2 > trials → "pass". passed*2 < trials → "fail". 같으면 "split".
export function poolVerdict(t: Tally): PoolVerdict;
```

3. **spec 읽기와 모양 검사** (`parse.ts`). 파일의 ref는 글(`instruction:lophn@3`)로 쓰고, 읽으면 `VersionRef`다. 이유: agent가 손으로 쓰기 쉽고 `refText`·`parseRef`가 이미 있다.

```ts
// spec.json의 값(unknown)을 읽는다. id를 주면 value.id와 같아야 한다(폴더 이름과 같게 하려는 것).
export function parseSpec(value: unknown, folderId?: string): Result<ExperimentSpec>;
```

   - zod `.strict()` schema로 모양을 본 뒤 아래를 본다. 모두 `invalid_input`이고 `details.problems`에 모든 문제를 글로 담는다(첫 문제만 던지지 않는다).
     - `hypothesis`, `start_run`, `model`이 비지 않았다.
     - `change.from`과 `change.to`의 kind·name이 같고 n이 다르다. kind가 `EXPERIMENT_KINDS`에 든다. `parseRef`가 throw하면 그 글을 문제로 담는다.
     - `target`과 `cases`가 각각 하나 이상이다. 같은 시나리오가 target 안에서 두 번 나오지 않는다. **`cases`의 시나리오가 `target`에 없다**: roadmap "실패를 처음 보여 준 case 하나만으로는 남기지 않는다. 고치기 전에 같은 규칙을 시험하는 다른 case를 써 둔다"를 spec 모양에서 못 박는 것이다. `checks`를 쓰면 비지 않은 글 배열이다.
     - `judgment.rule`이 `default@1`이다. 다른 값이면 거절한다(규칙을 더하게 되면 그때 이름을 더한다).
     - `trials`가 정수이고 `1 <= base <= max <= 5`. `budget_usd > 0`.
4. **지금 checkout과 맞추는 검사** (`check.ts`). 모양은 맞아도 지금 repo와 어긋날 수 있다.

```ts
export type SpecContext = {
  scenarios: { id: string; n: number; checks: { id: string }[] }[];   // 지금 checkout의 시나리오
  runs: RunRecord[];                                                  // tests/eval/runs/*.json
  versions: Map<string, VersionRef>;                                  // 기준(main) checkout의 currentVersions. 키 `${kind}:${name}`
};
export function checkSpecAgainst(spec: ExperimentSpec, ctx: SpecContext): Result<void>;
```

   - 문제를 모두 모아 `details.problems`에 담고, `code`는 첫 문제의 것이다. 문제와 code:
     - target·cases의 시나리오 id가 `ctx.scenarios`에 없다 → `not_found`. `checks`의 id가 그 시나리오의 `checks`에 없다 → `invalid_input`.
     - `start_run`이 `ctx.runs`에 없다(`run.id`, 곧 JSON 안의 `id`로 찾는다. file 이름으로 찾지 않는다) → `not_found`. 있는데 `run.model !== spec.model`, `run.scenario.name`이 target 시나리오가 아님, `run.components`에 `change.from`(kind·name·n이 모두 같은 것)이 없음 → `invalid_input`. 이유: 출발점 run이 이 가설을 보인 run이어야 한다.
     - `ctx.versions.get("<kind>:<name>")`가 없거나 n이 `change.from.n`과 다르다 → `conflict`("X@a가 기준 checkout의 버전이 아니다"). 이유: 채택은 고친 것을 main에 넣는 것이라, 기준은 main이 지금 가진 버전이어야 한다(README "정한 것"). 이미 고친 뒤에 spec을 쓰면 여기서 걸린다.
5. **spec이 고침보다 먼저인지** (`lock.ts`). roadmap은 "spec은 harness를 고치기 전에 확정한다. 고친 뒤에 쓰면 결과에 맞춰 규칙을 고른다"고 한다. 이 task는 git을 부르지 않는다. 사실은 호출하는 쪽(ex-cli)이 git으로 모아 넘기고, 이 함수는 그 사실만 판정한다.

```ts
export type LockFacts = {
  spec_commit: string | null;            // spec.json을 마지막으로 바꾼 commit. commit된 적이 없으면 null
  spec_dirty: boolean;                   // 작업 트리의 experiments/<id>/ 가 그 commit과 다르다
  spec_commit_on_current: boolean;       // spec_commit이 지금(기준) checkout의 HEAD와 같거나 조상이다
  variant_has_spec_commit: boolean;      // variant checkout의 HEAD가 spec_commit과 같거나 후손이다
  variant_spec_same: boolean;            // variant HEAD의 spec.json byte가 spec_commit의 것과 같다
  cases_missing_at_spec_commit: string[];// spec_commit에 시나리오 file이 없던 cases의 시나리오 id
};
export function checkSpecLocked(facts: LockFacts): Result<{ spec_commit: string }>;
```

   - 모두 `conflict`이고 메시지로 무엇을 먼저 하라고 말한다: `spec_commit`이 null이거나 `spec_dirty` → "spec(과 case 시나리오)을 먼저 commit하라". `!spec_commit_on_current` → "spec commit이 기준 checkout에 없다". `!variant_has_spec_commit` → "variant는 spec commit 위에서 만들어야 한다". `!variant_spec_same` → "variant에서 spec이 바뀌었다". `cases_missing_at_spec_commit`이 비지 않음 → "case 시나리오가 spec commit에 없다: <ids>".
   - 이유(정한 것): spec의 commit이 variant의 조상이면 고침은 그 뒤에 생긴다. 기준 checkout의 `X@a`가 spec의 `change.from`과 같다는 것은 4번이 이미 본다. 그래서 둘을 합치면 "spec과 미리 쓴 case가 고침보다 먼저 commit됐다"가 된다. spec file 안에 commit hash를 쓰지 않는다(자기 commit을 자기가 알 수 없다). 대신 `result.json`의 `spec_hash`와 `spec_commit`에 남긴다.
6. **기록 file 읽기·쓰기** (`files.ts`). `dir`은 `tests/eval/experiments`(`EXPERIMENTS_DIR` 상수). test는 임시 폴더를 준다. 폴더 이름은 `<dir>/<id>/`, file은 `spec.json`, `result.json`, `report.md`.

```ts
export const EXPERIMENTS_DIR = "tests/eval/experiments";
export function readSpec(dir: string, id: string): Promise<Result<{ spec: ExperimentSpec; hash: string }>>;   // 없으면 not_found. hash = sha256Hex(file 글)
export function readResult(dir: string, id: string): Promise<Result<ExperimentResult | null>>;                // 없으면 ok(null)
// 이미 result.json이 있고 그 decision이 "adopt" 또는 "reject"이면 conflict(판정은 한 번이다). 없거나 "inconclusive"면 덮는다.
export function writeResult(dir: string, result: ExperimentResult): Promise<Result<void>>;
export function listSpecIds(dir: string): Promise<string[]>;
```

   - `writeResult`는 `JSON.stringify(result, null, 2) + "\n"`로 쓴다. 폴더가 없으면 만든다(spec이 먼저 있어야 하므로 `spec.json`이 없으면 `not_found`).
   - 정한 것: 판정이 난 result는 덮지 않는다. 이유: 같은 spec을 다시 돌려 마음에 드는 결과가 나올 때까지 굴리는 길을 막는다. 더 돌리려면 새 spec(새 id)을 쓴다. `inconclusive`(예산이 끊었다)만 이어 돌릴 수 있다.
   - `report.md`는 program이 읽지 않는다. 쓰는 사람은 experimenter이고 꼴은 `ex-skills`가 정한다. 판정을 뒤집자는 요청도 `report.md`에 이유와 함께 적고 사람이 정한다. `result.json`은 program만 쓴다. 이 task는 `report.md`를 만들지 않는다.
7. `mod.ts`가 위를 모두 다시 내보낸다.
8. test (아래 "끝남")를 `tests/eval/experiment/spec/spec_test.ts`에 쓴다. 임시 폴더만 쓰고 git, core, subprocess, network를 쓰지 않는다.

## 정한 것

- 기록 폴더는 `tests/eval/experiments/<id>/`(data)이고 코드는 `tests/eval/experiment/`(단수)다. 이름이 비슷하니 헷갈리지 않게 한다. 데이터 폴더는 첫 experiment가 만들고, `fmt.exclude`는 lead가 올린다.
- 판정 규칙은 spec에 값이 아니라 이름(`default@1`)으로 둔다. 이유: 규칙은 program이 계산하는 것이라 값을 spec에 풀어 쓰면 program이 읽지 못한 칸이 생긴다. 규칙의 정의는 ex-verdict의 코드와 그 brief에 있다. 규칙을 바꾸면 이름을 올린다. trial 수(`trials`)와 예산(`budget_usd`)만 spec의 값이다.
- spec의 `change.to`는 고치기 전에 쓰므로 n은 짐작이다(registry에서 그 name의 가장 큰 n + 1이 보통이다). 돌린 뒤 variant에서 잰 실제 버전이 `change.to`와 n이 다르면 막지 않고 `result.json`의 `changed`와 `reasons`에 남긴다. 이유: spec은 고친 뒤 못 바꾸는데, 옛 내용으로 되돌아가는 고침은 옛 n을 받는다.
- `model`은 experiment가 쓰는 model이다. 기준 run을 고르는 낡음 판정(ev-scorecard의 `Current.model`)과 variant trial에 쓴다. ex-cli는 experiment에 `--model`을 받지 않고 이 값만 쓴다.
- run은 file 이름이 아니라 JSON 안의 `RunRecord.id`로 가리킨다(`start_run`, `baseline_runs`, `variant_runs`). eval-base의 runner가 file 이름을 `id`와 다르게 지을 수 있다.
- `EXPERIMENT_KINDS`에서 `model`과 `cli`를 뺐다. 이유: 그 둘은 checkout을 바꾸는 길이 아니라 설정이나 설치로 바뀌고, variant 경로(`ex-variant`)가 다루지 않는다. 필요해지면 그때 더한다.
- guard 칸을 spec에 두지 않는다(README). 그래서 `PlanEntry.role`의 `guard`는 ex-select만 만든다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test(`spec_test.ts`, 최대 셋):
  - "미리 쓴 case가 없거나 target과 같은 시나리오이면, 두 component를 한 번에 바꾸면, grader·core kind를 바꾸면 spec을 거절한다": `parseSpec`을 표로. 위 3번의 거절마다 한 줄씩, 올바른 spec 한 줄은 통과.
  - "spec commit이 없거나 dirty이거나 variant가 그 위에 있지 않거나 case가 spec commit에 없으면 거절한다": `checkSpecLocked`를 표로. 모두 맞는 사실 하나는 통과.
  - "판정이 난 result.json은 덮이지 않고 inconclusive는 덮인다": 임시 폴더에서 `writeResult`.
- 남지 않음: 해당 없음(새 코드).

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: `deno.json`의 `fmt.exclude`에 `tests/eval/experiments/`(lead가 한다)
- 안 쓰게 된 export: 없음
- 정한 것: 문서에 답이 없어 worker가 정한 것. 위 "정한 것"과 다르게 했으면 이유를 적는다.
- 넘길 줄: 남의 file을 최소로 맞춘 곳
- 계약 바꾸기 요청: `TrialResult.components?` 말고 `tests/eval/types.ts`를 바꿔야 하면 고치지 말고 여기 적는다
- **무겁게 짠 것**: 가장 단순한 구현보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: spec이 고침보다 먼저라는 사실(`LockFacts`)은 이 task가 모으지 않는다. ex-cli가 git으로 모아야 한다. 이 task만으로는 `LockFacts`를 부르는 곳이 없다.
