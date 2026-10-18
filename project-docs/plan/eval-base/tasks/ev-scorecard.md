# ev-scorecard

run 요약(`tests/eval/runs/*.json`)을 읽어 scorecard view를 날짜가 붙은 markdown으로 쓰고, 같은 시나리오의 두 run을 비교하는 diff를 낸다. scorecard는 시나리오마다 "지금 checkout과 버전이 맞는 최신 run"을 고르고 맞지 않으면 낡음 표시만 한다. 다시 돌릴지는 정하지 않는다.

- 단위: ev-scorecard (wave 3)
- 선행: ev-versions, ev-collect
- 소유(이 task만 고친다):
  - `tests/eval/scorecard/`
  - `tests/eval/scorecards/`
- 읽을 것:
  - 설계 정본: `project-docs/products/roadmap/eval.md`의 "scorecard"(experiment 아래), "run", "check와 judge", "judge를 믿고 쓰기", "공통 수치", "지켜야 할 것"
  - 계획: `project-docs/plan/eval-base/README.md`의 "자리"와 "계약"
  - 먼저 끝난 task: `project-docs/plan/eval-base/tasks/ev-contract.md`(type), `ev-versions.md`(registry와 `currentVersions`), `ev-collect.md`(`Metrics`의 뜻과 `sumMetrics`, `toolRates`)
- 계약:
  - 쓰는 것:
    - `tests/eval/types.ts`: `RunRecord`, `TrialResult`, `CheckResult`, `JudgeItem`, `Metrics`, `ScorecardRow`, `Scenario`, `VersionRef`, `RegistryEntry`, `refText`, `parseRef`
    - `tests/eval/collect/mod.ts`(ev-collect): `sumMetrics(list: Metrics[]): Metrics`, `toolRates(tools: Metrics["tools"]): { format: number | null; success: number | null; blocked: number | null }`
    - `tests/eval/versions/mod.ts`: `currentVersions(deps?): Promise<Map<string, VersionRef>>`(키 `${kind}:${name}`, core는 `core:core`, checks는 `checks:checks`), `readEntries(dir, kind, name): Promise<RegistryEntry[]>`, `latestEntry(dir, kind, name)`, `contentFiles(entry): Record<string, string>`
    - `packages/base/mod.ts`의 `systemClock`, `type Clock`
  - 내놓는 것: 아래 "할 일"의 함수와 `tests/eval/scorecard/main.ts`(CLI). 다른 task는 기대지 않는다.

## 할 일

1. **run 읽기** (`runs.ts`)

```ts
// dir(기본 tests/eval/runs)의 *.json을 RunRecord로 읽는다. 읽지 못하거나 id가 없는 file은 이름과 이유를 담아 throw한다.
export function readRuns(dir: string): Promise<RunRecord[]>;
```

2. **고르기** (`pick.ts`). roadmap: scorecard는 기준 구성에서 시나리오마다 유효한 최신 run을 모은 view다. 낡은 run은 표시만 한다.

```ts
export type Current = {
  scenarios: Pick<Scenario, "id" | "n" | "proposal" | "world" | "checks">[];   // 지금 checkout의 시나리오
  versions: Map<string, VersionRef>;                              // ev-versions의 currentVersions
  judge: VersionRef | null;                                       // 지금 judge. 없으면 judge check를 비교하지 않는다
  model: string;                                                  // 기준 model 이름
};

// 낡은 이유 목록. 비어 있으면 유효하다. 한 줄에 하나, 꼴은 아래와 같다.
export function staleReasons(run: RunRecord, scenario: Current["scenarios"][number], current: Current): string[];
export function pickRows(runs: RunRecord[], current: Current): ScorecardRow[];   // current.scenarios 순서
```

   - 낡은 이유 (run이 가리킨 것이 지금과 다르면 하나씩 적는다):
     - 시나리오: `run.scenario.n !== scenario.n` → `scenario L4-app@1 → @2`
     - 재료: `run.materials`의 `refText` 집합이 `scenario.world`(`parseRef(text, "material")`)와 다르면 → `materials apps-home@1 → apps-home@2`처럼 바뀐 것만
     - grader: `scenario.checks` 가운데 judge check의 `criterion`(글 `name@n`) 집합이 `run.grader.criteria`의 `name@n` 집합과 다르면 criterion별로, `current.judge`가 있고 `run.grader.judge`와 다르면 `judge judge@1 → @2`, `run.grader.checks.n !== versions.get("checks:checks").n`이면 `checks@3 → @4`
     - component: `run.components`의 각 `c`에 대해 `current.versions.get(`${c.kind}:${c.name}`)`이 있고 `n`이 다르면 `instruction:lophn@3 → @4`. `kind`가 `model`이면 `c.name !== current.model`일 때 `model claude-a → claude-b`. `versions`에 없는 것(요청마다 다른 tool 같은)은 건너뛴다
     - core: `run.core.n !== versions.get("core:core").n` → `core@31 → @32`
   - 시나리오마다 `run.scenario.name`(= 시나리오 id)이 같은 run 중 `started_at`이 가장 늦은 유효한 run을 고른다. 유효한 run이 없으면 가장 늦은 run을 고르고 `stale`에 이유를 담는다. run이 하나도 없으면 `run: null`, `stale: ["run 없음"]`, `passed: 0`, `trials: 0`, `checks: []`, `metrics: null`.
   - trial이 통과했다 = 그 trial의 `checks`가 모두 `pass`. `ScorecardRow.checks`는 check id마다 `passed`(통과한 trial 수), `of`(trial 수), `reasons`(떨어진 trial의 reason, 중복 없이 최대 3개). `metrics`는 trial의 `metrics`를 ev-collect의 `sumMetrics`로 합친 값이다. `proposal`은 시나리오의 `proposal`을 그대로 옮긴다.
