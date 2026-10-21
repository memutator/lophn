# tr-check-enable

`tools/check.ts`의 `NOT_CHECKED`를 지워 `tests/e2e`, `tests/eval`, `tests/support` 전체가 다시 type check되게 한다. `deno test` discovery에서는 지금처럼 `tests/e2e`와 `tests/live`만 뺀다. 남은 type·lint·test 오류를 고쳐 `deno task check`와 `deno task e2e`가 통과하게 한다. 사람이 commit하지 않은 재료(calendar-app-dev, calendar-app-user)는 건드리지 않는다.

- 단위: check (wave 3)
- 선행: 없음. wave 2까지의 모든 task가 merged여야 열린다(wave가 막는다).
- 소유(이 task만 고친다):
  - `tools/check.ts`
  - `tests/e2e`
  - `tests/eval`
  - `tests/support`
- 읽을 것:
  - 계획: `project-docs/plan/test-restore/README.md`의 "목표" 둘째 줄, "정한 것"의 마지막 줄(`NOT_CHECKED`), "지켜볼 것" 넷, "lead가 할 일"(land는 끝에 한 번 `land.sh test-restore`, `LOPHN_LAND_SKIP_E2E`를 쓰지 않는다). `project-docs/plan/test-restore/status.md`(앞 task의 기록 칸), 앞 task들의 보고에서 "알려진 미완 동작"과 "넘길 줄"(lead가 넘겨준다)
  - architecture: `project-docs/architecture/testing.md`의 "층"(16-19: `tests/e2e`·`tests/live`는 check의 `deno test`에 들지 않고 `--ignore`로 뺀다, E2E 전체 10분 예산), "돌리는 때"(84), "case 고르는 규칙" 7-8(flaky한 case는 꺼 두지 않는다. 고치거나, harness로 내리거나, 지운다. 제품 bug를 찾은 E2E는 test를 맞추지 않는다)
  - boundary·module: `project-docs/module-catalog.yaml`의 `tests`, `tools`
  - 쓰는 법: `.claude/skills/write-test/SKILL.md`의 "check 파이프라인"
  - 코드
    - `tools/check.ts` 42-57(`NOT_CHECKED`, `NOT_IN_CHECK`, `under`), 122-135(`sourceFiles`가 `NOT_CHECKED`를 뺀다), 219-226(full check는 `sourceFiles` 목록으로 `deno check` 하나), 330-345(test discovery가 `NOT_IN_CHECK`를 뺀다). 개편 전 값은 `git show 7243fc574 -- tools/check.ts`의 지운 줄이다(`const NOT_IN_CHECK = ["tests/e2e", "tests/live"];`)
    - `deno.json`의 `e2e`(`deno test --allow-all --no-check tests/e2e`), `e2e:deps` task. `project-docs/plan/tools/lead/land.sh` 25-31(`check:full` 뒤 `LOPHN_LAND_SKIP_E2E`가 없으면 `e2e:deps`와 `e2e`를 돈다)
    - "지켜볼 것"이 가리키는 곳: `tests/e2e/registration_test.ts`, `tests/e2e/annotation_test.ts`, `tests/e2e/agent-call_test.ts`의 operator-to-app-ae, `tests/support/core/human.ts` 48-61(`settle`), `tests/support/app/activate.ts`(tr-support-app이 다시 쓴 helper), `tests/support/app/prepare-deps.ts`
- 계약:
  - 쓰는 것: 앞 task 모두가 내놓은 helper와 type
  - 내놓는 것: `NOT_CHECKED`가 없고 `NOT_IN_CHECK`는 `["tests/e2e", "tests/live"]`다. land(`land.sh test-restore`)가 `LOPHN_LAND_SKIP_E2E` 없이 돈다.

## 할 일

근거는 README "목표"와 "정한 것"의 마지막 줄이다. 이 task가 계획의 마지막이다. 앞 task들이 자기 file을 `deno check <files>`와 file별 e2e로 확인했으므로 여기서 남는 것은 task 사이의 어긋남, 아무 task도 맡지 않은 file, 전체를 같이 돌릴 때만 드러나는 flake다.

참고(main `85f19080e`, 이 brief를 쓸 때 잰 값): 어느 task도 소유하지 않은 keep e2e 아홉(`annotation`, `boot`, `compact`, `file-write`, `oauth`, `prompt-blocked`, `prompt-notice`, `registration`, `secret`)은 `deno check` 오류가 없고 `deno test --allow-all --no-check`로 한 번 돌려 25 test가 1분 40초에 통과했다. check의 type check와 test discovery에 새로 드는 `*_test.ts`는 `tests/eval` 아래 36개와 `tests/support/fake-oauth/issuer_test.ts`다(`tests/support/coding/cli_test.ts`는 tr-support-app이 지운다).

1. `tools/check.ts`
   - 42-52의 `NOT_CHECKED` 주석과 목록을 지운다.
   - 53-54를 `// deno test의 discovery에서 뺀다. e2e는 \`deno task e2e\`, live는 \`deno task test:live\`로만 돈다.`와 `const NOT_IN_CHECK = ["tests/e2e", "tests/live"];`로 둔다.
   - 130의 `if (under(f, NOT_CHECKED)) continue;`를 지운다. `under`(56-57)는 test discovery(343)가 쓰므로 남기고, "폴더 항목과 file 항목이 섞여 있다" 주석은 맞지 않게 되니 지운다.
   - full check의 file 목록(219-225)은 그대로 둔다(`deno check`에 `--ignore`가 없다는 이유는 그대로다).
