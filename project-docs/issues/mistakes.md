# mistakes

worker가 크게 잘못한 것. 코드가 아니라 context(AGENTS.md, skill, architecture 문서)나 check를 고친다.

## 터미널 탭에서 부르는 `lophn gui`가 개발 앱이 아니라 `~/.lophn`의 앱으로 감

```yaml
kind: mistake
modules: [packages/shell/terminal-host, tools]
```

지금: harness-gui의 gui-window task가 shell 시작 층에 `claude gui` 함수를 넣으며 `lophn`을 이름으로 불렀다. lead review가 "개발 앱 터미널에는 `lophn`이 PATH에 없다"를 찾아 CLI 경로만 넣게 고쳤고, 같은 원인(터미널 env가 `LOPHN_*`를 지운다)으로 data root도 빠진다는 것은 놓쳤다. dev CLI launcher가 `~/.lophn`을 기본값으로 잡아, 사람이 개발 앱 터미널에서 `claude gui`를 치자 설치본의 Home 창이 떴다. 설치본이 꺼져 있었으면 저장소의 개발 code가 실제 `~/.lophn`으로 떴다.

영향: 사람의 시험 한 판. 사람의 data root에 개발 판 schema가 적용될 뻔했다.

원인: 터미널 탭에서 lophn을 부르는 code가 무엇을 shell main에서 받아야 하는지 적힌 곳이 없었다(`terminal-agent.md`에는 env를 지운다는 사실만 있다). brief도 그것을 말하지 않았다.

막기: `terminal-agent.md` "지키는 것"에 "터미널 탭 안에서 lophn을 부르는 code는 CLI 경로와 data root를 shell main에서 받는다(터미널 env에는 `LOPHN_*`가 없다)"를 둔다. 저장소 실행의 `lophn gui`는 data root가 `~/.lophn`이거나 없으면 앱을 띄우지 않는다(fix task, 위험 test).

## 계획이 본보기와 다른 모양을 정했는데 lead review가 README 대조만 함

```yaml
kind: mistake
modules: [tools]
```

지금: deferred-tools 계획은 "Claude Code의 ToolSearch와 같은 꼴"을 목표로 했지만, "정한 것"에서 숨김을 role마다 손으로 적은 이름 목록 넷(role prompt에 이름이 나오는지로 고름)으로 정했다. Claude Code는 tool 정의의 `shouldDefer` 하나로 정하고, role 구분은 이미 권한 목록(`builtinToolNames`)이 하고 있었다. worker는 README대로 만들었고 lead는 diff가 README와 같은지만 보고 merge했다. eval까지 돈 뒤 사람이 물어서 드러났고 wave 2로 다시 만들었다.

영향: worker 한 판, eval 한 판($1.52), 사람의 시간. 같은 개념(어느 role이 무엇을 보나)을 두 목록이 갖게 될 뻔했다.

원인: 계획이 본보기를 이름으로만 가리키고(조사 문서 README), 본보기의 판단 장치(`source/deferral-policy.js`)를 "정한 것"과 대조하지 않았다. orchestrate review 표에는 "계획의 목표·본보기와 맞나" 칸이 없다.

막기: 추천은 둘이다. planner-persona skill에 "본보기를 따른다고 쓴 계획은 정한 것마다 본보기의 해당 장치와 다른 점을 한 줄로 적는다"를 더한다. orchestrate skill review 표에 "계획 목표 문장(사람의 말)과 본보기에 비춰 모양이 맞나"를 더한다.

## app command dispatch가 wire 이름이 아닌 이름을 돌려 모든 앱 command 호출이 실패

```yaml
kind: mistake
modules: [packages/core/lophn-agent]
```

지금: command-surface의 app-commands task가 `prepare.ts`의 `dispatch`에서 풀린 앱 command를 `<domain>.<command>` 이름으로 돌려줬다. 실행기는 wire 이름(`<domain>_<command>`)으로 찾아 `lophn <domain> <command>`가 모두 "tool is not available"이었다. worker는 실제 turn으로 돌려 보지 않았다고 보고했고 unit test는 풀기까지만 봤다. 같은 계획의 e2e-rewrite가 e2e로 찾았고 merge 전에 고쳤다(`resolveAppCall`이 wire 이름을 낸다).

영향: 계획의 핵심 기능이 plan branch에서 한동안 동작하지 않았다. main에는 가지 않았다.

원인: dispatch를 바꾸는 task의 끝남에 "풀린 호출이 실행기의 찾기까지 이어진다"는 기준이 없었다. 내장 명령의 길(`resolveLophnCall`)은 wire 이름을 냈는데 새 길이 그것을 따르지 않았다.

막기: `packages/core/lophn-agent/tools/app-public_test.ts`에 풀린 앱 command를 `toolForWireName`으로 찾는 test를 더했다. 실행 경로를 바꾸는 brief의 위험 test는 "입력부터 실행기까지 한 번 이어 본다"로 쓴다.

## SDK 판을 올리면서 workspace pin 하나를 빠뜨려 새 `npm ci`가 깨짐

```yaml
kind: mistake
modules: [packages/sdk, tools]
```

지금: skill-share 계획의 app-skill-decl task가 `@lophn/declaration`과 `@lophn/app-ui`를 2.1.0으로 올리며 `tools/wireframes/package.json`의 `"@lophn/app-ui": "2.0.0"`을 남겼다. workspace에 2.0.0이 없어 npm이 registry에서 찾다 404로 `npm ci`가 실패했다. merge.sh의 check:full과 core 기동은 이미 깔린 `node_modules`로 돌아 통과했고, 다음 worktree를 만드는 launch.sh(`worktree-prep.ts`의 `npm ci`)에서 드러났다. lead가 pin을 고쳤다.

