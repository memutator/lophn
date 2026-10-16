# check

`deno task check`를 빠른 check로, `deno task check:full`을 full check로 나눈다. test가 돌리던 구조 검사 둘(CSS 검사, 화면 코드 wording 검사)을 check 단계로 옮기고, 새 worktree가 `npm ci` 없이 check를 돌리게 `tools/worktree-prep.ts`를 만든다.

- 단위: check (wave 0)
- 선행: 없음
- 소유(이 task만 고친다):
  - `tools/check.ts`
  - `tools/check-deps.ts` (`PACKAGE_DEPENDENCIES` export만 더한다)
  - `tools/deps-blueprint.ts`
  - `tools/deps-imports.ts`
  - `tools/deps-workspace.ts`
  - `tools/worktree-prep.ts` (새로)
  - `packages/design/style-check/`
  - `packages/shell/main/package.json`
  - 소유 바꾸기 요청(`../ownership.md`에 넣은 뒤에만 고친다. 안 넣었으면 고치지 말고 보고한다): `tools/check-style.ts`, `tools/check-wording.ts`(둘 다 새로), root `deno.json`의 `tasks` 칸만
  - 예외: style 검사나 wording 검사가 지금 코드에서 위반을 내면, 위반 줄만 고치는 것을 허용한다(아래 할 일 3). 소유 밖 file이라 보고에 목록을 적는다.
- 읽을 것:
  - dev: `/home/pyosechang/projects/lophn/project-docs/dev/testing.md` "check 파이프라인", `/home/pyosechang/projects/lophn/project-docs/dev/code-map.md` "package 사이 import"
  - 계획: `../README.md` 2.1의 "빠른 check", `../orchestrator.md` 4.2(worktree 준비)와 6장(merge 흐름)
  - inventory: 없음 (`../assignment.md` check 단위는 0줄이다)
  - 옛 검사 코드(되살릴 근거): `git show d71e31d8:packages/design/wording/testing/repo-check.ts`, `git show d71e31d8:packages/design/wording/check_test.ts`(`checkRepo`를 쓰는 test 둘), `git show d71e31d8:packages/design/style-check_test.ts`
  - 지금 코드: `tools/check.ts`, `packages/design/style-check/{mod,model,work}.ts`, `packages/design/wording/check.ts`(`checkScreens`, `errorsOf`), `packages/design/wording/generate.ts`, `packages/design/generate.ts`, `packages/shell/main/package.json`
- 계약:
  - 쓰는 것:
    - `packages/design/style-check/mod.ts`의 `checkRepositoryStyles(root: URL)`
    - `packages/design/wording/check.ts`의 `checkScreens(root, options)`와 `errorsOf`. `options.knownKeys`에 `RESERVED_PROBLEM_CODES.map((c) => c.message_key)`(`packages/protocol/problems/mod.ts`)를 넘긴다.
    - wording 생성 CLI: `deno run --allow-read packages/design/wording/generate.ts --check`. wording-split task가 영역별 생성으로 바꿔도 이 명령과 `--check` 뜻(생성물이 낡았으면 실패)은 그대로다.
  - 내놓는 것: `deno task check`, `deno task check:full`, `deno task wording`(wording 생성), `deno run -A tools/worktree-prep.ts <worktree 경로>`. 오케스트레이터가 이 이름들을 쓴다.

## 할 일

