---
type: guide
concerns: [platform, documents, apps, problems, lophn-agent, coding-agent, shell]
---

# lead handoff (2026-10-06 22:20 기준)

다음 orchestrator(lead)가 이 팀을 이어 받을 때 알아야 하는 것. 무엇을 만들지는 `docs/plan/`이 정하고,
여기는 운영 방법·현재 상태·함정만 적는다. 숫자와 PR 목록은 작성 시각 기준이니 시작할 때
`docs/tmp/plan-count.js now`와 `gh pr list`로 다시 본다.

## 1. 사람이 정한 운영 규칙

- 사람에게는 한국어로 답한다. 개발 용어는 영어 그대로 쓴다(AGENTS.md).
- lead는 직접 기능을 만들지 않는다. worker를 띄우고, PR을 리뷰하고, merge한다. merge 권한은 lead에게 위임돼 있다.
- **놀고 있는 worker가 없게 한다.** merge 대기열만 보다가 새 worker를 안 띄운 것을 사람이 강하게 지적했다. PR 하나를 처리할 때마다 시작할 수 있는 task를 다시 계산해 바로 띄운다.
- **구현에 집중**(2026-10-06 사람 지시). 일어나지 않은 문제·미래 유지보수 비용 때문에 범위를 넓히지 않는다. 리뷰에서 돌려보내는 기준은 보안 경계(범위 밖 노출, 권한 우회), 저장 안 된 blob의 가짜 hash, 테스트 실패, task 완료 기준 미달뿐이다. 나머지는 이어보냄을 받아들이고 바로 merge한다. 자세한 worker 쪽 규칙은 `worker-common.md`의 "구현에 집중" 절.
- full `deno task check`는 lead도 worker도 돌리지 않는다. lead는 merge 직전에 `light-check.sh`만 돈다.
- plan 파일 끝에 새 Q 항목을 더하지 않는다(PR끼리 번호 충돌). 결정은 그 task 블록 안 "정한 것" 줄로 적는다.
- 진행도는 시간순으로 `.dev-data/progress-log.md`(git 무시)에 남긴다. `docs/tmp/progress-snap.sh`가 한 줄을 더한다. 매시간 돌리던 cron은 세션 한정이라 새 세션에서 다시 건다(CronCreate, 매시 7분).

## 2. worker 배정 (사람 지시, 2026-10-06 갱신)

| 일 | subagent_type | 비고 |
|---|---|---|
| 기본(대부분의 task) | `glm-flash-max` | 결과는 lead가 완료 기준과 대조한다 |
| 어렵거나 복잡한 일, 같은 실수를 되풀이하는 일 | `sonnet-high` | glm이 되돌려 받은 task는 여기로 넘긴다 |
| 프론트(shell 화면·renderer·UI) | `sonnet-high` | opus는 쓰지 않는다. 화면 작업은 headless screenshot을 보고 확인하게 한다 |

- glm-flash-max는 proxy가 모델을 정한다. worker가 자기를 "Claude Haiku 4.5"라고 말하는 것은 사람이 정상이라고 확인했다.
- **worker는 Agent tool로 하위 agent를 띄우면 안 된다.** 하위 agent는 lead 모델(Opus)로 돌아 배정한 모델을 벗어나고, 같은 branch에 두 agent가 동시에 commit했다. `worker-common.md`에 규칙을 넣었지만 프롬프트 첫 줄에도 "Don't use the Agent tool or spawn subagents"를 꼭 넣는다.
- glm 결과는 반드시 직접 확인한다. 이번 구간에서 glm에게 준 기능 task(lophn-agent T42, problems T16, T10, documents T28, coding-agent T22, shell T57)는 대부분 완료 기준 미달·가짜 테스트·없는 route 호출이 있어 다시 돌려보내거나 sonnet-high로 넘겼다. 보고에 "완료"라고 써도 테스트 이름·completion criteria를 plan과 대조한다.
- 동시 worker는 6~8개가 적당했다. 각 worker는 test 프로세스를 2개까지만.

