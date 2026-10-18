# ex-gate

harness를 고친 checkout을 진짜 model로 돌리기 전에 거르는 gate 세 단계를 만든다: `deno task check` → 바뀐 곳의 e2e → 고른 시나리오의 dry run. 앞 단계가 실패하면 뒤 단계를 돌리지 않는다. 입구(`deno task eval:gate`)는 ex-cli가 만든다. 이 task는 단계들의 순수한 판단과 주입 가능한 실행 함수를 만든다.

- 단위: ex-gate (wave 2)
- 선행: ex-spec. 이 task의 코드는 spec type을 import하지 않는다(dry run할 시나리오 목록은 호출하는 쪽이 준다). 선행은 README 표대로 둔다.
- 소유(이 task만 고친다):
  - `tests/eval/experiment/gate/**`
- 읽을 것:
  - 설계 정본: `project-docs/products/roadmap/eval.md`의 "역할과 흐름"(gate 세 단계, "instruction 글만 고쳤다면 2는 거의 비고 3이 주로 일한다. tool definition이나 runtime을 고쳤다면 2가 중요하다")
  - 계획: `project-docs/plan/eval-experiment/README.md`("gate")
  - architecture: `project-docs/architecture/testing.md`("층", "가짜 셋", "돌리는 때": e2e는 file 순서대로 돌고 전체가 10분 안이어야 한다)
  - catalog: `project-docs/module-catalog.yaml`(`modules[].path` → `boundary`), `project-docs/boundary-catalog.yaml`(`elements`의 `children` tree. `tools/check-modules.ts`가 같은 tree를 읽는 본보기)
  - 코드: `tools/check.ts`의 `changedFiles`(바뀐 file을 `git merge-base HEAD main`부터의 `git diff --name-only`와 `git ls-files -o --exclude-standard`로 정한다. 같은 규칙을 쓴다), `deno.json`의 `e2e` task(`deno test --allow-all --no-check tests/e2e`), `tests/e2e/*_test.ts`의 머리 주석(`// - contract: boundary \`router\`(...), \`agent-sessions\`(...)` 꼴)
  - eval-base brief: `ev-restore.md`(`beginRestore`, `restoreWorld`, `endRestore`, 재료 hash 확인), `ev-checks.md`(`validateFixtures`), `ev-runner.md`("할 일 3"의 trial 순서 1~2), `ev-versions.md`(`classifyPath`, `Git`, `denoGit`)
  - eval-experiment: `ex-variant.md`(`Variant`, `explainBreak`)
- 계약:
  - 쓰는 것:
    - `packages/base/mod.ts`의 `Result`, `ok`, `err`. `@std/yaml`의 `parse`(root `deno.json` imports에 있다).
    - `tests/eval/versions/mod.ts`: `classifyPath(rel): FileGroup`, `type Git`.
    - `tests/eval/types.ts`: `Scenario`.
    - `tests/eval/checks/mod.ts`: `validateFixtures(scenarios): Promise<{ ok: boolean; problems: string[] }>`. 이 task는 주입받는다.
  - 내놓는 것(`tests/eval/experiment/gate/mod.ts`). ex-cli가 부른다:
    ```ts
    export type StageName = "check" | "e2e" | "dry-run";
    export type StageResult = { name: StageName; ok: boolean; skipped: boolean; detail: string; ms: number };
    export type GateReport = { ok: boolean; stages: StageResult[]; e2e: string[] };   // e2e: 고른 file 목록(빈 배열이면 비었다)
    export type GateDeps = {
      run(cmd: string[], cwd: string, timeoutMs: number): Promise<{ code: number; output: string }>;  // stdout+stderr
      git: Git;                                             // cwd가 variant인 git
      readText(path: string): Promise<string>;
      listFiles(dir: string): Promise<string[]>;            // 폴더의 file 이름
      validateFixtures(scenarios: Scenario[]): Promise<{ ok: boolean; problems: string[] }>;
      // 시나리오 하나의 재료 되살리기와 setup까지(진짜 model 없이). 끝나면 core를 끄고 run을 지운다. 던지지 않는다.
      dryRun(scenario: Scenario): Promise<Result<void>>;
      now(): number;
      catalogRoot: string;                                  // module-catalog.yaml, boundary-catalog.yaml을 읽는 root. 늘 지금 checkout
    };
    export function runGate(
      input: { checkout: string; base?: string; scenarios: Scenario[] },
      deps: GateDeps,
    ): Promise<GateReport>;
    export function defaultGateDeps(
      base: Pick<GateDeps, "validateFixtures" | "dryRun" | "catalogRoot">,
      checkout: string,
    ): GateDeps;
    export function selectE2e(input: SelectInput): E2eSelection;     // 순수. 아래 할 일 2
    ```
    - `dryRun`은 ex-cli가 runner의 "trial 앞부분"(`createRun` → `variant.boot` → `beginRestore` → `restoreWorld` → `scenario.setup` → `endRestore`, 끝나면 `core.stop()`, `run.remove()`)을 떼어 낸 함수로 만들어 넘긴다. 이 함수는 trial과 같은 boot 옵션(settings, ec-runner의 `restoreCoreEnv(refs)` env)을 쓴다(ex-cli가 `bootOptionsOf`를 둘이 같이 쓰게 한다). active app 재료가 든 시나리오가 trial과 다른 환경에서 dry run되지 않게 하려는 것이다. 이 task는 그것을 만들지 않는다(runner는 ex-cli 소유다).

