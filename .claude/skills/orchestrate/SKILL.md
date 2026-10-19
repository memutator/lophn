---
name: orchestrate
description: lead(주 session)가 계획 하나(project-docs/plan/<계획>/)를 worker 여럿에게 나눠 돌릴 때 쓴다. task 고르기, worktree 만들기, worker 띄우기, 보고 받기, review, merge, status 갱신, issue 기록까지. 일 하나를 혼자 하거나 worker 하나에 맡기는 정도면 쓰지 않는다.
---

# 오케스트레이션

lead는 task를 골라 worker에게 맡기고, 결과를 review해 그 계획의 branch에 합치고, wave마다 main에 올린다. 기능 코드를 직접 짜지 않는다. 직접 고치는 것은 셋뿐이다: 공용 등록 file, 고정된 계약을 바꾸는 작은 commit, merge 충돌 가운데 등록 file 충돌.

계획 하나가 `project-docs/plan/<계획>/` 폴더 하나다(꼴은 `project-docs/plan/README.md`). task brief 꼴은 [brief-template.md](brief-template.md)다. 도구는 `project-docs/plan/tools/`(`status.py`, `lead/*`)이고 모두 첫 인자로 계획 이름을 받는다.

**lead는 main checkout에서 일하지 않는다.** 계획마다 branch `plan/<계획>`과 그 worktree(`.claude/worktrees/plan-<계획>`)가 lead의 자리다. `lead/lead.sh <계획>`이 만들고 경로를 찍는다. lead의 모든 명령(status, launch, prompt, merge, 이슈와 status commit)은 그 경로에서 돌린다(Bash 호출마다 `cd <그 경로> && ...`). task branch는 plan branch에서 갈라지고 merge.sh는 plan branch로 합친다. main에는 wave가 끝날 때 `lead/land.sh <계획>`이 올린다. 그래서 계획 둘이 같이 돌아도 main checkout과 서로의 작업 트리를 건드리지 않는다. `status.md`와 brief는 lead worktree의 것이 바른 것이다. `status.py ready`는 다른 계획의 lead worktree에서 running task를 읽어 소유가 겹치는 task를 거른다.

## 병렬 규칙

1. 계약(protocol, port, shell IPC, preload, design 공용 부품)은 고정한 뒤 lead만 고친다. worker는 바꿀 것을 보고에 요청으로 적고, lead가 작은 commit으로 고쳐 영향받는 `running` worker에게 SendMessage로 알린다.
2. 단위마다 소유 path만 고친다. 남의 file은 import만 한다. 남이 쓰는 export는 더하기만 하고, 안 쓰게 된 것은 보고하면 lead가 합친 뒤 지운다.
3. 공용 등록 file은 lead가 합친다: `deno.json`, `packages/protocol/**/mod.ts`의 목록, core 조립 목록(`packages/core/main/daemon/wiring/`), wording 생성물(`packages/design/wording/`), gallery `tools/wireframes/pages/index.ts`. worker는 "등록할 것"을 보고에 적는다.
4. 옛것과 새것이 잠시 같이 있어도 된다. 호환 장치(옛 이름 읽기, 옛 경로)는 만들지 않는다. 여러 영역이 쓰던 옛 계약은 마지막 cleanup이 지운다.
5. main과 plan branch는 늘 빠른 check가 통과한다. main에는 land.sh(rebase, full check, core 기동)를 거친 것만 올라간다.
6. wave는 앞 wave가 모두 merged일 때 연다. 동시에 도는 worker 수는 정하지 않는다. `status.py ready`가 낸 task는 다 띄워도 된다(core type check 하나가 약 2.6GB다. 기계가 버거우면 lead가 줄인다). full check는 동시에 2개까지다.
7. 영역을 통째로 소유하는 cleanup 같은 task도 영역별 worktree로 나눠 병렬로 돌릴 수 있다. 충돌은 `mod.ts`, registry, wording catalog에 몰리니 wording catalog는 한 worker에게만 맡긴다.

## 시작 전

1. `lead/lead.sh <계획>`으로 lead worktree를 열고 거기로 간다. 그 worktree에 commit 안 된 변경이 없고 `deno task check`가 통과한다. 계획 폴더가 아직 main에 없으면(main에서 계획을 쓰지 않았으면) lead worktree에 쓰고 commit한다.
2. `git config user.email`이 맞다(없으면 worker가 commit마다 author를 제각각 넣는다).
3. `<계획>/tasks/*.md`를 썼으면 `python3 -I project-docs/plan/tools/status.py <계획> build`로 `<계획>/status.md`를 만든다.

