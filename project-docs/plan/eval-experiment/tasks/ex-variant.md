# ex-variant

core를 다른 checkout(git worktree)에서 띄우는 길과, 그 checkout에서 버전을 재는 길을 만든다. grader(시나리오, check, criterion, judge, registry)는 늘 지금 checkout에서 쓴다. variant는 "일하는 쪽"만 바꾼다.

- 단위: ex-variant (wave 2)
- 선행: 없음
- 소유(이 task만 고친다):
  - `tests/eval/experiment/variant/**`
  - `tests/support/core/{mod,process}.ts` (core를 띄울 checkout을 고르는 옵션 하나만 더한다. 지금 이 두 file을 소유한 task는 없다)
  - `tests/eval/versions/**` (아래 "할 일 6"의 최소 수정만. eval-base `ev-versions`가 land한 코드가 이미 같은 일을 하면 건드리지 않는다)
- 읽을 것:
  - 설계 정본: `project-docs/products/roadmap/eval.md`의 "domain model"(grader는 대상의 checkout에서 가져오지 않는다), "버전"(variant는 제품이 값을 정하는 길로만 바꾼다, 재료는 checkout이 달라도 같은 재료로 돈다, route가 크게 다르면 되살리기가 깨지고 runner는 이유를 찍고 멈춘다), "지켜야 할 것"
  - 계획: `project-docs/plan/eval-experiment/README.md`("variant"), `project-docs/plan/eval-base/README.md`("정한 것"의 variant)
  - architecture: `project-docs/architecture/testing.md`("`tests/support`", "E2E 실행 폴더")
  - eval-base brief: `ev-versions.md`(`Deps`, `currentVersions`, `seenComponents`, `checksVersion`, `coreVersion`, `captureSource`, `classifyPath`), `ev-provider.md`(설정 key를 문자열로 쓴 이유: variant core 코드에 기대지 않으려는 것), `ev-restore.md`(재료 hash 규칙을 core 코드에서 import하지 않고 따로 둔 이유)
  - 코드: `tests/support/core/process.ts`(`REPO`, `MAIN`, `spawnCore`가 `cwd: REPO`로 `deno run --allow-all <REPO>/packages/core/main/daemon/main.ts --port=0`을 띄운다), `tests/support/core/mod.ts`(`BootOptions`, `startCore`, `bootCore`), `tests/support/core/try-boot.ts`, `tools/worktree-prep.ts`(worktree에 shell main의 `node_modules`를 main checkout에서 잇는다. git worktree가 아니면 실패), `tests/support/coding/deps.ts`(`e2eDenoDir` = 그 checkout의 `.dev-data/e2e/deno-dir`)
- 계약:
  - 쓰는 것:
    - `packages/base/mod.ts`의 `Result`, `ok`, `err`
    - `tests/support/core/mod.ts`의 `Run`, `Core`, `BootOptions`, `bootCore`
    - eval-base `tests/eval/versions/mod.ts`: `Deps`(`{ root?, registryDir? }`). 이 task가 `Deps`에 칸 둘(`checksRoot?`, `texts?`)을 더한다(할 일 6).
  - 내놓는 것(`tests/eval/experiment/variant/mod.ts`). ex-gate, ex-cli, ex-assembly가 기댄다:
    ```ts
    export type Variant = {
      root: string;          // 절대 경로(symlink를 푼 값). 지금 checkout이면 그 root
      isCurrent: boolean;    // checkout을 안 줬거나 지금 checkout과 같은 경로
      // component, core, source를 variant에서 잰다. registryDir과 checksRoot는 늘 지금 checkout이다.
      versionDeps: Deps;     // { root: variant.root, registryDir: <지금>/tests/eval/registry, checksRoot: <지금>, texts? }
      // checks, 시나리오 hash, criterion, judge를 잰다. 늘 지금 checkout이다.
      graderDeps: Deps;      // { root: <지금>, registryDir: <지금>/tests/eval/registry }
      boot(run: Run, options?: BootOptions): Promise<Core>;   // bootCore(run, { ...options, repo: isCurrent ? undefined : root })
    };
    export type VariantIo = { ... };   // 아래 할 일 3. test가 가짜를 넣는다
    export function resolveVariant(
      args: { checkout?: string; current: string },
      io?: VariantIo,
    ): Promise<Result<Variant>>;       // 거절은 invalid_input, prepare나 texts를 못 얻으면 unavailable
    export function explainBreak(variant: Variant, step: "boot" | "restore", cause: string): string;
    ```
    - `explainBreak`는 variant가 지금 checkout이 아닐 때 "variant <root>의 core로 <step>하다 멈췄다: <cause>. 지금 checkout의 protocol·route와 달라서일 수 있다(grader는 지금 checkout의 protocol로 부른다)."를, 지금 checkout이면 cause만 돌려준다. 호출하는 쪽(ex-gate, ex-cli)이 되살리기와 boot 오류에 붙여 찍고 멈춘다.
    - `tests/support/core`: `BootOptions.repo?: string`.