1. **`tools/check.ts`를 다시 쓴다** (`testing.md` check 파이프라인, `../README.md` 2.1).
   - 모드: `deno task check`(빠른), `deno task check:full`(`--full`). 옵션 `--base <rev>`.
   - 바뀐 파일: base는 `git merge-base HEAD main`(없으면 `HEAD`). `git diff --name-only <base>`(commit 안 된 것 포함)에 `git ls-files -o --exclude-standard`(새 file)를 더한다.
   - base와 비교해 바뀐 file이 없으면(main 위에서 막 merge한 경우) 전부 바뀐 것으로 본다. 오케스트레이터가 merge 뒤 main에서 `deno task check`를 돌리므로 그때는 전부 돌아야 한다. 이 규칙을 화면 출력 첫 줄에 적는다("바뀐 package: 전부 (비교 기준 없음)").
   - 바뀐 file을 package로 옮긴다. 표는 `tools/check-deps.ts`의 `PACKAGE_DEPENDENCIES`(export로 바꾼다)와 같은 이름을 쓴다.

     | package | 폴더 | 쓰는 package |
     |---|---|---|
     | base | `packages/base` | — |
     | protocol | `packages/protocol` | base |
     | core | `packages/core` | protocol, base |
     | coding-agent | `packages/coding-agent` | protocol, base |
     | design | `packages/design` | — |
     | sdk | `packages/sdk` | protocol, design |
     | shell | `packages/shell` | protocol, base, design, coding-agent (terminal host가 쓴다) |
     | tools | `tools` | 전부 (`tools/wireframes`, `dev.ts`가 packages를 넓게 쓴다) |

     바뀐 package와, 그것을 (간접으로라도) 쓰는 package가 "돌 package"다. `deno.json`, `deno.lock`, `tools/check*.ts`가 바뀌면 전부다.
   - 단계는 아래다. 독립인 단계는 동시에 돈다. 각 단계는 stdout과 stderr를 모아 두었다가 실패했을 때만 출력한다.

     | 단계 | 명령 | 빠른 check에서 도는 때 |
     |---|---|---|
     | fmt | `deno fmt --check <돌 package 폴더>` | 항상 (돌 package가 있을 때) |
     | lint | `deno lint <돌 package 폴더>` | 같음 |
     | deps | `deno run --allow-read tools/check-deps.ts` | 항상 |
     | check | package마다 `deno check <그 package의 .ts/.tsx>` | 돌 package마다 |
     | style | `deno run --allow-read tools/check-style.ts` | design, sdk, shell이 돌 때 |
     | wording | `deno run --allow-read tools/check-wording.ts` | 같음 |
     | wording 생성 | `deno run --allow-read packages/design/wording/generate.ts --check` | design이 돌 때 |
     | token 생성 | `deno run --allow-read --allow-run packages/design/generate.ts --check` | design이 돌 때 |
     | shell main | 아래 3번 | shell, protocol, base, design, coding-agent 중 하나가 돌 때 |
     | test | `deno test --no-check --allow-all --permit-no-files <돌 package 폴더>` | 위 단계가 모두 통과한 뒤(2단계) |

   - `deno check`: 빠른 check는 package별로 나눠 동시에 돌린다. `packages/shell`의 `main`과 `preload`는 deno 설정이 제외한다(root `deno.json`의 `exclude`). 글로브 인자에서 그 exclude가 안 먹으면 `git ls-files`로 만든 file 목록을 인자로 준다. full check는 지금처럼 인자 없는 `deno check` 하나다(workspace 전체와 tools).
   - 첫 실패에서 멈춘다. 한 단계가 실패하면 도는 다른 child에 `kill("SIGTERM")`을 보내고, 실패한 단계의 출력을 보여 준 뒤 결과 표를 낸다. 종료 code는 1이다. 모두 통과하면 단계별 걸린 시간이 든 표만 낸다.
   - full check(`--full`): 위 단계를 전부 돈다(돌 package 대신 전부). test는 `deno test --no-check --parallel --allow-all --permit-no-files`이고 `DENO_JOBS`가 환경에 없으면 8을 준다. test는 check 단계들이 통과한 뒤에 돈다(`testing.md`: "`deno check`가 끝난 뒤라 test는 `--no-check`").
   - 지금 `runSteps`/`Decision.before`/`when` 구조와 `Runner` 주입은 test를 위한 것이었다. 새 구조에 필요 없으면 지운다.
   - 결과 표의 한국어 열 이름(단계, 결과, 비고)과 상태 말(통과, 실패, 건너뜀)은 그대로 쓴다.
2. **test는 check가 통과한 뒤 2단계로 돈다.** (1번 표의 마지막 줄) 돌 package에 `_test.ts` file이 하나도 없으면 `--permit-no-files`로 통과한다.
3. **구조 검사 둘을 check 단계로 옮긴다.**
   - `tools/check-style.ts`: `checkRepositoryStyles(new URL("../", import.meta.url))`를 부르고, 위반을 `file:line reason`으로 한 줄씩 낸 뒤 있으면 종료 code 1이다. `packages/design/style-check/work.ts`가 shell renderer, design, `sdk/ui-*`의 `.css`를 본다. 되살릴 test는 없다(`style-check_test.ts`와 `testdata/`는 이미 지웠다). 위험한 규칙이 아니라 구조 검사라서 test로 되살리지 않는다.
   - `tools/check-wording.ts`: `checkScreens(root, { knownKeys: <problem code message key> })`를 부르고 `errorsOf(...)`가 있으면 `file:line [rule] message`로 낸 뒤 종료 code 1이다. 경고(warning)는 개수만 출력하고 실패하지 않는다. d71e31d8의 `testing/repo-check.ts`는 `checkRepo`가 이 일을 했다. 그 file이 `protocol/problems`를 import해서 앱 SDK 사본(`@lophn/wording`)에 못 넣는 것이 이유로 `wording/testing/`에 따로 있었다. 지금은 `tools/`에 두면 그 문제가 없다. `wording/` 폴더에는 아무것도 되살리지 않는다(wording-split이 그 폴더를 가진다).
   - 두 검사는 d71e31d8 시점에는 test로 통과했다. 지금 위반이 나오면 그 뒤 삭제 때문이다. 위반이 코드나 CSS 줄이면 그 줄만 고친다(색·길이는 token으로, 직접 문구는 key로). 값의 뜻을 바꾸지 않는다.
