# term-phone

폰 앱을 core가 터미널과 coding session을 갖는 모양에 맞춘다: 터미널 열기와 입력은 desktop과 같은 `terminals/open`·`terminals/input`을 쓰고, 컴퓨터의 앱이 꺼져 있어도 목록과 열기가 되므로 "lophn is not running"과 깨우기를 걷고 창을 기다리던 문구와 시간을 고친다. 화면 사본 방식(`terminal_view/snapshot|watch|resize`)은 그대로다.

- 단위: term (wave 4)
- 선행: `coding-core`.
- 소유(이 task만 고친다):
  - `packages/mobile/src/data/{terminal,coding,mod,sample}.ts`, `packages/mobile/src/data/hooks.tsx`, `packages/mobile/src/data/{terminal,coding}.test.ts`
  - `packages/mobile/src/screens/coding/`, `packages/mobile/src/screens/terminal/`, `packages/mobile/src/screens/session/{conversation,new-session}.tsx`, `packages/mobile/src/app/sidebar.tsx`
  - `packages/design/i18n/catalog/mobile-app.ts`
  - `tools/wireframes/drafts/phone/coding.tsx`
- 읽을 것:
  - 계획 README "정한 것"(화면은 route로만, 터미널은 core가 연다, 입력 자격), 범위 밖(폰이 날 글자 stream으로 그리기)
  - 계약: `project-docs/plan/core-terminals/tasks/term-contract.md` "고정할 모양"(`terminals/open`·`terminals/input`의 입력과 기기 허락, link 목록의 `coding_sessions/wake`·`shell` 칸·`terminal_view/open|input`)
  - architecture: `project-docs/architecture/remote.md`(폰의 coding session과 터미널 보기), `project-docs/architecture/terminal-agent.md` 초안의 폰 터미널 보기
  - 화면 본보기: `tools/wireframes/drafts/phone/coding.tsx`(Sessions down 상태)
  - `packages/mobile/README.md`(dev build, emulator, 개발 core와 pairing)
- 계약:
  - 쓰는 것: `packages/protocol/coding-agent/terminals.ts`의 `terminals/open`(`{project, key, tab: {relation: null}}`)과 `terminals/input`(`{terminal, text, key}`), `packages/protocol/coding-agent/relay.ts`의 `coding_sessions/*`
  - 내놓는 것: 없음

## 할 일

1. **열기와 입력.** `src/data/terminal.ts`의 `openTerminal`은 `terminal_view/open` 대신 `terminals/open`에 `{project, key, tab: {relation: null}}`을 보내 답의 `terminal`을 쓴다(그 project를 보는 desktop 창이 있으면 탭이 선다). 입력은 `terminal_view/input` 대신 `terminals/input`에 같은 `key`를 실어 보낸다. 입력 허락이 없으면 지금처럼 `forbidden`이고 `terminal_view/snapshot`의 `input`으로 입력 칸을 그린다. 화면 보기·lease·크기 잡기(`terminal_view/snapshot|watch|resize`, `TerminalScreenChanged`)는 바꾸지 않는다.
2. **깨우기 걷기.** 컴퓨터의 앱이 없어도 coding session 목록과 열기가 되므로 `codingSessionsWake` 호출, `useCodingActions().wake`, `useCodingSessions().shell`을 보는 갈래, `screens/coding/wake.tsx`의 `NotRunning`과 그것을 쓰는 `list.tsx`·`continue.tsx`·`pick.tsx`의 "lophn is not running" 상태를 지운다. 첫 읽기 실패(`ReadFailed`)는 남긴다. `shell` 칸은 `term-cleanup`이 protocol에서 지우므로 더는 읽지 않는다.
3. **문구와 기다림.** 열기가 창을 기다리지 않는다. "a window for the project opens there" 같은 설명과 창을 기다리던 시간(예: `wake.tsx`의 `STARTING_MS`)을 고친다. `coding_sessions/open` 뒤 GUI handle이 서기까지의 기다림은 목록 바뀜(`StateChanged{coding_sessions}`)으로 본다. 화면 문구는 `packages/design/i18n/catalog/mobile-app.ts`의 key로 둔다. 지운 key는 catalog에서도 지운다.
4. **gallery.** `tools/wireframes/drafts/phone/coding.tsx`의 Sessions down 상태를 걷어 화면과 맞춘다(`ui-design` skill).
5. **test.** `src/data/{terminal,coding}.test.ts`를 새 route에 맞춘다. 위험이 없으면 test를 더하지 않는다.
6. **desktop과 같이 쓰는 file.** 폰이 source로 읽는 `packages/shell/renderer/` file은 `term-desktop`의 것이다. 그쪽 변경으로 typecheck가 깨지면 그 file은 고치지 말고 보고에 적는다.

## 끝남

- `cd packages/mobile && npm ci && npm run typecheck && npm test`가 통과한다. `npm run check`가 통과하고 `npm run wireframes`가 된다.
- 위험 test: 없음(입력 허락은 core에서 `term-host`의 test가 본다).
- 남지 않음: `grep -rn "terminalViewOpen\|terminalViewInput\|codingSessionsWake\|NotRunning\|\.wake(" packages/mobile/src tools/wireframes/drafts/phone`가 0줄이다. `grep -rn "\bshell\b" packages/mobile/src/data/hooks.tsx packages/mobile/src/screens/coding`에 coding session 목록의 `shell` 칸을 읽는 줄이 없다. 지운 화면 문구 key를 catalog에서 한 번 더 grep한다.
- 새 E2E와 실제 폰·emulator를 띄우는 test는 만들지 않는다. 실제 relay에 붙지 않는다(개발 root에서 `remote.enabled`를 켜기 전에 `remote.relay`를 비운다).

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: lead가 고칠 목록 file(`protocol/*/mod.ts`, core 조립 목록, gallery `pages/index.ts`, `package.json`)
- 안 쓰게 된 export(남이 쓰던 것은 지우지 않는다)
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 넘길 줄: 남의 file을 최소로 맞춘 곳
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- **무겁게 짠 것**: 가장 단순한 구현(AGENTS.md "속도")보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것. 없으면 "없음"