## 알아 둘 코드 사실

- core는 `spawnCore`가 `REPO`(= `tests/support/core/process.ts`가 있는 checkout)의 `packages/core/main/daemon/main.ts`를 `cwd: REPO`로 띄운다. 그래서 지금은 `tests/support`를 import한 checkout의 core만 뜬다. variant는 이 `REPO`를 고르는 것 하나면 된다. core가 띄우는 agent runtime, app supervisor는 daemon 코드가 자기 checkout에서 띄우므로 따라온다. cwd가 variant라서 `deno.json`, `deno.lock`(frozen)도 variant 것을 쓴다.
- eval의 route 호출은 지금 checkout의 `packages/protocol`로 한다. variant가 protocol이나 route를 바꿨으면 되살리기가 `invalid_input`이나 `not_found`로 깨진다. 이것은 막지 않고 이유를 찍고 멈춘다(roadmap). 제품에 호환 장치를 두지 않는다.
- ev-versions의 `instruction`과 `guide`는 `rolePrompt(role)`, `guideText(topic)`를 import해서 잰다(`packages/core/agent-roles/roles/prompts.ts`, `guides.ts`가 `.md`를 `with { type: "text" }`로 묶어 가져온다). import는 지금 프로세스의 checkout 것이다. 그대로면 variant core가 보낸 요청 body의 role 블록이 지금 checkout의 `rolePrompt`와 달라 `seenComponents`가 `invalid_input`으로 거절한다(ev-versions "role 블록이 어느 role과도 같지 않은 body는 거절한다"). 그래서 variant의 글을 따로 읽어 `Deps.texts`로 넘겨야 한다.
- `currentVersions(deps)`는 `checks`도 잰다(`checksVersion`이 `<root>/tests/eval/checks/**`를 hash하고 registry에 n을 붙인다). variant root를 그대로 주면 variant의 (없거나 옛) checks를 registry에 새 n으로 올려 버린다. 그래서 `checksRoot`가 필요하다.
- `tests/support/coding/deps.ts`의 `e2eDenoDir()`는 그 checkout의 `.dev-data/e2e/deno-dir`다. `.dev-data/`는 git이 무시하므로 새 worktree는 비어 있다.

## 할 일

1. **core를 띄울 checkout 고르기** (`tests/support/core/process.ts`, `mod.ts`).
   - `spawnCore(home, userHome, logPath, env = {}, repo = REPO)`: `MAIN`을 `${repo}/packages/core/main/daemon/main.ts`로, `cwd`를 `repo`로 한다. `REPO`의 기본 값은 그대로 둔다.
   - `BootOptions`에 `repo?: string`을 더한다(주석: 다른 checkout(worktree)의 core를 시험할 때만 준다. 기본은 이 file이 있는 checkout). `startCore`가 `spawnCore`에 넘긴다. `bootCore`, `tryBootCore`는 `BootOptions`를 그대로 넘기므로 따로 안 고친다. 기본 동작은 바뀌지 않으므로 e2e를 고치지 않는다.
2. **variant 이음** (`variant/mod.ts`). `resolveVariant`:
   1. `checkout`이 없거나 `Deno.realPath(checkout)`이 `current`의 realPath와 같으면 `isCurrent: true`, `versionDeps = graderDeps = { root: current, registryDir: `${current}/tests/eval/registry` }`, `texts` 없음. prepare를 하지 않는다. 이유: 지금 checkout에 `worktree-prep`을 돌리면 안 된다.
   2. 아니면 `realPath`가 없으면 `invalid_input`("checkout이 없다"). `git -C <path> rev-parse --show-toplevel`이 그 path와 다르면 `invalid_input`("git checkout의 최상위가 아니다"). `<path>/packages/core/main/daemon/main.ts`가 없으면 `invalid_input`.
   3. `prepareVariant(path, current, io)`(할 일 4) → `variantTexts(path, io)`(할 일 5). 실패하면 `unavailable`.
   4. `versionDeps = { root: path, registryDir: <지금>/tests/eval/registry, checksRoot: <지금>, texts }`, `graderDeps = { root: <지금>, registryDir: <지금>/tests/eval/registry }`.
   - 이유: registry는 전역 이름 표라 지금 checkout의 것 하나뿐이다. variant의 `tests/eval/registry` 사본에 쓰면 그 worktree를 지울 때 버전 표가 사라진다.
