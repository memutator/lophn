# harness-global-confirm

coding 터미널을 열 때 shell main이 앱 폴더에 설치하던 것을 없애고, 그 harness의 전역 hook·skill이 없으면 사람에게 한 번 묻고 등록한다. 등록 결과는 사람에게 보인다.

- 단위: harness (wave 2)
- 선행: harness-global-install. `lophn harness install`의 새 입력(`dry_run`)과 출력(`files`, `missing`)을 쓴다.
- 소유(이 task만 고친다):
  - `packages/shell/main/terminal/coding/requests.ts`
  - `packages/shell/main/desktop/wiring/coding.ts`
  - wording catalog에 key를 더하는 것은 소유 밖이어도 된다(`packages/design/wording/catalog/common.ts`와 생성물 `common.placeholders.ts`. 아래 5).
- 읽을 것:
  - architecture: `project-docs/architecture/coding-agent.md` (흐름의 `lophn harness install`, "skill과 hook은 앱 source 폴더 안에만" 문장). 문서는 lead가 고친다.
  - 이슈: `project-docs/issues/coding-agent.md`의 "harness 설치를 열 때마다 앱 폴더에 하지 않고 전역에 한 번 한다"
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `shell`, `coding-agent-harness-api`
  - 본보기(묻는 길): `packages/shell/main/desktop/wiring/desktop.ts`의 `createQuitFlow({ confirm })`(Electron `dialog.showMessageBox`)와 `packages/shell/main/desktop/quit.ts`의 `quitDialogOptions`. 같은 방식으로 묻는다. 새 IPC, renderer 화면, approval 흐름은 만들지 않는다.
  - wording: `.claude/skills/wording/SKILL.md`, `packages/shell/main/desktop/wording.ts`(`word()`는 placeholder 없는 key만 받는다)
- 계약:
  - 쓰는 것: `lophn harness install --input '{"harness":"<id>","dry_run":true}'`가 `{skill, hook, files}`를 돌려준다. outcome: dry_run은 `unchanged | missing | not_supported`, 실제 install은 `installed | unchanged | not_supported | failed`. `dry_run`을 빼면 실제로 쓴다.
  - 내놓는 것: 없음(shell 안에서 끝난다).

## 할 일

1. `requests.ts`
   - `install(harness, folder)`와 그 주석, `open`의 `await install(plan.harness_id, plan.cwd)`를 지운다.
   - `CodingTerminalDeps`에 `register?: { ask(input: { harness: string; files: string[] }): Promise<boolean>; show(input: { harness: string; ok: boolean; files: string[]; message?: string }): Promise<void> }`를 더한다(없으면 묻지 않는다 = 등록 안 함). 이 module은 계속 electron을 모른다.
   - `open`에서 `checkFolder` 뒤, spawn 전에 `ensureRegistered(plan.harness_id)`를 한 번 부른다:
     1. `deps.runCli`가 null이면 건너뛴다.
     2. `runCli(["harness","install","--input",JSON.stringify({harness, dry_run:true})])`. 실패하거나 모양이 맞지 않으면 건너뛰고 session은 연다(이전처럼 설치 실패가 맡기기를 막지 않는다).
     3. `skill`이나 `hook` 중 하나라도 `missing`이면 `register.ask({harness, files})`. 거절하면 건너뛴다(거절을 기억하지 않는다. 다음에 다시 묻는다).
     4. 허락하면 `dry_run` 없이 같은 명령을 돌리고 `register.show`로 결과(성공, 실패와 이유 한 줄, 쓴 `files`)를 사람에게 보인다. 예외는 삼키지 말고 `show`에 실패로 넘긴다.
   - 같은 harness로 두 session이 동시에 열려도 묻는 창은 하나다: harness별 진행 중 Promise를 `Map`으로 쥐고 같은 것을 기다린다.
   - 머리 주석의 설명("skill·hook 설치는 건너뛴다" 등)을 맞춘다.