## 한 바퀴

띄울 task가 있는 동안 되풀이한다.

### 1. 고르기

`python3 -I project-docs/plan/tools/status.py <계획> ready`가 띄울 수 있는 task를 낸다(앞 wave 모두 merged, 선행 merged, 이 계획과 다른 계획의 running과 소유 안 겹침). 여럿이면 wave가 낮은 것, 뒤에 기다리는 task가 많은 것, `status.md` 위쪽 순이다. 겹치지 않게 N개를 한 번에 고르려면 `python3 -I project-docs/plan/tools/lead/pick.py <계획> N`.

### 2. worktree

`project-docs/plan/tools/lead/launch.sh <계획> <id>...`가 main checkout의 `.claude/worktrees/<id>`와 branch `<단위>/<id>`(plan branch에서 갈라짐)를 만들고, `tools/worktree-prep.ts`로 shell main의 `node_modules`를 잇고, status를 `running`으로 한다. 새 worktree에서 `npm ci`를 돌리지 않는다(Electron과 node-pty를 다시 받아 느리다).

### 3. worker 띄우기

Agent tool로 띄운다: `subagent_type: sonnet-high`, `run_in_background: true`, prompt는 `python3 -I project-docs/plan/tools/lead/prompt.py <계획> <id> <branch> "<알아 둘 것>"`의 출력 그대로.
- model은 `sonnet-high`다. `mimo-v2.6-flash`는 쓰지 않는다. worker는 자기 sub agent를 띄우지 않는다.
- 폴링하지 않는다. 끝나면 알림이 온다. 그 사이 띄울 수 있는 task를 더 띄운다.
- worker와의 대화(prompt, SendMessage)는 영어로만 한다(AGENTS.md). `prompt.py`도 영어로 찍는다. 사람에게 하는 보고는 한국어다.

worker에게 꼭 넣을 것(`prompt.py`에 들어 있다. 고치면 이 목록도 고친다):
- 작업 위치(worktree 절대 경로)와 "그 밖의 file은 고치지 않는다".
- 먼저 읽을 것: worktree의 AGENTS.md, brief의 절대 경로, brief의 "읽을 것".
- 소유 path만 고친다. 계약은 고치지 않고 요청을 보고에 적는다. project-docs는 고치지 않는다.
- import를 끊으려고 다른 module의 표를 SQL로 직접 읽지 않는다. 못 끊으면 `check-deps` 예외로 둔다.
- 지우거나 옮기거나 값을 바꾼 이름·숫자는 grep해 주석과 오류 메시지에 남은 것도 고친다. 규칙을 모을 때 이미 있는 표를 쓰고 사본을 만들지 않는다(옛 이름이 남은 주석을 lead가 따로 고친 일이 네 번, 모으는 task가 role 표 사본을 또 만든 일이 있다).
- test는 위험한 것만(`write-test`). E2E, 브라우저, 스크린샷, subprocess·서버 test는 새로 만들지 않는다(계획이 brief로 정한 `tests/e2e`의 flow만 예외).
- worker의 Bash 호출은 매번 cwd와 변수가 처음으로 돌아간다. 명령마다 `cd <worktree>; ...`로 시작한다(안 그러면 main checkout에서 돈다).
- core 확인: `cd <worktree>; project-docs/plan/tools/lead/boot.sh`만 쓴다. 새 data root로 core를 두 번 띄우고 각자 timeout으로 끝나 `boot N exit 0`을 찍는다. 손으로 띄우는 한 줄(`tail -f /dev/null | deno … & wait`)은 `wait`에서 멈춘 일이 있다. **ps·fuser·ss로 찾지 않는다**(`ps --ppid … -C tail`이 OR로 걸려 남의 process를 끈 일이 있다). pkill·killall 금지. 실제 `~/.lophn`은 절대 건드리지 않는다. data root는 0700이어야 기동한다.
- 임시 file(move-files mapping, probe 출력)은 worktree 안 `.dev-data/<id>/`에 둔다. session scratchpad는 같이 도는 worker끼리 공유되어 mapping이 덮인 일이 있다.
- 명령이 auto mode classifier에 막히면 다른 명령으로 우회하지 않고 보고한다. lead도 worker가 거절당한 명령을 대신 돌리지 않고 사람에게 묻는다(사용자 앱 방어를 지우는 변경의 check:full·commit이 막힌 일이 있다).
- `deno task check:full`을 돌리고, 통과하면 branch에 commit한다(영어 명령형 한 줄과 본문. 요구 ID와 작업 번호 없음). push, merge, rebase, 다른 branch는 하지 않는다.
- `packages/shell/main/node_modules`(symlink)와 `packages/shell/main/desktop/core/deno.lock` 변경은 commit하지 않는다. 고친 file을 path로 add하고 `git diff --cached --stat`을 본다.
- 막히면 추측으로 넘어가지 말고 할 수 있는 데까지 하고 보고한다. 맡은 일을 "시간이 부족했다"며 남기지 않는다.
- 보고는 brief의 "보고" 꼴로 쓰고, "무겁게 짠 것"과 "알려진 미완 동작" 칸을 빼지 않는다.