2. `deno task check:full`을 돌린다(`tools/check*.ts`가 바뀌면 check는 전부를 돈다). 실패를 소유 폴더(`tests/e2e`, `tests/eval`, `tests/support`) 안에서 고친다: type 오류, lint, fmt, `tests/eval`·`tests/support`의 unit test.
   - 고치는 방향은 지금 설계다. 설계와 맞지 않는 옛 test는 고치지 말고 지운다(AGENTS.md "호환성"). 지우면 보고에 file과 이유를 적는다. 권한 경계를 보던 검사까지 같이 없애지 않는다(`write-test` skill).
   - 제품 코드(`packages/`)를 고쳐야 통과하는 실패는 고치지 않는다(소유 밖). 보고의 "알려진 미완 동작"에 적고 lead가 이슈로 올린다.
   - 앞 task의 file을 고칠 때는 최소로 맞추고 보고의 "넘길 줄"에 적는다.
   - 앞 task들 뒤에 읽는 곳이 없어지는 export를 지운다(planner): `tests/eval/versions`의 `measureCli`, `tests/eval/checks/records.ts`의 `callFailed`. `git grep -n "<이름>" -- tests`가 정의 한 줄이면 지운다.
3. `deno task e2e:deps`를 돌린다. `deno.json`의 `e2e:deps`가 `tests/support/app/prepare-deps.ts`를 가리켜야 한다(tr-support-app이 등록을 요청하고 lead가 고친다). 아직 `tests/support/coding/…`이면 고치지 말고 lead에게 보고한다(`deno.json`은 lead의 등록 file이다).
4. `deno task e2e` 전체를 돌리고 걸린 시간을 잰다. 실패를 고친다.
   - "지켜볼 것" 1: `app.create` 직후 약 1초 동안 runtime child가 다시 뜬다. test가 `app.create`를 직접 부르는 곳은 그 앞에서 `runtimePids(core.run.home)`를 읽고 뒤에서 `settle(core, before)`를 기다린 다음 App Engineer session을 연다(`annotation_test`). lophn turn이 `app_create`와 App Engineer `call`을 한 turn에 하는 곳(`registration_test`)은 test가 사이에 끼어들 수 없다. 그 App Engineer turn이 `restarted`로 끊기면 test를 맞추지 말고 재현 조건을 보고에 적는다(제품 이슈. lead가 올린다).
   - "지켜볼 것" 2·3: `release.prepare`가 tool 호출 한도를 넘거나 offline 의존 cache가 migration 검사·preview 시작을 덮지 못해 앱 E2E가 실패하면, test 쪽(`tests/support/app/activate.ts`, `prepare-deps.ts`)에서 풀 수 있는 것만 고친다. 제품 한도를 바꿔야 하면 보고한다.
   - flaky한 행은 꺼 두거나 retry로 덮지 않는다(`testing.md` 100). 고치거나, 원인을 적어 보고한다.
5. `deno task e2e`를 한 번 더 돌려 두 번 연속 통과를 본다. 끝난 뒤 `/tmp/lophn-e2e-*`와 core process가 남지 않았는지 본다.
6. 전체 시간이 10분(`testing.md` 19)을 넘으면 file별 시간을 보고에 적는다. 행을 줄이거나 file을 합치는 것은 이 task에서 하지 않는다(planner가 정한다).

## 끝남

- `deno task check:full`이 통과한다(`tests/e2e`, `tests/eval`, `tests/support`가 type check에 들고 `tests/eval`·`tests/support`의 `*_test.ts`가 돈다).
- `deno task e2e:deps` 뒤 `deno task e2e`가 두 번 연속 통과하고, 끝난 뒤 `/tmp/lophn-e2e-*`와 core process가 남지 않는다.
- `tools/check.ts`의 `NOT_IN_CHECK`가 `["tests/e2e", "tests/live"]`다.
- 위험 test: 없음(새 test가 없다)
- 남지 않음: `grep -rn "NOT_CHECKED" tools tests`가 0줄이다. `git status --short tests/eval/materials/calendar-app-dev tests/eval/materials/calendar-app-user`가 시작 때와 같다(건드리지 않는다).

## 보고

- 바꾼 file(지운 test는 이유와 함께)
- 통과한 check: `check:full`, `e2e` 두 번(전체 시간, 가장 오래 걸린 file 다섯과 시간)
- 등록할 것: lead가 고칠 목록 file. `deno.json`은 이 task가 더 바꿀 것이 없다(`e2e:deps` path는 tr-support-app, `eval:attach` 지우기는 tr-eval-prune-coding의 등록이다. 둘이 되어 있는지만 적는다). `land.sh`는 바꿀 것이 없다(`LOPHN_LAND_SKIP_E2E`가 없으면 이미 `e2e:deps`와 `e2e`를 돈다). 문서는 lead의 일이다(README "lead가 할 일"): `project-docs/architecture/testing.md` 17(`NOT_CHECKED` 문장), 44-47(`tests/support` 표의 `gateway/`, `coding/`, `app/` 줄), 58-63(앱 길의 "돌지 않는다"와 coding MCP·token 줄), `.claude/skills/write-test/SKILL.md` 88-89. 이 task가 본 그 밖의 어긋난 문서 줄이 있으면 더해 적는다
- 안 쓰게 된 export(남이 쓰던 것은 지우지 않는다)
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 넘길 줄: 남의 file(앞 task가 소유했던 file)을 최소로 맞춘 곳마다 file, 줄, 이유
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- **무겁게 짠 것**: 가장 단순한 구현(AGENTS.md "속도")보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것. "지켜볼 것" 넷의 결과(`app.create` 뒤 재기동 창, `release.prepare` 시간, offline cache, `cli_test.ts`)를 하나씩 적는다. 없으면 "없음"