## 3. 반드시 지키는 안전 규칙 (사람·brief)

- 실제 사람 데이터 root(`~/.lophn`, `~/.config/lophn`)와 사람 harness home(`~/.claude`, `~/.codex`, `~/.gemini` 등)을 열거나 쓰지 않는다. core·shell·worker는 항상 `mktemp -d`(0700) LOPHN_HOME.
- 실제 OS keychain·secret-tool, 전역 단축키, autostart, OS notification, OS 앱 바로가기를 건드리지 않는다. 테스트는 fake.
- Electron은 headless만(`LOPHN_SHELL_HEADLESS=1`, `LOPHN_SHELL_SHOT_DIR`). 사람이 자기 Electron 창을 띄워 둘 수 있으니 직접 띄운 정확한 pid만 죽인다.
- legacy repo는 읽기만. intent(`docs/intent/`)는 사람만 고친다(domain-model·architecture는 intent가 아니다).
- `git stash` 금지. `deno fmt`를 docs/ 전체에 돌리지 않는다. main에 force push·이력 재작성 금지. 되돌리기 어려운 git 작업은 사람에게 묻는다.
- 테스트는 실제 model provider를 부르지 않는다(tools/fake-provider). 저장하지 않은 blob의 가짜 hash 금지.
- worker가 권한을 거절당한 일을 lead가 대신 하지 않는다(permission laundering). 예: wildcard `rm`, 남의 프로세스 kill은 사람에게 넘긴다.

## 4. 도구 (모두 이 폴더)

| 파일 | 쓰임 |
|---|---|
| `merge.sh <pr> <worktree 이름> <branch> "<review>"` | origin/main 합치기 → light-check → push → main 안 움직였는지 확인 → review 코멘트 → squash merge → branch·worktree 정리. log는 `$TMPDIR/lophn-check<pr>.log` |
| `light-check.sh` | fmt·lint·deps·contract coverage·type check·docs check, 바뀐 폴더 test, core tripwire, shell npm check |
| `merge-queue.sh <queue 파일>` | 대기열 파일(`pr|worktree 이름|review` 한 줄씩)을 위에서부터 계속 처리한다. merge 전에 main을 합치고, **plan 파일만 충돌하면 양쪽을 남겨 자동 해결**(`keepboth.py`), PR이 바꾼 코드·md를 deno fmt, 남는 `apps/shell/main/desktop/core/deno.lock` 변경을 되돌린 뒤 `merge.sh`. 파일 끝에 줄을 더하면 이어서 처리한다. 같은 PR을 다시 넣으려면 review 문구를 바꾼다(문구 hash로 중복을 거른다). background로 돌린다 |
| `keepboth.py <files>` | 충돌 표시를 "main 쪽 + PR 쪽" 순서로 둘 다 남긴다. plan 문서 전용 |
| `plan-count.js "<시각>"\|now` | 그 시각 origin/main의 plan 완료 수/전체 |
| `progress-snap.sh` | `.dev-data/progress-log.md`에 진행도 한 줄 |
| `worker-common.md` | worker 공통 지침. 프롬프트에서 항상 읽게 한다 |

ready task 계산(선행이 모두 완료인 미완 task)은 `docs/plan/*.md`의 `- 상태:`·`- 선행:` 줄을 node 한 줄로 파싱해 왔다. in-flight PR의 task를 완료로 쳐서 "PR이 들어가면 열리는 task"도 미리 본다.

## 5. merge 쪽 함정 (실제로 겪은 것)

