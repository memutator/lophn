---
name: orchestrate
description: lead(주 session)가 계획 하나(project-docs/plan/<계획>/)를 worker 여럿에게 나눠 돌릴 때 쓴다. task 고르기, worktree 만들기, worker 띄우기, 보고 받기, review, merge, status 갱신, issue 기록까지. 일 하나를 혼자 하거나 worker 하나에 맡기는 정도면 쓰지 않는다.
---

# 오케스트레이션

lead는 task를 골라 worker에게 맡기고, 결과를 review해 main에 합친다. 기능 코드를 직접 짜지 않는다. 직접 고치는 것은 셋뿐이다: 공용 등록 file, 고정된 계약을 바꾸는 작은 commit, merge 충돌 가운데 등록 file 충돌.

계획 하나가 `project-docs/plan/<계획>/` 폴더 하나다(꼴은 `project-docs/plan/README.md`). task brief 꼴은 [brief-template.md](brief-template.md)다. 도구는 `project-docs/plan/tools/`(`status.py`, `lead/*`)이고 모두 첫 인자로 계획 이름을 받으며 **main checkout에서** 돌린다. worktree에도 project-docs 사본이 생기지만 `status.md`와 brief는 main checkout의 것이 바른 것이다. 다른 계획이 같이 돌 수 있다. `status.py ready`가 다른 계획의 running task와 소유가 겹치는 task를 거른다.

## 병렬 규칙

1. 계약(protocol, port, shell IPC, preload, design 공용 부품)은 고정한 뒤 lead만 고친다. worker는 바꿀 것을 보고에 요청으로 적고, lead가 작은 commit으로 고쳐 영향받는 `running` worker에게 SendMessage로 알린다.
2. 단위마다 소유 path만 고친다. 남의 file은 import만 한다. 남이 쓰는 export는 더하기만 하고, 안 쓰게 된 것은 보고하면 lead가 합친 뒤 지운다.
3. 공용 등록 file은 lead가 합친다: `deno.json`, `packages/protocol/**/mod.ts`의 목록, core 조립 목록(`packages/core/main/daemon/wiring/`), wording 생성물(`packages/design/wording/`), gallery `pages.ts`. worker는 "등록할 것"을 보고에 적는다.
4. 옛것과 새것이 잠시 같이 있어도 된다. 호환 장치(옛 이름 읽기, 옛 경로)는 만들지 않는다. 여러 영역이 쓰던 옛 계약은 마지막 cleanup이 지운다.
5. main은 늘 빠른 check가 통과한다.
6. wave는 앞 wave가 모두 merged일 때 연다. 동시에 도는 worker는 최대 8개다(core type check 하나가 약 2.6GB. RAM에 맞춰 `status.py`의 `MAX_WORKERS`를 고친다). full check는 동시에 2개까지다.
7. 영역을 통째로 소유하는 cleanup 같은 task도 영역별 worktree로 나눠 병렬로 돌릴 수 있다. 충돌은 `mod.ts`, registry, wording catalog에 몰리니 wording catalog는 한 worker에게만 맡긴다.

## 시작 전

1. main에 commit 안 된 변경이 없고 `deno task check`가 통과한다. `git worktree list`에는 main checkout만 있다.
2. `git config user.email`이 맞다(없으면 worker가 commit마다 author를 제각각 넣는다).
3. `<계획>/tasks/*.md`를 썼으면 `python3 -I project-docs/plan/tools/status.py <계획> build`로 `<계획>/status.md`를 만든다.

## 한 바퀴

빈 slot이 있는 동안 되풀이한다.

### 1. 고르기

`python3 -I project-docs/plan/tools/status.py <계획> ready`가 띄울 수 있는 task를 낸다(앞 wave 모두 merged, 선행 merged, 이 계획과 다른 계획의 running과 소유 안 겹침). 여럿이면 wave가 낮은 것, 뒤에 기다리는 task가 많은 것, `status.md` 위쪽 순이다. 겹치지 않게 N개를 한 번에 고르려면 `python3 -I project-docs/plan/tools/lead/pick.py <계획> N`.

### 2. worktree

`project-docs/plan/tools/lead/launch.sh <계획> <id>...`가 `.claude/worktrees/<id>`와 branch `<단위>/<id>`를 만들고, `tools/worktree-prep.ts`로 shell main의 `node_modules`를 잇고, status를 `running`으로 한다. 새 worktree에서 `npm ci`를 돌리지 않는다(Electron과 node-pty를 다시 받아 느리다).

### 3. worker 띄우기

Agent tool로 띄운다: `subagent_type: sonnet-high`, `run_in_background: true`, prompt는 `python3 -I project-docs/plan/tools/lead/prompt.py <계획> <id> <branch> "<알아 둘 것>"`의 출력 그대로.
- model은 `sonnet-high`다. `mimo-v2.6-flash`는 쓰지 않는다. worker는 자기 sub agent를 띄우지 않는다.
- 폴링하지 않는다. 끝나면 알림이 온다. 그 사이 다른 slot을 채운다.