### 4. 받기

1. 보고를 읽고 diff와 대조한다. 보고만 믿지 않는다.
2. **무겁게 짠 것**(가장 단순한 구현보다 무겁게 짠 곳)은 `project-docs/issues/<topic>.md`에 `defect` 이슈로, **알려진 미완 동작**은 `bug` 이슈로 덧붙인다. 단 `issue` skill의 "올릴지"를 먼저 거친다. 그 task 안에서 고칠 만큼 작으면 같은 worker에게 SendMessage로 고쳐 보내게 하고, "확인 못 함"은 lead가 merge 전에 확인한다. 손해가 구체적이지 않은 무게와 사실을 적은 것은 올리지 않는다.
3. worker가 크게 잘못한 것(review에서 되돌린 것, 사람이 찾은 것)은 `mistake` 이슈로 만든다. 원인과 막을 check나 문장을 적는다.
4. review(아래)를 한다. 통과하면 merge한다.
5. 안 되면 셋 중 하나다: 같은 worker에게 SendMessage로 고칠 것을 보낸다 / brief를 고쳐 다시 띄운다 / `blocked`로 두고 이유를 적는다. 두 번 실패한 task는 brief를 쪼갠다.

### 5. review

| 볼 것 | 어떻게 |
|---|---|
| node_modules를 commit하지 않았다 | `git diff --stat plan/<계획>...<branch> \| grep node_modules`가 0줄. 있으면 merge하지 않는다. ff-merge가 main checkout의 진짜 `node_modules`를 덮어 지운 일이 있다 |
| 소유 밖 file을 안 고쳤다 | `git diff --name-only plan/<계획>...<branch>`를 brief의 소유와 댄다. 예외: 지운 것을 가리키던 등록 줄만 뺀 것, wording catalog에 key를 더한 것 |
| check가 통과한다 | worktree에서 `deno task check:full`. 빠른 check는 바뀐 package만 본다 |
| 위험 test | brief의 "위험 test"가 이름으로 있고 통과한다 |
| 할 일을 다 했다 | brief의 "할 일"과 "남지 않음" grep을 하나씩 댄다. `TODO`·`FIXME` grep |
| core가 뜬다 | check는 통과해도 reader 등록 중복처럼 기동 때만 드러나는 오류가 있다. `lead/boot.sh`(merge.sh가 돌린다) |
| 화면 | `deno task wireframes`가 되고 gallery page가 옮긴 component를 쓴다 |
| 보고의 등록할 것 | lead가 고칠 목록에 옮긴다 |

### 6. merge

`project-docs/plan/tools/lead/merge.sh <계획> <id>`(`fix/<id>` branch는 `merge-fix.sh <계획> <id>`). 하는 일: node_modules 검사 → plan branch 위로 rebase → worktree `check:full` → plan branch로 ff-merge → plan branch `check:full` → core 두 번 기동(`boot.sh`) → renderer build → worktree·branch 정리 → status merged. 멈추면 `STOP: ...`을 찍는다.
- `STOP: rebase conflict`: worktree에서 충돌을 풀고 `GIT_EDITOR=true git rebase --continue` 뒤 다시 돌린다. 대개 등록 file이나 wording catalog다. catalog 충돌은 두 쪽 key를 다 남기고 `deno run --allow-read --allow-write packages/design/wording/generate.ts`를 다시 돌린다. 그 밖 file이 충돌하면 소유가 잘못 나뉜 것이다. task를 돌려보내고 소유를 고친다.
- merge 바로 뒤에 보고의 "등록할 것"을 고치고 check가 통과하면 commit한다. `merge.sh`가 바꾼 `status.md`는 commit하지 않으니 lead가 같이 commit한다.
- wave가 모두 merged면 status와 이슈를 commit한 뒤 `project-docs/plan/tools/lead/land.sh <계획>`으로 main에 올린다. 하는 일: lead worktree를 main 위로 rebase → `check:full` → (`tests/e2e`에 test가 있으면) `deno task e2e:deps`, `deno task e2e` → core 두 번 기동 → main fast-forward. land는 lock(`.git/lophn-land.lock`)으로 하나씩 돈다. 다른 land가 돌면 "다른 land가 끝나기를 기다린다"를 찍고 기다린다. 그 사이 main에 `project-docs/`만 늘었으면 다시 rebase하고 빠른 check 뒤 올린다. `STOP: main ff failed`면 main checkout에 그 commit들과 겹치는 고친 file이 있는 것이다. main을 건드린 쪽(사람이나 다른 session)에게 알린다.
- 계획이 끝나면 계획 폴더를 지운 commit까지 land하고 lead worktree와 plan branch를 지운다(`git worktree remove`, `git branch -d plan/<계획>`).
- push는 사람 확인 뒤에만 한다.