3. **io 주입** (`VariantIo`): `realPath`, `gitToplevel(path)`, `exists(path)`, `run(cmd: string[], cwd: string): Promise<{ code: number; stdout: string; stderr: string }>`, `symlink`, `mkdir`. 기본 값은 `Deno.*`와 `Deno.Command`다. test가 가짜를 넣는다(subprocess를 띄우는 test는 쓰지 않는다).
4. **prepare** (`variant/prepare.ts`). 이미 한 일이면 다시 해도 같다(idempotent).
   - `deno run --allow-all <지금>/tools/worktree-prep.ts <path>`를 cwd `<지금>`에서 돌린다. 실패하면 stderr를 담아 `unavailable`. 이유: worktree가 `npm ci` 없이 check를 돌게 하는 도구라 gate의 `deno task check`가 필요로 한다.
   - e2e deno-dir: `<path>/.dev-data/e2e/deno-dir`가 없고 `<지금>/.dev-data/e2e/deno-dir`가 비어 있지 않으면 `<path>/.dev-data/e2e/`를 만들고 그 폴더로 symlink한다. 이유: gate의 e2e가 variant의 `tests/support/coding/deps.ts`로 이 폴더를 읽는다. cache라 같이 써도 된다. 지금 checkout 쪽도 비었으면 아무것도 하지 않는다(e2e가 `deno task e2e:deps`를 하라고 스스로 알린다).
   - core 입구 cache: cwd `<path>`에서 `deno cache packages/core/main/daemon/main.ts packages/core/main/agent-runtime/main.ts packages/core/main/app-supervisor/main.ts`. 이유: variant가 의존을 새로 더했으면 첫 boot가 내려받느라 hello 제한(30초, `HELLO_TIMEOUT_MS`)을 넘긴다. 실패하면 `unavailable`.
5. **variant의 글 읽기** (`variant/texts.ts`). `variantTexts(root, io): Promise<Result<VariantTexts>>`.
   - `VariantTexts = { role_prompts: Record<string, string>; guides: Record<string, string> }`. 이 type은 `tests/eval/versions`의 `Deps` 옆에 둔다(할 일 6). role id는 `lophn`, `project_manager`, `app_engineer`, `operator`, guide는 `guideTopics()` 전부.
   - cwd를 `root`로 하고 `deno eval`로 variant의 `./packages/core/agent-roles/roles/prompts.ts`(`rolePrompt`는 `Result<string>`을 돌려준다), `./packages/core/agent-roles/roles/guides.ts`(`guideTopics`, `guideText`)를 import해 위 값을 JSON 한 줄로 찍게 한다. stdout을 parse한다. 실패나 `!ok`면 `unavailable`("variant의 role prompt를 읽지 못했다: ..."). 이유: `.md`를 text로 묶어 가져오는 코드라 지금 프로세스에서 variant file을 dynamic import하면 import map(`deno.json`)이 어느 checkout 것인지 흐려진다. 그 checkout의 cwd에서 따로 돌리는 것이 가장 단순하다.
6. **ev-versions 최소 수정** (`tests/eval/versions/**`). 이미 landed 코드가 아래를 하면 건너뛰고 보고에 적는다.
   - `Deps`에 `checksRoot?: string`(기본 `root`)과 `texts?: VariantTexts`를 더한다. `checksVersion(deps)`는 `deps.checksRoot ?? deps.root`를 쓴다. `currentVersions`는 그 `Deps`를 `checksVersion`에 그대로 넘긴다.
   - `instruction`과 `guide` 측정, `seenComponents`의 role 블록 대조, 연 guide 확인이 `rolePrompt`/`guideText`/`guideTopics`를 부르는 자리에서 `deps.texts`가 있으면 그것을 쓴다(`texts.role_prompts[role]`, `texts.guides[topic]`). 없으면 지금처럼 import를 쓴다.
   - 기존 test는 그대로 통과해야 한다. 새 칸을 쓰는 test는 하나(아래 위험 test 3)만 더한다.
