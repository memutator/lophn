# cleanup handoff

wave 0~3(구현·리팩터링)은 끝났다. 남은 것은 wave 4 cleanup 셋이다. 이 문서는 cleanup을 이어 맡는 오케스트레이터(lead)가 읽는다.

## 지금 상태 (2026-10-16)

- main에 이 문서와 project-docs 전체가 들어간 commit까지 origin에 push했다. project-docs는 이제 git에 있다(README 4.1 10번). `status.md`와 brief는 main checkout의 것을 고치고 merge 사이에 lead commit으로 남긴다.
- `status.md` 기준 140개 중 137개가 merged이고, 남은 것은 `cleanup-dead`, `cleanup-names`, `cleanup-comments`다. fix task(`plan/fixes/`)는 모두 merge됐다.
- `deno task check:full`은 cache가 찬 상태에서 2.4초다. test는 `_test` 67개(7.5k줄)이고 E2E는 없다.
- **통합 gate(orchestrator 8장 "통합")는 사람 결정으로 건너뛰었다.** E2E는 나중에 따로 설계한다. 그래서 cleanup 전 흐름 확인은 하지 않았다. wave 4는 이 결정으로 연다.
- 미룬 동작은 `../tmp/mvp-deferred.md`에, 무거운 설계는 `../tmp/design-weight-review.md`에, 경위는 `../tmp/docs-review.md` 끝 "오케스트레이터 기록"에 있다.

## 순서

cleanup은 저장소 전체를 소유하므로 **하나씩 혼자** 돈다. 다른 worker를 같이 띄우지 않는다.

1. `cleanup-dead`: 쓰는 곳 없는 옛 protocol·route·schema step·file·export·wording key를 지운다. brief 끝에 lead가 merge마다 넘긴 "(lead가 더함 …)" 목록이 길게 쌓여 있다. 그것이 이 task의 주된 일이다.
2. `cleanup-names`: 결정한 이름(turn, steer, app-api, `project_manager`, tool 이름 철자)이 끝까지 됐는지 보고 고친다.
3. `cleanup-comments`: 주석의 옛 문서 가리킴·요구 ID·작업 번호를 지운다.
4. 끝나면 README 2.7의 "문서"(바뀐 요구의 `impl` 칸, spec의 "지금 코드" 칸)와 full check 한 번.

model은 셋 다 `sonnet-high`를 추천한다(범위가 넓다). `mimo-v2.6-flash`는 쓰지 않는다.

## lead 도구 (`tools/lead/`)

| script | 하는 일 |
|---|---|
| `launch.sh <id>` | `<단위>/<id>` branch로 worktree를 만들고 prep, status를 running으로 |
| `prompt.py <id> <branch> [note]` | worker 지시문을 찍는다. 그대로 Agent prompt로 쓴다 |
| `merge.sh <id>` | rebase → worktree check:full → ff-merge → main check:full → core 두 번 기동(`boot.sh`) → renderer build → worktree·branch 정리 → status merged(`status.md` 변경은 commit하지 않으니 lead가 따로 commit한다) |
| `merge-fix.sh <id>` | `fix/<id>` branch용 merge.sh |
| `boot.sh` | route 중복 검사와 같은 data root로 core 두 번 기동 |
| `pick.py N` | 겹치지 않는 ready task 고르기(cleanup은 하나씩이라 쓸 일이 적다) |

- `merge.sh`가 "STOP: rebase conflict"를 내면 worktree에서 충돌을 풀고 `GIT_EDITOR=true git rebase --continue` 뒤 다시 돌린다.
- worktree 안 `.dev-data`에 쓰기 금지 file(deno cache)이 남아 `worktree remove`가 실패하면 `chmod -R u+w <worktree>/.dev-data` 뒤 다시 지운다.

## worker에게 꼭 넣을 것 (prompt.py에 들어 있다)

- 소유 path만 고친다. 계약은 고정됐다(`a7f8deb6`). cleanup은 옛 계약 줄을 지울 수 있다(brief가 그렇게 말한다).
- test는 위험한 것만. E2E·브라우저·스크린샷·Electron 금지.
- core 확인: `mkdir -m 700 -p $PWD/.dev-data/<id> && export LOPHN_HOME=$PWD/.dev-data/<id>` 뒤 띄우고 `$!`로 PID를 적어 그것만 끈다. **ps로 찾지 않는다**(`ps --ppid … -C tail`이 OR로 걸려 남의 process를 끈 일이 있다). pkill·killall 금지. 실제 `~/.lophn`은 절대 건드리지 않는다(data root는 0700이어야 기동한다).
- `packages/shell/main/node_modules` symlink와 `desktop/core/deno.lock` 변경은 commit하지 않는다.
- 문서·주석·보고에 "자리"라는 낱말을 쓰지 않는다(`coverage.py`가 잡는다).

## 알아 둘 것

- **지우면 안 되는 것:** core keychain이 Linux에서 `secret-tool`을 쓴다. `libsecret-tools` 의존과 shell supervise의 secret-tool 실행 권한은 남긴다(platform-install이 한 번 뺐다가 lead가 되살렸다, `8fd53a1a`).
- **check:full이 못 보는 것:** renderer build(`deno run -A packages/shell/renderer/build.ts`)는 check:full에 없다. merge.sh가 따로 본다. 한 번 이것으로 main이 깨진 채 지나간 일이 있다(`f2ce971a`).
- `deno task dev`는 `LOPHN_HOME`을 무시하고 저장소(worktree) 안 `.dev-data`를 쓴다.
- 기동 log의 "core: credential socket unavailable"은 credential socket 잔재다. cleanup-dead 목록에 있다.
- **권한 분류기:** 이 세션 후반에 `git push`, `git rebase`, merge script가 "Git Destructive"로 막힌 적이 있다. 막히면 우회하지 말고 사람에게 말한다. 사람이 "merge 권한 줄게"라고 한 뒤로는 merge script가 돌았다. push는 사람 확인 뒤에만 한다.
- 정할 수 없는 것은 추천안으로 진행하고 `../tmp/docs-review.md`에 적는다. 사람에게는 제품 동작, 비용, 되돌리기 비싼 것만 묻는다.

## cleanup-dead에서 lead와 같이 할 계약 줄

brief의 "(lead가 더함)" 가운데 계약(protocol·shell IPC·preload) 줄은 worker가 지우고 lead가 merge 때 본다.
- `release.prepare_bundle`의 `ticket_source`를 계약에서 필수로.
- `InstructionsOpened.path`를 필수로, `instructions-create` 계약 제거.
- `diagnosticsCheck`·`DIAGNOSTIC_CHECKS`, 옛 `releases.list/get/compare`, 옛 `release.start_activation`·`record_*`·`complete_activation`·`fail_activation`, `session-rewinds.ts`의 app 항목·`redo_ref`·header `redo`, 옛 feedback submit·preview 계약, `CREDENTIAL_HELPER`.