## 상태 기록

`python3 -I project-docs/plan/tools/status.py <계획> set <id> <todo|running|review|merged|blocked> [branch] [commit] [기록]`. 막히면 `<계획> set <id> blocked "" "" "<이유>"`.

## 계약 바꾸기 요청

1. worker는 계약을 안 고치고 보고에 요청을 적는다.
2. lead가 받을지 정한다. 기준은 `project-docs/architecture/`와 PRODUCT.md다.
3. 받으면 plan branch에 작은 commit으로 계약을 고치고, 그 계약을 쓰는 `running` worker에게 SendMessage로 알린다.
4. 문서와 다르게 가야 하거나 제품 동작이 바뀌면 사람에게 묻는다.

## 막힘과 겪은 함정

- 문서에 답이 없으면 추천안으로 진행하고 기록해 둔다. 사람에게 올리는 것은 제품 동작, 비용, 되돌리기 비싼 것뿐이다.
- 권한 분류기가 `git push`, `git rebase`, merge script를 막을 수 있다. 우회하지 말고 무엇을 왜 하려는지 사람에게 말한다.
- 같은 file을 두 task가 원하면 한쪽에 소유를 주고 다른 쪽은 선행을 걸어 뒤로 미룬다.
- worktree 안 `.dev-data`에는 쓰기 금지 file(deno cache, core가 깐 읽기 전용 sdk 사본)이 남는다. `merge.sh`, `boot.sh`, `deno task dev:mock`은 지우기 전에 `chmod -R u+w`를 한다. 손으로 `git worktree remove`나 `rm`을 할 때 실패하면 `chmod -R u+w <worktree>/.dev-data` 뒤 다시 지운다.
- `deno task dev`는 `LOPHN_HOME`을 무시하고 저장소(worktree) 안 `.dev-data`를 쓴다.
- check:full이 못 보는 것: renderer build(`deno run -A packages/shell/renderer/build.ts`). 이것으로 main이 깨진 채 지나간 일이 있다.
- 계획 폴더 없이 worker 여럿을 돌릴 때도 모양은 같다: branch 하나에 합치고 main에는 사람이 확인한 뒤 올린다. 첫 worker를 main으로 바로 올렸다가 사람이 바로잡은 일이 있다.
- Agent tool의 `isolation: worktree`는 plan branch에서 갈라지지 않는다(main 쪽 옛 commit에서 시작한 일이 있다). launch.sh가 만든 worktree를 쓰고, 그렇게 못 했으면 worker가 먼저 `git reset --hard <합칠 branch>`를 하게 한다.
- worker가 자주 한 실수(보고를 diff와 대조하는 이유):
  - `*.placeholders.ts`를 손으로 고치다 괄호를 깨뜨린 채 commit했다. generate로 만든다.
  - template literal로 만드는 wording key(`` `common.label.tab-${dot}` ``)를 "쓰는 곳 없음"으로 보고 지웠다.
  - 설계와 안 맞는 test를 지우면서 그 test가 지키던 권한 경계 검사까지 없앴다.
  - 맡은 worktree가 아닌 곳에 commit했다.
  - 맡은 항목 일부를 "시간이 부족했다"며 남겼다. 다시 맡기면 끝냈다.