worker에게 꼭 넣을 것(`prompt.py`에 들어 있다. 고치면 이 목록도 고친다):
- 작업 위치(worktree 절대 경로)와 "그 밖의 file은 고치지 않는다".
- 먼저 읽을 것: worktree의 AGENTS.md, brief의 절대 경로, brief의 "읽을 것".
- 소유 path만 고친다. 계약은 고치지 않고 요청을 보고에 적는다. project-docs는 고치지 않는다.
- test는 위험한 것만(`write-test`). E2E, 브라우저, 스크린샷, subprocess·서버 test는 새로 만들지 않는다.
- worker의 Bash 호출은 매번 cwd와 변수가 처음으로 돌아간다. 명령마다 `cd <worktree>; ...`로 시작한다(안 그러면 main checkout에서 돈다).
- core 확인: 띄우기부터 끄기까지 Bash 호출 하나로 한다. `cd <worktree>; mkdir -m 700 -p .dev-data/<id>; export LOPHN_HOME=$PWD/.dev-data/<id>; tail -f /dev/null | deno run -A packages/core/main/daemon/main.ts --port=0 > .dev-data/<id>/core.log 2>&1 & PID=$!; sleep 15; kill $PID; wait $PID`. `;`로 잇고 `&&` 사슬이나 `( ... )`로 background에 보내지 않는다(`$!`가 subshell이라 deno가 남은 일이 있다). **ps·fuser·ss로 찾지 않는다**(`ps --ppid … -C tail`이 OR로 걸려 남의 process를 끈 일이 있다). pkill·killall 금지. 실제 `~/.lophn`은 절대 건드리지 않는다. data root는 0700이어야 기동한다.
- 명령이 auto mode classifier에 막히면 다른 명령으로 우회하지 않고 보고한다. lead도 worker가 거절당한 명령을 대신 돌리지 않고 사람에게 묻는다(사용자 앱 방어를 지우는 변경의 check:full·commit이 막힌 일이 있다).
- `deno task check:full`을 돌리고, 통과하면 branch에 commit한다(영어 명령형 한 줄과 본문. 요구 ID와 작업 번호 없음). push, merge, rebase, 다른 branch는 하지 않는다.
- `packages/shell/main/node_modules`(symlink)와 `packages/shell/main/desktop/core/deno.lock` 변경은 commit하지 않는다. 고친 file을 path로 add하고 `git diff --cached --stat`을 본다.
- 막히면 추측으로 넘어가지 말고 할 수 있는 데까지 하고 보고한다. 맡은 일을 "시간이 부족했다"며 남기지 않는다.
- 보고는 brief의 "보고" 꼴로 쓰고, "무겁게 짠 것"과 "알려진 미완 동작" 칸을 빼지 않는다.

### 4. 받기

1. 보고를 읽고 diff와 대조한다. 보고만 믿지 않는다.
2. **무겁게 짠 것**(가장 단순한 구현보다 무겁게 짠 곳)은 `project-docs/issues/<topic>.md`에 `defect` 이슈로, **알려진 미완 동작**은 `bug` 이슈로 덧붙인다. 올리는 절차는 `issue` skill이다(코드와 대조하고, 같은 이슈를 찾고, 주제 파일에 덧붙인다). 사람이 한꺼번에 보고 줄일지 정한다. 대부분 요구가 시킨 것이라 merge를 막지는 않는다.
3. worker가 크게 잘못한 것(review에서 되돌린 것, 사람이 찾은 것)은 `mistake` 이슈로 만든다. 원인과 막을 check나 문장을 적는다.
4. review(아래)를 한다. 통과하면 merge한다.
5. 안 되면 셋 중 하나다: 같은 worker에게 SendMessage로 고칠 것을 보낸다 / brief를 고쳐 다시 띄운다 / `blocked`로 두고 이유를 적는다. 두 번 실패한 task는 brief를 쪼갠다.

### 5. review

| 볼 것 | 어떻게 |
|---|---|
| node_modules를 commit하지 않았다 | `git diff --stat main...<branch> \| grep node_modules`가 0줄. 있으면 merge하지 않는다. ff-merge가 main checkout의 진짜 `node_modules`를 덮어 지운 일이 있다 |
| 소유 밖 file을 안 고쳤다 | `git diff --name-only main...<branch>`를 brief의 소유와 댄다. 예외: 지운 것을 가리키던 등록 줄만 뺀 것, wording catalog에 key를 더한 것 |
| check가 통과한다 | worktree에서 `deno task check:full`. 빠른 check는 바뀐 package만 본다 |
| 위험 test | brief의 "위험 test"가 이름으로 있고 통과한다 |
| 할 일을 다 했다 | brief의 "할 일"과 "남지 않음" grep을 하나씩 댄다. `TODO`·`FIXME` grep |
| core가 뜬다 | check는 통과해도 reader 등록 중복처럼 기동 때만 드러나는 오류가 있다. `lead/boot.sh`(merge.sh가 돌린다) |
| 화면 | `deno task wireframes`가 되고 gallery page가 옮긴 component를 쓴다 |
| 보고의 등록할 것 | lead가 고칠 목록에 옮긴다 |