## 할 일

1. **바뀐 file** (`gate/changes.ts`). `changedFiles(git, base?)`: `tools/check.ts`와 같은 규칙. `rev = base ?? merge-base HEAD main(없으면 HEAD)`, `git diff --name-only <rev>`와 `git ls-files -o --exclude-standard`를 합치고 `node_modules`가 든 경로를 뺀다. `git`은 cwd가 variant다(`denoGit(checkout)`). 이유: 지금 checkout이면 working tree의 변경이, worktree이면 branch의 commit과 working tree의 변경이 같은 규칙으로 잡힌다.
2. **e2e 고르기** (`gate/e2e.ts`, 순수 함수). roadmap은 "바뀐 component의 module에 걸린 e2e"라 한다. component 이름이 아니라 **바뀐 file**에서 출발한다. 이유: component → file 표가 이미 `classifyPath`로 있고, file → module은 module-catalog의 path 접두로 끝난다. 두 표를 또 만들지 않는다.
   ```ts
   export type SelectInput = {
     files: string[];                       // 바뀐 file(repo root 기준)
     modules: { path: string; boundary: string | null }[];   // module-catalog.yaml의 modules
     tree: Record<string, string[]>;        // boundary id → 자식 id (boundary-catalog.yaml의 elements를 재귀로 편 것)
     e2e: { file: string; boundaries: string[] }[];           // tests/e2e/*_test.ts와 머리 주석에서 읽은 boundary id
   };
   export type E2eSelection = { files: string[]; all: boolean; reasons: string[] };   // reasons: "<변경 file> → <module> → <boundary>" 한 줄씩
   export function parseCatalog(
     moduleYaml: string,
     boundaryYaml: string,
   ): Pick<SelectInput, "modules" | "tree"> & { known: Set<string>; aliases: Record<string, string[]> };
   export function e2eBoundaries(testText: string, known: Set<string>, aliases: Record<string, string[]>): string[];
   ```
   규칙(위에서부터 처음 맞는 줄):
   1. `tests/e2e/<이름>_test.ts`가 바뀌었으면 그 file을 고른다.
   2. `tests/support/**`나 `deno.json`, `deno.lock`이 바뀌었으면 e2e 전부(`all: true`). 이유: 모든 e2e의 바닥이다.
   3. `classifyPath(file).group`이 `instruction`, `guide`, `skill`이면 고르지 않는다. 이유: e2e는 fake model을 쓰므로 진짜 model이 읽는 글은 e2e에 닿지 않는다(roadmap "instruction 글만 고쳤다면 2는 거의 비고").
   4. 그 밖의 `tests/`, `tools/`, `project-docs/`, `packages/shell/**`, `packages/design/**`는 고르지 않는다.
   5. `packages/` 아래 file은 `modules` 가운데 path가 가장 긴 접두(`file === path` 또는 `file.startsWith(path + "/")`)를 찾는다. 못 찾으면 e2e 전부(fail-safe: 어떤 module에도 안 드는 제품 file은 돌려서 본다).
   6. module의 boundary가 `base`, `protocol`, `sdk`이면 e2e 전부. 이유: 모든 package가 쓰는 library라 어느 e2e가 닿는지 boundary로 좁힐 수 없다.
   7. 그 밖은 boundary와 그 **자손**(`tree`) 전부의 집합을 만들어, `e2e[].boundaries`와 하나라도 겹치는 file을 고른다. 이유: `packages/core/apps`의 boundary는 `apps`인데 e2e 머리 주석은 `app-releases`, `app-runtime` 같은 자손 ID를 쓴다. 자손을 포함하면 `core`(main, wiring)를 고쳤을 때 e2e 전부가 걸리고, 그것이 맞다.
   - `parseCatalog`: `known`은 elements와 interfaces의 ID 전부, `aliases`는 interface ID → 그 `provided_by`(element ID 목록)다. 예: `event-stream` → `events`, `server`. `defined_by`는 쓰지 않는다(`protocol`이라 전부 걸린다).
   - `e2eBoundaries(text, known, aliases)`: 글에서 `contract:`가 든 주석 줄과 그 줄에 바로 이어지는 `//` 줄들(설명이 다음 줄로 넘어간다)에서 backtick으로 감싼 토큰 가운데 `known`에 있는 것을 모으고, interface ID는 `aliases`의 element ID로 바꾼다. file 전체를 훑어 합집합을 낸다. 이유: `gateway_test.ts`의 머리 주석은 interface `event-stream`, `core-api`만 적는다. 또 e2e file 하나에 `contract` 줄이 여럿이다. 머리 주석의 설명 안에 다른 ID가 섞여도 더 고르는 쪽이라 안전하다. 한 ID도 못 읽은 e2e file은 모든 변경에 고르는 대상으로 취급하고(`boundaries: ["*"]`), 이름을 `reasons`가 아니라 stage 설명에 "contract 줄 없음: <file>"로 남긴다.
   - 결과 file은 이름순, 중복 없음.