영향: plan branch가 새 clone, 새 worktree, 패키징(`tools/package/main.ts`도 `npm ci`)에서 깨진 채 merge됐다. main에는 가지 않았다.

원인: brief가 판이 박힌 곳을 조사 목록으로 줬는데 그 목록이 `tools/` 아래를 빠뜨렸다. 판 올림을 확인하는 check가 없다.

막기: check의 deps 단계에 "workspace package의 `@lophn/*` 의존은 그 workspace의 지금 판과 같다"를 더한다(`package.json` 파일만 읽는다). 판을 올리는 brief의 끝남에는 `grep -rn '"@lophn/<이름>": "<옛 판>"' --include=package.json .`가 0줄을 넣는다.

## tray popup과 앱 sidebar panel이 판 없이 앱 view를 열어 모든 열기가 거절되고 "Couldn't load"

```yaml
kind: mistake
modules: [packages/shell/renderer, tools]
```

지금: tray popup과 앱 sidebar panel의 `EmbeddedView`가 `release`를 주지 않고 live view를 열었다. main의 `checkOpen`(`view-model.ts`)은 live를 판 없이 열면 `invalid_input`으로 거절하므로 사람은 모든 tray popup과 sidebar panel에서 "Couldn't load"를 봤다. worker들은 "진짜 Electron에서 돌리지 않았다"고 보고했고 lead는 gallery screenshot만 보고 merge와 packaging을 했다. gallery의 가짜 view(`mockViews`)는 main의 열기 검사를 건너뛰어 화면이 멀쩡히 그려졌다. 사람이 쓰면서 찾았다.

영향: 새로 넣은 두 자리가 출하된 판에서 한 번도 동작하지 않았다.

원인: `AppViewOpen`의 `release`가 mode와 상관없이 optional이라 판 없는 live 열기가 compile을 통과했다. "새 앱 view 자리는 진짜 앱에서 한 번 연다"는 지침이 review 표에 없었고, 보고의 "확인 못 함"을 lead가 확인하는 규칙이 gallery 화면 확인으로 대체됐다.

막기: `appViewOpenSchema`를 mode로 가르는 union으로 바꿔 live는 `release` string이 필수다(판 없는 live 열기는 compile error라 check가 잡는다). 그리고 새 앱 view 자리는 merge 전에 진짜 Electron 앱에서 한 번 열어 본다는 문장을 orchestrate skill의 review 표(lead가 merge 전에 읽는 곳)에 더했다. 방법은 headless 창 + `--remote-debugging-port` + CDP로 열어 screenshot을 보는 것이다.


## orchestrate skill대로 wave마다 land하면 계획이 land 대기에 묶인다

```yaml
kind: mistake
modules: [tools]
```

지금: orchestrate skill의 "merge" 절과 `project-docs/plan/tools/lead/land.sh` 머리 주석이 "wave가 모두 merged면 land"로 정한다. land는 lock을 잡고 main 위로 rebase하고, `check:full`, e2e 전체, core 두 번 기동을 거친 뒤 main을 fast-forward한다. workspace-layers는 wave가 넷이고 wave 2·3·4가 task 하나씩이라, task 하나마다 land가 붙는다. land가 도는 동안 lead는 plan branch에 commit할 수 없고, launch.sh가 status를 바꾸므로 다음 wave도 띄우지 않고 기다린다. wave 1 land는 세 번 돌았다.
- 첫 번째: 다른 session이 main에 더한 의존성(`@xterm/addon-unicode11`) 때문에 lead worktree의 `node_modules`가 낡아 wireframes smoke에서 멈췄다.
- 두 번째: `npm ci` 뒤 다시 돌렸는데 e2e 한 줄(옛 lophn id 기대값)에서 멈췄다.
- 세 번째: 그 줄을 고친 뒤 다시 돌렸다.

영향: 사람의 시간. 계획 하나의 대부분이 land와 그 대기로 간다. lock 때문에 다른 계획의 land와도 줄을 선다. 사람이 "왜 wave마다 그 긴 과정을 거치나"라고 물어 드러났다.

원인: skill이 land 때를 wave로만 정했다. wave가 차례로만 이어지고 wave마다 task가 하나인 계획에도 같은 규칙이 걸린다. 중간 land의 값(main과 일찍 맞추기, e2e 실패를 좁히기)과 비용을 견주는 기준이 없다. land.sh는 rebase 뒤 의존성이 바뀌어도 `npm ci`를 하지 않는다.

막기:
- orchestrate skill과 land.sh 주석을 바꾼다. land는 계획 끝에 한 번이 기본이다. 중간 land는 다음 셋 가운데 하나일 때만 한다. 이번 계획은 wave 1(migration)만 land하고 나머지는 `wui` 뒤에 한 번 land한다.
  - 사람의 data root 모양을 바꾸는 migration이 든 wave
  - main에서 같은 file을 고치는 다른 계획이나 session이 있을 때
  - plan branch가 오래 열려 rebase가 커질 때
- e2e는 land에서만 돌므로, land를 미루면 e2e 실패가 늦게 드러난다. 그 대신 protocol 이름이나 id 꼴을 바꾼 task의 brief "남지 않음" grep에 `tests/`를 넣는다. 이번 실패는 brief grep이 `packages tools`만 봐서 `tests/e2e`의 옛 문자열 기대값을 놓친 것이다.
- land.sh가 rebase 뒤 `package-lock.json`이 바뀌었으면 `npm ci`를 돌린다.