- schema 칸 이름을 바꾼 task 뒤에 type 오류가 나면 먼저 칸 이름(`run` → `turn` 같은 것)이 어긋난 곳을 의심한다.
- merge가 도는 동안 plan branch에 commit하지 않는다. merge.sh가 rebase한 뒤 ff하려다 `STOP: ff failed`로 멈춘다. status·이슈 commit은 merge 사이에 한다.
- land가 도는 동안 main에 코드를 commit하지 않는다. land.sh가 `STOP: land 사이 main에 코드가 바뀌었다`로 멈추고 full check부터 다시 돌아야 한다. 계획 문서(`project-docs/`)만 commit한 것은 land.sh가 받아 올린다.
- land.sh가 rebase 충돌로 멈추면 lead worktree에서 풀고 `git add`, `git rebase --continue` 뒤 land.sh를 다시 돈다. changelog 열린 판의 끝 항목은 다른 계획과 늘 부딪힌다: 둘 다 남긴다. plan branch를 손으로 `git rebase main`하는 명령은 분류기가 막았다(worker branch가 그 위에 있을 때). land.sh 길로 한다.
- lead가 쓸 문서(이슈 닫기, changelog, architecture)가 main에서 다른 계획이 고친 file과 겹치면, main에서 갈라진 branch에서 쓰고 land의 rebase가 끝난 뒤 lead worktree에 cherry-pick한다. 옛 base에서 쓰면 rebase 충돌이 문서마다 난다.
- wiring에 memory handler만 붙이고 팀 registration의 `memoryRoutes`에 route를 빼면 요청이 늘 `not_found`인데 check와 기동은 통과했다(여섯 route가 그랬다). 지금은 core 기동이 둘을 대조해 멈춘다.
- turn 경로(model resolver 같은 runtime 쪽 코드)가 machine 자격으로 새 read를 부르면 `packages/core/lophn-agent/run-loop/runtime-access.ts`의 `RUNTIME_MACHINE_ROUTES`에 그 route를 더한다. 빠지면 unit(가짜 machine)과 core 기동은 통과하고, e2e에서 모든 turn이 시작하자마자 `configuration_unavailable`로 끝났다.
- land와 merge를 background로 돌릴 때 출력은 `| tail`로 받지 말고 file로 받는다. land.sh는 단계 출력을 변수에 담았다가 끝에만 찍는다. e2e가 도는 동안의 진행은 그 test의 data root(`/tmp/lophn-e2e-*`)에 새 file이 쓰이는지로 본다(e2e가 멈춘 것을 40분 동안 몰랐다).
- 다른 계획의 land가 e2e를 돌리는 동안 같이 e2e를 돌리면 `reaction_test`의 crash-loop 단계가 멈춘 일이 한 번 있다(혼자 돌리면 통과, 원인은 확인 전). 그래서 land.sh가 lock으로 하나씩 돈다. 손으로 `pgrep -f 'land.sh …'`로 기다리지 않는다. 그 pattern이 기다리는 shell 자신의 command line에 있어 영영 끝나지 않았다.
- e2e가 한 test에서 끝없이 기다리면 먼저 그 run의 turn이 모두 실패하는지 본다(그 run data root의 `lophn.db` `turns.outcome_reason`). 모든 turn이 `configuration_unavailable`이던 bug가 40분 멈춘 land로 보였다.
- check가 `packages/shell/main/desktop/core/deno.lock`을 고쳐 둔다. lead worktree나 task worktree에 그 변경이 남아 있으면 rebase가 막히니 merge·land 전에 `git checkout --`로 되돌린다.
- fix task가 merge되면, 같은 길을 쓰는 running worker에게 그 사실을 바로 알리고 commit이 있으면 lead가 그 branch를 rebase한다. worker는 rebase할 수 없어서 옛 base에서 이미 고친 bug를 다시 쫓는다(앱 E2E worker 셋이 한 시간 가까이 그랬다).
- 같은 기계에서 E2E가 "부하 때문" flake로 보이면 먼저 사용자 단위로 공유하는 자원(`XDG_RUNTIME_DIR` 아래 socket, `/tmp`의 고정 이름)을 의심한다. 앱 start flake 둘이 core끼리 같은 socket 경로를 쓴 제품 bug였다.
- worker가 test에 기다림이나 우회를 넣어 통과시켰으면(보고의 "무겁게 짠 것") 제품 bug를 가린 것인지 본다. 가렸으면 그 test를 land 전에 fix task로 되돌린다.
- 이슈와 문서의 path는 저장소 root부터 쓴다. package 안에서 줄인 path는 docs check가 "없는 path"로 막는다.

## 사람에게 알리는 때

wave 하나가 끝났을 때(무엇이 merge됐는지, push할지), 계약을 고정했을 때, `blocked`를 lead가 못 풀 때, 문서와 다르게 가야 할 때, 그리고 `project-docs/issues/`에 이슈가 쌓였을 때.