3. **단계 실행** (`gate/mod.ts`의 `runGate`). 차례로 돌고, 단계가 실패하면 거기서 끝낸다(뒤 단계는 돌리지 않고 `GateReport.stages`에도 넣지 않는다). `skipped`는 "돌 것이 없어 통과"를 뜻한다. 각 단계의 `ms`는 `deps.now()` 차이다.
   1. `check`: `deno task check`를 cwd `checkout`에서 `run`. `code !== 0`이면 실패, `detail`은 `output` 마지막 2000자. 제한 시간 20분.
   2. `e2e`: `changedFiles(git, base)` → `selectE2e`. 고른 file이 없으면 `{ ok: true, skipped: true, detail: "고른 e2e 없음" }`. 있으면 `deno test --allow-all --no-check <file...>`을 cwd `checkout`에서 `run`(`deno task e2e`와 같은 flag). 제한 시간은 15분. `all`이면 `tests/e2e`를 통째로 준다. `detail`에는 고른 file 수와 `reasons`(최대 10줄), 실패하면 `output` 마지막 2000자.
   3. `dry-run`: ① `deps.validateFixtures(scenarios)`를 한 번(grader는 지금 checkout에서 돈다). `!ok`면 `problems`를 `detail`에 담아 실패. ② 시나리오마다 `deps.dryRun(scenario)`를 차례로(진짜 model도 key도 쓰지 않는다). 하나라도 `!ok`면 시나리오 id와 `error.message`를 모아 실패. `scenarios`가 비면 `skipped`. 이유: 바뀐 checkout에서 되살리기가 깨지거나 check가 오류를 내면 여기서 걸린다(roadmap).