3. **markdown** (`markdown.ts`)

```ts
export function renderScorecard(rows: ScorecardRow[], runs: RunRecord[], opts: { date: string; model: string }): string;
```

   - 구성은 이 순서다. 표는 시나리오마다 한 줄.
     1. 제목 `# scorecard <date>`와 기준 한 줄: 기준 model, "낡음은 지금 checkout의 version과 비교한 값이다", run마다 본 version은 `tests/eval/runs/<id>.json`에 있다.
     2. 요약 표: 시나리오(`id@n`), run id, 통과(`passed/trials`), program check 통과·전체, judge check 통과·전체, 비용(`cost_usd`, USD 소수 넷째 자리. `unpriced_calls`가 있으면 `+?`), cache hit rate(%), tool 성공 비율(`toolRates(...).success`, 분모 0이면 `-`), 잘림(`truncated_calls`), agent call 수(`agent_calls.length`), 제안(`proposal`이면 `제안`), 낡음(비어 있으면 빈칸, 아니면 `낡음`).
     3. `## 떨어진 check`: 통과하지 못한 check마다 `시나리오 / check id / 이유(reason)`.
     4. `## judge verdict`: judge item마다 `시나리오 / check / criterion@n / verdict / 인용 / run file 경로(tests/eval/runs/<id>.json)`. roadmap "judge를 믿고 쓰기"가 verdict에서 입력을 바로 열 수 있게 하라고 한다. 입력 전체는 그 run file에 있어 경로만 적는다. verdict가 `cannot_tell`이거나 오류(`error`가 있음)인 것은 앞에 `!`를 붙인다.
     5. `## 낡음`: 낡은 run의 이유 목록(시나리오별).
     6. `## 제안 줄에서 나온 case`: `proposal`인 시나리오 id 목록과 "떨어지면 model보다 AGENT-ROLE의 그 줄이나 지침이 틀렸을 수 있다" 한 줄. 떨어진 것은 표시한다.
   - judge 비용은 대상 비용과 따로 적는다(roadmap): 요약 표에는 대상 비용만 두고, `## judge verdict` 아래에 judge 비용 합 한 줄을 둔다.
   - 숫자, verdict, 떨어진 이유만 쓴다. 대답 글과 요청 body는 싣지 않는다(roadmap "지켜야 할 것").
4. **diff** (`diff.ts`). 같은 시나리오의 두 run을 놓고 component 내용, check verdict, 수치를 나란히 보인다(roadmap).

```ts
export function lineDiff(a: string, b: string, context?: number): string;   // 줄 단위 LCS diff. 바뀐 덩어리와 앞뒤 context(기본 2)줄. 같으면 ""
export function diffRuns(a: RunRecord, b: RunRecord, deps: { registryDir: string }): Promise<string>;   // markdown
```

   - `diffRuns` 구성:
     1. 헤더: 두 run id, 시나리오(`id@n`)가 다르면 다르다고 적는다(그래도 계속 비교한다).
     2. `## component`: `kind:name`이 양쪽에 있고 n이 다르면 `kind:name@a → @b`와 내용 diff. 내용은 `readEntries`로 두 n의 entry를 찾아 `contentFiles`로 풀고 파일마다 `lineDiff`를 ```diff 블록에 넣는다. content가 registry에 없는 kind(assembly, runtime, model)는 "내용은 git에 있다: <a.source.commit>..<b.source.commit>" 한 줄만 쓴다(working tree에서 고쳐 돌린 run은 `source.dirty`와 diff가 run 전체 기록에 있다고 덧붙인다). 한쪽에만 있는 component는 `a에만`/`b에만`으로 적는다. 바뀐 것이 없으면 "같다".
     3. `## 재료와 core`: `materials`, `core`, `grader`(criteria, judge, checks), `model`이 다르면 한 줄씩. 같으면 "같다".
     4. `## check`: check id마다 양쪽의 통과 수(`passed/trials`)와 달라졌으면 표시. judge item은 check id별로 verdict를 `a → b`로 쓴다(trial이 여럿이면 verdict 목록).
     5. `## 수치`: `sumMetrics`한 두 run의 `tokens`(input, output, cache_read, cache_write), `input_total`, `cache_hit_rate`, `cost_usd`, `time_ms.turns`, `time_ms.model_calls`, `tools`(counted, format, success, blocked, repeated_calls, max_repeat, repeated_failure_turns), `truncated_calls`, `agent_calls` 수를 `a | b | 차`로. trial 수가 다르면 trial 수를 위에 적는다.
   - registry에 없는 entry(옛 n의 content가 지워진 경우 등)는 `내용 없음`으로 적고 멈추지 않는다.
