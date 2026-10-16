# cleanup 보고

wave 4 cleanup(`cleanup-dead`, `cleanup-names`, `cleanup-comments`)을 끝낸 lead의 보고다. merge마다 남긴 결정과 열린 것은 `../tmp/docs-review.md`의 "wave 4 cleanup" 절에 있다. 이 문서는 거기에 적지 않은 것만 담는다: 다음에 할 일, 확인하지 못한 것, 일하며 알게 된 것.

## 지금 상태 (2026-10-16)

- main `dd1c140f`. origin보다 commit 99개 앞서 있다. **push하지 않았다.**
- `status.md`의 140개 task가 모두 merged다. worktree와 cleanup branch는 모두 지웠다.
- origin 대비 1511 file, +4.4k / −38.9k줄.
- handoff 4번의 "문서"(요구 `impl` 칸, spec "지금 코드" 칸)는 사람 결정으로 하지 않았다.

## 확인하지 못한 것

이 cleanup은 Windows 머신에서 했다. deno도 WSL도 없어서 사람이 "check 없이 진행"으로 정했다. 그래서 아래는 한 번도 돌지 않았다.

| 할 것 | 명령 |
|---|---|
| type check, lint, test | `deno task check:full` |
| fmt | `deno fmt --check` (worker가 줄 바꿈을 손으로 맞춘 곳이 많다. 걸릴 가능성이 크다) |
| wording 생성물 | `deno run --allow-read --allow-write packages/design/wording/generate.ts --check` (placeholders를 손으로 고쳤다) |
| renderer bundle | `deno run -A packages/shell/renderer/build.ts` |
| core 기동 두 번 | `project-docs/plan/tools/lead/boot.sh` |

- 개발 DB는 지우고 새로 만든다. schema step이 바뀌었고 migration은 없다. 바뀐 표: `coding_agent_connections` 삭제, `ticket_completions.fix_records` 삭제, `events.run`·`question_groups.run` → `turn`, `tool_calls.app_command` → `app_api`.
- test는 한 번도 실행하지 않았다. 특히 되살린 `packages/shell/main/decision-handle/ipc_test.ts`(provider disconnect 결정으로 바꿨다)는 실행해 본 적이 없다.

### 대신 돌린 검사와 그 한계

lead가 scratchpad에 만든 검사를 merge마다 돌렸다. 마지막 결과는 모두 깨끗하다.

- TypeScript parser로 바뀐 `.ts`/`.tsx`의 문법 오류
- 상대 import 대상 file이 있는지, import한 이름을 대상이 export하는지
- diff에서 지운 선언 이름이 코드에 남았는지
- wording catalog와 placeholders의 key가 같은지

한계: type을 보지 않는다. 이 머신에 npm 의존(zod 등)이 없어서 protocol에서 온 type이 `any`로 풀린다. 그래서 schema 칸 이름이 어긋난 것(예: wire 칸 `run` → `turn`, `mode` → `delivery`, release diff 칸 `*_commands` → `*_app_api`)은 이 검사가 잡지 못했다. worker가 grep으로 쓰는 곳을 맞췄을 뿐이다. `check:full`에서 오류가 나면 먼저 이 칸 이름 바꾸기를 의심한다.

검사 script는 session scratchpad에 있어 곧 사라진다. 다시 쓸 일이 있으면 `tools/lead/`로 옮겨 달라고 하면 된다.

## 다음에 할 일

### 고칠 버그 (cleanup 전부터 있던 것)

fix task 하나로 묶는 것을 추천한다. 질문 기능은 런타임에서 실패할 수 있다.