4. **기본 실행 함수** (`gate/exec.ts`, `defaultGateDeps`). `run`은 `Deno.Command`로 stdout과 stderr를 합쳐 읽고, 시간이 지나면 `kill`한다(`AbortSignal.timeout`). `git`은 `denoGit(checkout)`, `readText`와 `listFiles`는 `Deno.*`. 이 file은 test하지 않는다.
5. **catalog 읽기**: `runGate`는 `<deps.catalogRoot>/project-docs/module-catalog.yaml`, `boundary-catalog.yaml`을 읽는다. `catalogRoot`는 지금 checkout이다(variant의 것이 아니다. 이유: 어느 e2e를 돌릴지는 grader 쪽 규칙이다). `tests/e2e/*_test.ts`는 `<checkout>/tests/e2e/`에서 읽는다(그 checkout에서 돌 file이다).
6. `gate/mod.ts`가 위를 모두 내보낸다. 주석은 "왜"만 쓴다.

## 정한 것

- e2e를 고르는 기준은 바뀐 file이다. spec의 "바꾸는 것"(component X@a → X@b)에서 file을 거꾸로 찾지 않는다. 이유: 작업 중 실제로 바뀐 file이 진실이고, spec과 어긋나면(다른 file도 고쳤으면) gate가 더 많이 돌아 안전한 쪽이다. 어긋남 자체는 ex-cli가 `currentVersions` 차이로 따로 알린다.
- 글 component(`instruction`, `guide`, `skill`) file은 e2e를 고르지 않는다. `template`은 앱 e2e가 쓰므로 module로 고른다.
- 앞 단계가 실패하면 멈춘다. 이유: dry run과 e2e는 느리고, check가 깨진 checkout에서는 뜻이 없다.
- dry run은 차례로 돈다(병렬 없음). 이유: 단순함. 시나리오가 많아지면 ex-parallel의 pool을 쓰게 바꾼다.
- gate는 key를 읽지 않는다. `eval:gate` task는 `--env-file`을 쓰지 않는다(ex-cli).

## 끝남

- `deno task check`가 통과한다.
- 위험 test(`gate/gate_test.ts`, 순수. 임시 catalog 글, 가짜 e2e 글, 가짜 `GateDeps`):
  1. "바뀐 file이 어떤 e2e에도 닿지 않아 통과하는 일이 없다": `selectE2e` 표 — 글 component(`packages/core/agent-roles/roles/lophn/prompt.md`)는 비고, `packages/core/lophn-agent/run-loop/...`는 boundary `run-loop` e2e를 고르고, `packages/core/main/...`(boundary `core`)와 `packages/protocol/...`와 `tests/support/...`와 module에 안 드는 `packages/` file은 전부, `tests/e2e/x_test.ts`는 그 file, 자손 ID(`apps` → `app-releases`)로 겹치는 e2e를 고른다. gate가 e2e를 놓치고 통과하면 test가 아니라 진짜 model 비용을 쓴 뒤에야 제품이 깨진 것을 안다.
  2. "앞 단계가 실패하면 뒤 단계를 돌리지 않고, dry run이 한 시나리오라도 실패하면 gate가 실패하고 그 시나리오 id가 이유에 있다": 가짜 `run`/`dryRun` 호출을 기록한다.
- 새 subprocess·서버·브라우저를 띄우는 test는 만들지 않는다.
- 손 확인(provider 없이): `deno run --allow-all`로 임시 script(커밋하지 않는다)에서 `defaultGateDeps`로 지금 checkout의 `selectE2e`만 불러, 방금 바꾼 file 목록에서 고른 e2e와 `reasons`가 말이 되는지 본다. (전체 gate는 ex-cli가 이은 뒤 lead가 돌린다.)

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: 없음
- 안 쓰게 된 export: 없음
- 정한 것: `GateDeps`·`SelectInput`의 꼴을 바꾼 것, 제한 시간, boundary가 `base`·`protocol`·`sdk`일 때 전부 고르는 것 외에 더한 규칙
- 넘길 줄: 없음
- 계약 바꾸기 요청: 없으면 "없음"
- **무겁게 짠 것**: 없으면 "없음"
- **알려진 미완 동작**: e2e를 고르는 정확도는 e2e 머리 주석의 `contract:` 줄에 기댄다(새 e2e가 그 꼴을 안 지키면 모든 변경에 걸린다). dry run은 차례로 돌아 active app 재료가 든 시나리오가 많으면 느리다. 앱 e2e에는 `XDG_RUNTIME_DIR`(user systemd)가 있어야 한다.