4. **shell main의 두 번째 check를 줄인다.** `packages/shell/main/package.json`의 `check` script는 지금 fmt, lint, `tsc`, `deno check`를 한 줄로 돈다. root 파이프라인과 겹치는 만큼 걷는다.
   - `check` script는 `tsc --noEmit -p . && deno check --config=desktop/core/deno.json ...`(지금 인자 그대로)만 남긴다. `precheck`(zod symlink)는 그대로 둔다.
   - 걷은 fmt와 lint는 root `tools/check.ts`의 단계("shell fmt", "shell lint")로 옮긴다. 명령은 `cwd: packages/shell/main`에서 `deno fmt --check --ignore=node_modules,dist . ../preload`와 `deno lint --ignore=node_modules,dist . ../preload`다(`../ipc`는 root 단계가 이미 본다).
   - "shell main" 단계(`npm --prefix packages/shell/main run check`)는 1번 표의 조건에서만 돈다. `node_modules`가 없으면 지금처럼 `npm ci`를 먼저 돈다(worktree는 5번 script로 준비하면 이 분기를 타지 않는다).
5. **`tools/worktree-prep.ts`**: `deno run -A tools/worktree-prep.ts <worktree 경로>`.
   - main checkout은 `git rev-parse --git-common-dir`의 부모다.
   - `<worktree>/packages/shell/main/node_modules`를 `<main checkout>/packages/shell/main/node_modules`로 가는 symlink(절대 경로)로 만든다 (`../orchestrator.md` 4.2).
   - 이미 있으면(symlink든 폴더든) 아무것도 하지 않는다. main checkout에 그 폴더가 없으면 "main checkout에서 `npm --prefix packages/shell/main ci`를 먼저 돌린다"는 오류로 종료 code 1이다. worktree 경로가 worktree가 아니면 종료 code 1이다.
6. **`deno.json`의 `tasks`**: `check`(그대로 `tools/check.ts`), `check:full`(`--full`), `wording`(`deno run --allow-read --allow-write packages/design/wording/generate.ts`)을 둔다. 다른 칸은 건드리지 않는다.
7. `tools/check-deps.ts`: `PACKAGE_DEPENDENCIES`를 export한다. 다른 규칙은 바꾸지 않는다.

## 끝남

- `deno task check`가 통과한다. 통과한 표에 단계별 시간이 보인다.
- 직접 확인한다 (확인 뒤 임시 변경은 되돌린다):
  - 비교 기준 없는 clean main에서 "바뀐 package: 전부"가 보이고 통과한다.
  - `packages/design`의 file 하나만 바꿔 놓으면(예: 주석 한 줄) core의 `deno check`가 돌지 않고 design, sdk, shell, tools만 돈다.
  - fmt를 일부러 깨 놓으면 첫 실패에서 멈추고 다른 단계의 child가 남지 않는다(`ps`로 확인).
  - `deno task check:full`이 통과한다.
  - 새 worktree(`git worktree add`, 확인 뒤 지운다)에서 `worktree-prep.ts`를 돌린 뒤 `deno task check`가 `npm ci` 없이 돈다.
- 위험 test: 없음 (check 도구는 위험 test 대상이 아니다. `testing.md` "쓰지 않는 test"의 "소스나 문서를 글로 읽어 검사하는 test"도 새로 만들지 않는다)
- 남지 않음:
  - `grep -rn "node --test\|playwright\|e2e" tools deno.json packages/shell/main/package.json`이 0줄이다.
  - `grep -rn "testing/repo-check" packages tools`가 0줄이다.

## 보고

- 바꾼 file
- 등록할 것: 없음 (`deno.json`의 `tasks`는 이 task가 직접 고친다)
- 안 쓰게 된 export: `tools/check.ts`의 `Runner`, `runSteps`, `Step.when`, `Decision` (남이 쓰는지 grep한 결과)
- 정한 것:
  - 비교 기준 없을 때 "전부"로 도는 규칙
  - "shell main의 두 번째 check를 줄인다"를 위 4번처럼 풀었다. 다르게 읽을 여지가 있으면 적는다.
  - `deno check` 인자 방식(글로브 / file 목록)
  - style 검사와 wording 검사가 낸 위반과 고친 곳
- 소유 바꾸기 요청: `tools/check-style.ts`, `tools/check-wording.ts`를 check 단위의 새 file로 `../ownership.md`에 넣는다. style/wording 위반을 고친 소유 밖 file이 있으면 그 목록.
- 쓴 시간: 빠른 check가 바뀐 package 없는 상태(cache 있음), design 하나만 바뀐 상태, 전부 바뀐 상태에서 각각 몇 초였는지