7. `variant/mod.ts`가 위 export를 모두 내보낸다. `explainBreak`는 순수 함수다.
8. test (`variant/variant_test.ts`): 순서는 "끝남". `VariantIo`는 가짜(`run`은 호출을 기록만 하고 성공)를 넣는다.

## 정한 것

- 다른 checkout의 core를 띄우는 길은 `BootOptions.repo` 하나다. 이유: 제품에 eval 전용 flag를 두지 않는다(roadmap). `tests/support`는 test 쪽 코드라 옵션을 더해도 된다.
- 버전 측정은 `Deps.root`(= variant), registry와 checks는 `Deps.registryDir`·`checksRoot`(= 지금)로 갈랐다. 이유: grader는 대상의 checkout에서 가져오지 않는다(roadmap). 같은 이유로 `resolveVariant`는 시나리오와 criterion을 variant에서 읽지 않는다. 호출하는 쪽이 `graderDeps`를 쓴다.
- variant의 글은 `deno eval` 하위 process로 읽는다. 이유: 위 "알아 둘 코드 사실". 요청마다가 아니라 variant당 한 번이다.
- 지금 checkout과 variant가 모두 같은 git repo의 worktree인 경우만 지원한다(`worktree-prep`이 그렇다). 이유: 계획의 쓰임이 worker의 worktree를 시험하는 것이다.

## 끝남

- `deno task check`가 통과한다. `tests/e2e`는 고치지 않았고 기본 동작이 같다(`deno task e2e`를 한 번 돌릴 필요는 없다. `repo`를 안 주면 코드 경로가 같다).
- 위험 test(`variant/variant_test.ts`, 순수, 가짜 `VariantIo`):
  1. "다른 checkout을 줘도 버전 registry와 checks를 재는 root와 grader의 root는 지금 checkout이고, component와 core, source를 재는 root만 variant다": `resolveVariant`가 돌려준 `versionDeps`, `graderDeps`. grader가 대상 checkout에서 오면 점수를 올리려고 check를 같이 고칠 수 있고, registry를 variant에 쓰면 worktree를 지울 때 버전 표가 사라진다.
  2. "git 최상위가 아닌 경로, core 입구가 없는 경로는 prepare를 부르기 전에 거절하고, 지금 checkout과 같은 경로는 prepare 없이 current로 돌려준다": 가짜 `run` 호출 기록을 본다. `worktree-prep`이 main checkout에 도는 것을 막는다.
  3. (`tests/eval/versions/*_test.ts`에 한 줄 더함) "`texts`를 주면 `seenComponents`가 variant의 role prompt와 같은 body를 거절하지 않는다": 임시 root. 할 일 6을 이 task가 했을 때만.
- 새 subprocess·서버·브라우저를 띄우는 test는 만들지 않는다. 실제 worktree에서 core가 뜨는지는 손으로 한 번 본다(아래 보고).
- 손 확인(provider 없이): `git worktree add`한 worktree에서 `resolveVariant`를 부르는 짧은 script(임시, 커밋하지 않는다)로 `variant.boot(await createRun())`가 hello를 받고 `stop()`이 child를 남기지 않는 것을 본다. 이어서 같은 variant로 ev-restore의 `beginRestore` → `restoreWorld(["apps-home@1"])`가 되는지 본다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: 없음(`tests/eval/experiment/variant/`는 data 폴더가 아니다)
- 안 쓰게 된 export: 없음
- 정한 것: 위 "정한 것"과 다르게 한 것, `Variant`·`VariantIo`·`VariantTexts` 꼴이 달라졌으면 그 이유, ev-versions 수정(할 일 6)을 한 것인지 이미 있던 것인지
- 넘길 줄: `tests/eval/versions/**`를 고친 곳
- 계약 바꾸기 요청: 고정된 계약(`tests/eval/types.ts`)을 바꿔야 하면 여기 적는다
- **무겁게 짠 것**: 없으면 "없음"
- **알려진 미완 동작**: variant가 protocol·route를 바꾸면 되살리기가 깨진다(막지 않고 `explainBreak`로 멈춘다). worktree가 아닌 checkout(복사한 폴더)은 지원하지 않는다. coding agent의 `lophn` wrapper(eval-coding의 driver)가 어느 checkout의 CLI를 부르는지는 이 task가 정하지 않는다. ec-driver는 checkout root를 인자(`repoRoot`)로 받으므로 ex-cli가 `variant.root`를 넘기고, wrapper 폴더(`binDir`)는 variant마다 따로 둔다.