5. **CLI** (`main.ts`). `deno run --allow-all tests/eval/scorecard/main.ts`가 아래를 한다.
   - 인자 없음: scorecard를 쓴다. 시나리오를 `tests/eval/scenarios/**/*.scenario.ts`에서 읽어(`Deno.readDir`로 걷고, 각 file을 동적 import해서 `default`를 시나리오로 쓴다. 같은 폴더의 `common.ts` 같은 helper는 시나리오가 아니다) `Current.scenarios`를 만든다. 이유: 시나리오 찾는 일은 runner 몫이지만 이 task는 runner를 기다리지 않는다. 약 15줄이라 따로 둔다. `versions`는 `currentVersions({ root: repo root, registryDir: "tests/eval/registry" })`, `judge`는 `latestEntry(registryDir, "judge", "judge")`가 있으면 그 `VersionRef`, 없으면 null, `model`은 `--model`(기본 `claude-sonnet-5-5`). 날짜는 `systemClock.now()`의 앞 10자. 결과는 `tests/eval/scorecards/<날짜>.md`에 쓰고(같은 날 다시 돌리면 덮는다), 쓴 경로를 찍는다.
   - `diff <runIdA> <runIdB>`: `tests/eval/runs/<id>.json` 둘을 읽어 `diffRuns`의 결과를 stdout으로 찍는다. 파일을 쓰지 않는다.
   - 이 file 말고 `deno.json`의 task를 더하지 않는다. lead가 등록한다.
6. test (아래 "끝남"의 위험 test)를 `tests/eval/scorecard/scorecard_test.ts`에 쓴다. `deno task check`가 이 test를 돌리므로 순수해야 한다. 파일 시스템, 시각, core, subprocess, network를 쓰지 않고 손으로 만든 `RunRecord`와 `Current`만 쓴다.

## 정한 것

brief가 이미 정한 것이다. 다르게 하려면 이유를 보고에 적는다.

- 낡음의 기준은 run이 본 version이 지금 checkout의 version과 같은가다. 이유: roadmap이 "옛 component나 core 버전을 본 run은 낡았다고 표시만 한다"고 했고, run은 진짜 model이 본 component만 갖고 있어(roadmap "run") 그 목록만 비교하면 상관없는 skill을 고친 run은 낡아지지 않는다.
- 기준 구성은 "지금 checkout"이다(`currentVersions`). 채택된 component 목록을 따로 두지 않는다. 이유: 이 계획은 variant가 지금 checkout뿐이다(README "정한 것"). 기준 구성을 바꾸는 일은 `eval-experiment`가 한다.
- scorecard는 trial을 합쳐 보인다. trial별 표는 두지 않는다. 이유: 기본이 trial 1번이라 한 줄이면 충분하다.
- CLI가 시나리오를 직접 import한다(`**/*.scenario.ts`). 이유: 위 5번.
- diff의 줄 비교는 직접 쓴 LCS다. 이유: `deno.json`에 diff 라이브러리가 없고 의존성을 늘리지 않는다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test (`scorecard_test.ts`, `pickRows` 하나에 모은다):
  - "본 version이 지금과 모두 같은 run만 유효하고, 시나리오마다 그중 가장 늦은 것을 고르며, 하나라도 다르면 낡음 이유를 담는다": run 셋(옛 `instruction:lophn@3`을 본 run, 지금 버전을 본 옛 run, 지금 버전을 본 최신 run)과 `Current`로 `pickRows`. 본 적 없는 component(`skill:...`)가 바뀌어도 낡지 않고, `checks@n`이 다르면 낡는 것도 같은 test에서 본다.
- 남지 않음: 해당 없음(새 코드).

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: `deno.json`의 task `eval:scorecard`(`deno run --allow-all tests/eval/scorecard/main.ts`)
- 안 쓰게 된 export: 없음
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 넘길 줄: 남의 file을 최소로 맞춘 곳
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- **무겁게 짠 것**: 가장 단순한 구현보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것. 없으면 "없음"