### 6. merge

`project-docs/plan/tools/lead/merge.sh <계획> <id>`(`fix/<id>` branch는 `merge-fix.sh <계획> <id>`). 하는 일: node_modules 검사 → rebase → worktree `check:full` → ff-merge → main `check:full` → core 두 번 기동(`boot.sh`) → renderer build → worktree·branch 정리 → status merged. 멈추면 `STOP: ...`을 찍는다.
- `STOP: rebase conflict`: worktree에서 충돌을 풀고 `GIT_EDITOR=true git rebase --continue` 뒤 다시 돌린다. 대개 등록 file이나 wording catalog다. catalog 충돌은 두 쪽 key를 다 남기고 `deno run --allow-read --allow-write packages/design/wording/generate.ts`를 다시 돌린다. 그 밖 file이 충돌하면 소유가 잘못 나뉜 것이다. task를 돌려보내고 소유를 고친다.
- merge 바로 뒤에 보고의 "등록할 것"을 고치고 check가 통과하면 commit한다. `merge.sh`가 바꾼 `status.md`는 commit하지 않으니 lead가 같이 commit한다.
- push는 사람 확인 뒤에만 한다.

## 상태 기록

`python3 -I project-docs/plan/tools/status.py <계획> set <id> <todo|running|review|merged|blocked> [branch] [commit] [기록]`. 막히면 `<계획> set <id> blocked "" "" "<이유>"`.

## 계약 바꾸기 요청

1. worker는 계약을 안 고치고 보고에 요청을 적는다.
2. lead가 받을지 정한다. 기준은 `project-docs/architecture/`와 PRODUCT.md다.
3. 받으면 main에 작은 commit으로 계약을 고치고, 그 계약을 쓰는 `running` worker에게 SendMessage로 알린다.
4. 문서와 다르게 가야 하거나 제품 동작이 바뀌면 사람에게 묻는다.

## 막힘과 겪은 함정

- 문서에 답이 없으면 추천안으로 진행하고 기록해 둔다. 사람에게 올리는 것은 제품 동작, 비용, 되돌리기 비싼 것뿐이다.
- 권한 분류기가 `git push`, `git rebase`, merge script를 막을 수 있다. 우회하지 말고 무엇을 왜 하려는지 사람에게 말한다.
- 같은 file을 두 task가 원하면 한쪽에 소유를 주고 다른 쪽은 선행을 걸어 뒤로 미룬다.
- worktree 안 `.dev-data`에 쓰기 금지 file(deno cache)이 남아 `git worktree remove`가 실패하면 `chmod -R u+w <worktree>/.dev-data` 뒤 다시 지운다.
- `deno task dev`는 `LOPHN_HOME`을 무시하고 저장소(worktree) 안 `.dev-data`를 쓴다.
- check:full이 못 보는 것: renderer build(`deno run -A packages/shell/renderer/build.ts`). 이것으로 main이 깨진 채 지나간 일이 있다.
- 지우면 안 되는 것: core keychain이 Linux에서 `secret-tool`을 쓴다. `libsecret-tools` 의존과 shell supervise의 secret-tool 실행 권한은 남긴다(한 번 뺐다가 되살렸다).
- worker가 자주 한 실수(보고를 diff와 대조하는 이유):
  - `*.placeholders.ts`를 손으로 고치다 괄호를 깨뜨린 채 commit했다. generate로 만든다.
  - template literal로 만드는 wording key(`` `common.label.tab-${dot}` ``)를 "쓰는 곳 없음"으로 보고 지웠다.
  - 설계와 안 맞는 test를 지우면서 그 test가 지키던 권한 경계 검사까지 없앴다.
  - 맡은 worktree가 아닌 곳에 commit했다.
  - 맡은 항목 일부를 "시간이 부족했다"며 남겼다. 다시 맡기면 끝냈다.
- schema 칸 이름을 바꾼 task 뒤에 type 오류가 나면 먼저 칸 이름(`run` → `turn` 같은 것)이 어긋난 곳을 의심한다.

## 사람에게 알리는 때

wave 하나가 끝났을 때(무엇이 merge됐는지, push할지), 계약을 고정했을 때, `blocked`를 lead가 못 풀 때, 문서와 다르게 가야 할 때, 그리고 `project-docs/issues/`에 이슈가 쌓였을 때.
