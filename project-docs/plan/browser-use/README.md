# browser-use

- 목표: lophn 안의 agent(lophn agent, harness agent, 터미널의 coding agent)가 `lophn browser …` 명령과 skill로 자기가 연 browser 탭과 앱 preview 탭을 CDP로 보고 다룬다. 앱 preview를 탭으로 띄우고 등록한 기기 크기로 emulation한다.
- 재료: `project-docs/products/roadmap/browser-use.md`(지금 코드, 무엇을 만드나, 정한 것), `project-docs/architecture/{browser-tab,workspace-layout,app-call,annotation,coding-agent}.md`, `../harness-lab/_report/browser-use/`(`README.md`, `gooey-pi.md` §3·§5·§7, `paseo.md` §3·§7, `t3code.md` §3·§6·§7).
- 범위 밖: roadmap "하지 않는 것"(사람이 손으로 연 탭·앱 live 화면·artifact 다루기, 바깥 browser, upload·download, 일반 기기 표), 실제 폰(`roadmap/mobile.md`), extension tool을 남길지 지울지.

## 정한 것

roadmap `browser-use.md`의 "정한 것"이 이 계획의 결정이다. 줄이면:

- CLI + skill이다. `lophn browser` 명령을 본체에 둔다. extension tool이 아니다. (사람, 2026-11-09)
- host queue는 long-poll로 바꾸고, browser 호출은 지금 `tool_call` 결과 길(`host/done`)을 같이 쓴다. 호출마다 기한을 둔다. (사람, 2026-11-09)
- 다루는 탭은 `tab open`으로 연 탭이고 주인(session 또는 사람 token)만 다룬다. 사람 token도 `tab`·`browser` 명령을 부른다. (agent)
- 앱은 preview만 다룬다. live 화면은 다루지 않는다. (agent) live 화면을 누르면 사람 신원으로 operation 막기를 건넌다.
- page에서 온 글은 `<lophn-untrusted>`로 감싼다. lophn agent는 tool 이름 규칙, harness CLI는 stdout 글. (agent)
- 행동은 `act` 하나로 묶고, ref는 snapshot마다 새로 나며 낡은 ref는 `conflict`다. 묻지 않는다. (agent)
- agent가 연 browser 탭은 agent 전용 partition을 쓰고, `evaluate`는 browser 탭에도 준다. (agent, 사람이 뒤집을 수 있음)
- take control: 사람이 가져오면 agent의 쓰기는 `conflict`, 읽기는 된다. (agent)
- 기기 목록은 사람이 등록한 기기뿐이다. emulation은 shell 본체의 preview 탭에 둔다. (사람, 2026-11-08)

## task

| wave | id | 하는 일 |
|---|---|---|
| 1 | `bu-preview` | 탭 kind `app_preview`(저장 안 함, 안내 줄, [Stop], 멈춘 뒤 화면), `tab open --preview <app>`(그 앱 workspace session과 사람 token, 돌고 있는 preview 없으면 `conflict`), preview annotation(bundle hash) |
| 2 | `bu-call` | host queue long-poll(`host/take` 기다림, shell loop), 요청 종류 `browser_call`과 호출 기한, `lophn browser snapshot\|act\|navigate\|screenshot\|evaluate\|logs\|wait` route·CLI, 사람 token 열기와 주인 "사람", untrusted 감싸기, screenshot(lophn agent image content, harness는 file path), 공유 skill `lophn-agent` |
| 3 | `bu-cdp` | shell main CDP(debugger attach, accessibility snapshot과 ref, `Input.*`, screenshot, evaluate, console, wait, dialog 자동 닫기, focus emulation, DevTools 열림 `conflict`), take control(탭 머리와 main 표시), agent 전용 partition |
| 4 | `bu-device` | Settings 기기 등록, preview 탭 기기 고르기와 폰 테두리, `tab open --preview --device`, emulation |

모두 한 줄로 선다. 같은 file(`packages/protocol/lophn-agent/host-queue.ts`, `packages/cli/commands/tab.ts`, `packages/shell/main/desktop/wiring/surface.ts`, `renderer/workspace/use-surface-requests.ts`)을 차례로 고친다.

## lead가 할 일

- `project-docs/plan/tools/lead/lead.sh browser-use`가 연 worktree에서만 일한다. 도구의 첫 인자는 계획 이름이다.
- brief는 lead가 쓴다(`.claude/skills/orchestrate/brief-template.md` 꼴). 쓴 뒤 `status.py browser-use build`를 돌린다. roadmap "지금 코드"의 path는 2026-11-09 조사다. brief를 쓸 때 코드로 다시 맞추고, 정한 것이 코드와 맞지 않으면 고치지 말고 planner에게 보고한다.
- brief에서 고정할 것:
  - `browser_call` 요청과 결과의 꼴, 호출 기한 값, long-poll 기다림 값과 shell이 붙어 있다고 보는 규칙(지금 `ATTACHED_MS` 3초).
  - `act`의 action별 입력, ref 꼴, 오류 code(공통 일곱 안에서: 낡은 ref·DevTools·take control은 `conflict`, shell 없음·기한은 `unavailable`, 남의 탭은 `not_found`).
  - harness CLI의 screenshot file 자리와 untrusted tag 꼴.
- 다른 계획과 겹침: `workspace-layers`의 `wmem`이 `packages/protocol/lophn-agent/input-tags.ts`(`UNTRUSTED_SOURCES`)를, `wlophn-core`가 `packages/core/main/daemon/wiring/extension-tools.ts`를 소유한다. `status.py ready`가 running 소유 겹침을 막는다. `bu-call`을 띄우기 전에 그 계획 상태를 본다.
- 위험 test:
  - 남이 연 탭과 사람이 손으로 연 탭을 `browser` 명령이 다루지 못한다.
  - 앱 live 화면에는 닿지 않고, `tab open --preview`는 그 앱 workspace session과 사람 token만 연다.
  - page 글이 `<lophn-untrusted>`로 감싸지고 안의 같은 tag가 닫지 못한다.
  - take control 중 쓰기는 `conflict`다.
  - 기한을 넘은 호출은 `unavailable`로 끝나고 매달리지 않는다.
- CDP와 emulation은 진짜 Electron 창에서 확인해야 한다. 새 Electron·E2E test를 만들기 전에 사람에게 묻는다.
- 동작을 land하는 같은 변경에서 문서를 고친다.
  - `browser-tab.md`: CDP, agent partition, take control, dialog.
  - `workspace-layout.md`: host queue long-poll, `browser_call`, preview 탭 대상.
  - `annotation.md`: preview annotation.
  - `coding-agent.md`: 공유 skill과 사람 token의 `tab`·`browser`.
  - `app-call.md`: preview 탭.
  - roadmap `agent-platform.md` 정한 것: preview 테스트를 연 것.
  - roadmap `browser-tab.md` "하지 않는 것": agent가 page를 다루는 것.
  - roadmap `app-preview.md`: 1~3이 끝났다는 상태 줄.
- 끝나면 changelog 열린 판에 항목을 남기고 `wrap-plan`을 planner에게 넘긴다.
- 사람에게 묻는 것: push, 새 Electron·E2E test, 실제 model provider 호출.