1. 질문 읽기·지우기 SQL(`core/lophn-agent/tools/questions/{model,reads,erase}.ts`)과 trace 읽기(`core/lophn-agent/observability/reads.ts`)가 schema에 없는 표와 열을 읽는다. 원래 `runs` 표를 읽었고, 이름만 `turns`로 바뀌었다. 열(`assignment`, `accepted_seq`, `source_kind`, `source_message`, `source_sender_run`)은 지금 `turns`에 없다. questions schema의 trigger도 같은 열을 본다.
2. `core/lophn-agent/approval-use.ts`가 `approval_requests`에 없는 열(`expires_at`, `action`, `closed_seq`)을 읽는다.
3. `RunWaited`·`RunResumed`·`RunFinished`를 내는 곳이 없어 observability의 `waiting_ms`가 늘 0이다. event를 내거나 계산을 뺀다.
4. `packages/shell/main/scripts/stage.ts`가 배포 staging에서 없는 package `platform`·`contracts`를 찾는다. 존재 검사로 건너뛰므로 실제로는 `base`만 복사된다. 배포 bundle이 core를 못 띄울 수 있다.

### 정할 것 (지금은 남겨 두었다)

| 것 | 추천 |
|---|---|
| protocol에 남은 앱 호출 확인 schema(`apps/channel.ts`의 confirm proof, `invocation.accept_confirm`, broker의 `confirm=true`). core 구현이 없어 보인다 | 쓰는 곳을 확인하고 지운다 |
| 앱 wire 경로 `/_lophn/commands/*`와 앱 호출 schema 안의 `command` 칸 | MVP에서는 둔다. 바꾸면 SDK·앱 wire가 같이 바뀐다 |
| `base/install/linux-install.ts`. inventory 5장은 지우라고 했지만 `.deb` 만드는 tools가 쓴다 | release 절차를 정할 때 같이 |
| settings secret 입력 창이 이제 없는 `lophnShell.openConfirmation`을 읽는다. 원래도 늘 unavailable이었다 | `openSecretInput`으로 잇거나 그 chain을 지운다 |
| 기존 주석의 "자리" 낱말(core만 100줄 넘게) | 한 번에 바꾸려면 따로 task 하나 |
| ledger `domainOnly` 옵션(켜는 곳이 없다), 옛 ledger `secrets` 표 schema step | 쓸 계획이 없으면 지운다 |
| test만 쓰는 export 34개 | test와 같이 볼 때 정리 |

### deno.json 정리 (lead 몫)

- root `deno.json`: `@std/toml`, `unpdf`는 import하는 곳이 없다.
- `packages/shell/main/desktop/core/deno.json`: `@lophn/base`는 TS에서 쓰는 곳이 없다.
- `packages/design/deno.json`: `@iconify-json/catppuccin/`는 확인이 필요하다.
- `quickjs-emscripten`, `parse5`는 이미 없다. `picomatch`, `@std/yaml`은 core가 쓴다.

## 일하며 알게 된 것

- **lead 도구가 Linux에 묶여 있다.** `tools/lead/*.sh`와 `prompt.py`는 `/home/pyosechang/projects/lophn` 경로를 박아 두었다. brief들도 같은 절대 경로를 쓴다. 다른 머신에서 이어 받으면 경로부터 바꿔 읽어야 한다.
- **cleanup도 병렬로 돌릴 수 있었다.** handoff는 "하나씩 혼자"라고 했지만, 사람 요청으로 영역별 worktree에 나눠 돌리고 lead가 merge로 합쳤다. 충돌은 `mod.ts`·registry·wording catalog에 몰렸고 모두 손으로 풀 만했다. 같은 일을 다시 하면 wording catalog는 한 worker에게만 맡긴다.
- **haiku-high worker가 자주 한 실수:**
  - placeholders file을 손으로 고치다 괄호를 깨뜨린 채 commit했다.
  - template literal로 만드는 wording key를 "쓰는 곳 없음"으로 보고 지웠다(`` `common.label.tab-${dot}` ``).
  - 설계와 맞지 않는 test를 지우면서 그 test가 지키던 권한 경계 검사도 같이 없앴다.
  - 맡은 worktree가 아닌 곳에 commit했다.
  - 맡은 항목 일부를 "시간이 부족했다"며 남겼다. 다시 맡기면 끝냈다.
  - worker 보고는 꼭 diff와 대조해서 본다.
- **git:** 이 머신에 git user 설정이 없어 worker가 commit마다 `-c`로 author를 넣었다. 그래서 author email이 `memuator@gmail.com`, `memutator@gmail.com`, `noreply@anthropic.com`으로 섞였다. 다음 작업 전에 `git config user.email`을 맞춘다.