2. `wiring/coding.ts`
   - `createCodingTerminalRequests`에 `register`를 끼운다. `electron`에서 `BrowserWindow, dialog`를 import한다(`app`은 이미 있다). `quit` 쪽처럼 `BrowserWindow.getFocusedWindow()`가 있으면 parent로 `dialog.showMessageBox`.
   - `ask`: 단추는 등록(기본이 아님)과 취소(`defaultId`·`cancelId`는 취소, Esc는 취소). 본문은 catalog 문장 하나("이 coding agent의 사용자 설정에 lophn hook과 skill을 한 번 추가한다. lophn coding session이 아닐 때는 아무것도 하지 않는다" 뜻) + 빈 줄 + `HARNESS_ADAPTERS[harness].label`과 `files` 목록(문구가 아니라 data라 catalog 밖이어도 된다).
   - `show`: 성공이면 catalog 문장 + `files`, 실패면 catalog 문장 + 이유. 단추 하나.
   - headless(`ctx.headless.headless`)이면 창을 띄우지 않는다: `ask`는 false, `show`는 아무것도 안 한다.
   - `runCli` timeout 15초(`childCliRunner`의 `timeout_ms: 15_000`)는 install에는 충분하다. 묻는 동안은 CLI가 안 돌고 있으니 timeout과 상관없다.
3. wording: 사람에게 보이는 고정 문구라 `word()`로 읽는 key를 `common` 영역에 더한다(예: `common.title.register-coding-agent`, `common.button.register`, `common.notice.register-coding-agent`(마침표 있는 문장), `common.title.coding-agent-registered`, `common.notice.coding-agent-registered`, `common.title.coding-agent-register-failed`, `common.notice.coding-agent-register-failed`). 이름은 wording skill 규칙(part별 마침표)에 맞게 정한다. placeholder를 쓰지 않는다(`word()` 제약). `common.button.cancel`은 이미 있다. `deno task wording`으로 생성물을 만든다(손으로 고치지 않는다). 문구는 영어다(en catalog만 있다).

## 정한 것

- 묻는 길은 Electron native dialog 하나다. `approval`이나 renderer 화면이 아니다: 사람이 사용자 전역 설정을 건드릴 때 한 번 보는 OS 확인이라 quit 확인과 같은 종류이고, core 쪽 상태·route를 늘리지 않는다.
- 거절은 저장하지 않는다. 거절하면 그 session은 hook 없이 열리고(state는 unknown, 메시지는 `state_unknown`으로 거절) 다음에 맡길 때 다시 묻는다.
- "있는지" 보기는 `dry_run`이 내용 일치가 아니라 존재만 본다(`harness-global-install`). lophn이 업데이트돼도 다시 묻지 않는다.

## 끝남

- `deno task check`가 통과한다(wording 생성 check 포함. `deno run --allow-read tools/check-wording.ts`도 돌린다).
- 위험 test: 없음. 묻는 창과 CLI 호출은 화면·내부 구현이다.
- 남지 않음: `grep -n "folder\|plan.cwd" packages/shell/main/terminal/coding/requests.ts`에서 install에 앱 폴더를 넘기는 곳이 없다. `install(`이 열 때마다 무조건 도는 곳이 없다(`dry_run`으로 `missing`을 본 뒤 허락했을 때만 쓴다).
- 확인: `mkdir -m 700 -p $PWD/.dev-data/harness-global-confirm && export LOPHN_HOME=$PWD/.dev-data/harness-global-confirm`로 shell을 headless로 띄우고(`LOPHN_SHELL_HEADLESS=1`) 창이 안 뜨고 session이 열리는지 본다. 실제 `~/.claude` 등은 쓰지 않는다. 실제 창은 사람이 본다(보고에 "사람이 눈으로 볼 것"으로 적는다).

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: wording 생성물이 바뀌었으면 알린다
- 정한 것
- 넘길 줄
- 계약 바꾸기 요청
- **무겁게 짠 것**
- **알려진 미완 동작**