- **light-check 실패 이유는 log 끝 몇 줄만 보면 놓친다.** fmt 실패가 테스트 통과 줄 뒤에 숨어 몇 시간 merge가 멈춘 적이 있다. `grep -E "실패|LIGHT|FAILED" $TMPDIR/lophn-check<pr>.log`로 본다.
- main에 포맷 안 된 파일이 들어가면 그 뒤 모든 PR이 fmt에서 떨어진다(#326 → #352로 고침). 그런 파일은 바로 고쳐 merge.
- 부하 flaky(같은 파일 단독 실행은 통과): `apps/core/documents-file-stream_test.ts`("worker가 사용할 수 없다"), `documents-observation_test.ts`, lophn-agent tool-judgment·waiting-and-recovery(25s timeout), apps runtime("reader가 현재 요청을 처리할 수 없다"), events-subscribe. 단독으로 돌려 통과하면 대기열 뒤에 다시 넣는다. #335/#345가 원인 일부를 고쳤다.
- **충돌 정리를 맡긴 worker가 main 쪽 내용을 지울 수 있다.** "HEAD 쪽을 남겼다"는 보고가 있으면 `git diff origin/main origin/<branch> -- <파일>`에서 `-` 줄을 본다. 실제로 #356이 #350의 confirmation contract를, #351이 wording key 20개를 잃었다. wording은 원래 branch 커밋의 en.ts key 중 main에도 PR에도 없는 것을 찾아 되살리고 `packages/design/wording/generate.ts`로 placeholders를 다시 만든다.
- **base가 다른 PR branch인 PR**은 그 base branch가 merge로 지워지면 GitHub가 PR을 닫는다(#337 → #345로 다시 엶). 쌓인 PR은 먼저 `gh api -X PATCH repos/memutator/lophn/pulls/<n> -f base=main`.
- 앞 PR의 commit을 포함한 PR(예: #351·#353·#366이 #342를 포함)은 앞 PR 다음 순서로 merge한다.
- worker가 shell npm check를 돌리면 main checkout의 node_modules를 symlink로 빌리고 `deno.lock`(apps/shell/main/desktop/core)을 바꿔 둔다. merge 전에 되돌린다(merge-queue.sh가 한다).
- main checkout의 `apps/shell/main/node_modules`가 오래되면 build가 깨진다. `npm --prefix apps/shell/main ci`.
- 대기열 chain을 다른 chain의 출력에 기대 이어 붙이지 않는다. 앞 chain을 멈추면 뒤가 영원히 기다린다(몇 시간 멈춘 적 있음). 대기열 파일 하나 + `merge-queue.sh` 하나만 쓴다.

## 6. 현재 상태 (2026-10-06 22:20, 사람이 모든 worker와 merge chain을 멈춘 시점)

- 완료 263/364(72%). 진행도 기록은 `.dev-data/progress-log.md`. 시간당 완료는 초반 5~6개, 최근 3~4개.
- 돌고 있는 worker·merge chain·cron 없음. 아래 열린 PR은 모두 lead 리뷰를 통과했고(#369 제외) merge만 남았다. 새 세션에서 대기열 파일을 만들어 `merge-queue.sh`로 이 순서대로 돌린다.

### 열린 PR (merge 순서대로)

| 순서 | PR | task | 남은 일 |
|---|---|---|---|
| 1 | #354 | apps app.rename | 부하 timeout 재시도만 |
| 2 | #347 | problems T10 앱 계약 검사 | 재시도만 |
| 3 | #345 | core child 채널 deadline | worktree `agent-abb49fe7977335f58`에 main merge commit `b265ff4e`가 있으나 push 여부·테스트 미확인(멈춘 worker). 확인 후 push. PR branch는 `fix/real-core-test-stability-followup` |
| 4 | #340 | problems T16 view binding | main 합친 `5a93bf40` push됨, 테스트 미확인 |
| 5 | #367 | problems T5 submit-feedback | #340 다음(#340 commit 포함). base는 main으로 바꿔 둠 |
| 6 | #330 | documents T31 앱 출력 | worktree `agent-aa087d05635282184`의 main merge `ca978be9`가 push 안 됨, 미commit 파일 1개. 확인 후 push |
| 7 | #361 | problems T11 화면 검사 | main 합침·테스트 통과·push됨 |
| 8 | #358 | coding-agent T22 SDK tool | main 합침·테스트 통과·push됨 |
| 9 | #363 | shell T57 패키징 | main 합침·테스트 통과·push됨 |
| 10 | #342 | shell T39 native view | worktree가 **merge 도중 상태(MERGE_HEAD 있음)**. `git merge --abort` 뒤 다시 합친다 |
| 11 | #351 | shell T44 앱 패널·카드 | 같은 상태(merge 도중). #342 다음. wording key 복구 commit `65f843aa`는 push됨 |
| 12 | #353 | shell T42 앱 공간 | 같은 상태(merge 도중). #342 다음 |
| 13 | #366 | shell T52 문제 알리기 | #353 다음(#353 commit 포함) |
| 14 | #356 | shell T20 projects | confirmation contract 되돌림을 고친 `51826201` push됨 |
| 15 | #365 | shell T36 contexts | 승인 |
| 16 | #369 | lophn-agent T19 prompt 층 | **리뷰 안 함.** worker가 PR까지 열고 멈췄다. 완료 기준과 대조해 리뷰한다 |
| 17 | #368 | 이 handoff | docs만 |

### 멈춘 작업 (PR 없음)

- **apps T19**(가장 중요): branch `worktree-agent-ae961ecfbc3ee5c0f`, worktree 같은 이름, commit 11개 push됨. 마지막 commit "Serve preview stand-in brokers, bundle ledger preview releases (apps#T19 WIP)". 어디까지 했는지 `git log origin/main..`으로 보고 sonnet-high로 이어서 끝낸다. 할 일 목록은 plan apps T19 블록의 "넘어온 것" 줄들(blueprint read route, supervisor broker 조립, cap-host 설치, release 준비의 SDK 사본·lock, R22 검사, APP_OP_ROUTES.blueprint 교체 등).
- **platform T58**: 시작 직후 멈춤. worktree `agent-a991b84b975f48cb7`에 미commit 파일 3개. 처음부터 다시 해도 된다.

### 핵심 경로

- **apps T19**가 끝나야 apps T18·T23~T28, shell T43·T45, lophn-agent T44, problems T14·T27 등이 열린다. 앱 fixture 4개(T23~T26)는 T19 다음.
- **lophn-agent T19(#369) → T20 → T26(agent loop) → T27·T28·T31·T43·T44…** lophn-agent 남은 task 대부분이 T26 뒤에 있다.
- coding-agent ticket 쪽(T24 → …)은 problems T14(apps T19 뒤)에 걸려 있다.
- platform T48(.deb)은 shell T57(#363) 다음.
- 오래 "진행" 상태인 task: documents T21, platform T42, shell T17. 상태 줄의 "남은 것"을 보고 마무리 worker를 띄운다.

## 7. 알려진 남은 구멍 (다른 task로 이어보낸 것 위주)

- shell의 실제 앱 command 호출·앱 열기 버튼은 `/v1/apps/blueprint`(apps T19)가 있어야 동작한다.
- 런처 실패 화면: core 시작 실패 신호만 실제로 들어온다. sandbox 실패·schema 비호환 신호는 main이 아직 안 보낸다(shell T57 이후 작업).
- "파일 빼기" 확인 창의 `delete_file` owner decision을 main이 처리하지 않는다(shell T20·T29 사이, 이어보냄 기록 있음).
- 앱 층 `LOPHN.md`: documents가 앱 자리 경로를 몰라 등록 목록에 없다(apps registration이 경로를 내야 함).
- coding-agent `sdk show`는 guide 본문 read가 없어 API·예제를 못 보인다. MCP에는 쓰기 권한이 없어 SDK apply는 CLI만(coding-agent T36).
- problems collector의 settings·invocation machine read는 #367에서 붙였지만 직접 테스트는 없다.

## 8. 사람 장치에 남은 것 (사람이 정리)

- 고아 앱 프로세스 2876949, 2877136(runtime-source 테스트가 남김)과 오래된 `deno test` 2623887. lead 권한으로 kill이 거절됐다. 사람에게 `! kill …`을 안내했다.
- `/tmp/lophn-e2e-sandbox-*` 임시 폴더 5개(worker의 wildcard rm이 거절됨).
- `.claude/worktrees/` 아래 merge된 PR의 worktree가 많이 남아 있다. merge.sh는 merge된 것만 지운다.
