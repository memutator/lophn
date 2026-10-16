# screens-conversation-core-source

`AgentTabSource`를 core에 잇는 구현을 새로 짠다. 고정된 protocol의 route와 schema를 `CoreSource.call`로 부르고 화면 값(`ThreadView`, `Envelope`, `CallView` 등)으로 바꾼다. backend가 merge되기 전에는 돌려 볼 수 없으므로 type check와 route 이름·schema 일치까지 맞춘다. 실제 동작 확인은 통합 단계다.

- 단위: screens-conversation (wave 3)
- 선행: screens-conversation-source (`AgentTabSource` 타입), screens-data-waiting (`desktop/connection/waiting/decide.ts`의 결정 호출을 같이 쓴다)
- 소유(이 task만 고친다):
  - `packages/shell/renderer/conversation/agent-tab-core-source.ts` (새로: factory와 조립)
  - `packages/shell/renderer/conversation/agent-tab-core-source-thread.ts`, `-sessions.ts`, `-model.ts`, `-commands.ts`, `-rewind.ts`, `-calls.ts` (새로: 읽기와 쓰기를 주제별로)
  - `packages/shell/renderer/conversation/agent-tab-core-source-env.ts` (새로: `CoreSource.call` 한 겹, 오류 code 바꾸기, 메모)
- 읽을 것:
  - spec: S3 5·8장(call 상태 읽기와 tool) — `/home/pyosechang/projects/lophn/project-docs/tmp/specs/agent-call.md`
  - spec: S4 3·7장(질문 tool, commands) — `/home/pyosechang/projects/lophn/project-docs/tmp/specs/agent-definition.md`
  - spec: S8 3~5장(session 수명, rewind, fork) — `/home/pyosechang/projects/lophn/project-docs/tmp/specs/place-session.md`
  - spec: S5 7·8장(앱 rewind 계획과 결과) — `/home/pyosechang/projects/lophn/project-docs/tmp/specs/app-call.md`
  - inventory: `U2.2#17`(role 이름이 나오는 대화 쪽: `agent-core-source-face.ts`, `agent-core-source-values.ts`가 `context_engineer`를 `project_manager`로), `U2.1#1`(core source가 polling이 아니라 snapshot read만 한다), `I2.4#32`(`agent-core-source-commands.ts`가 같은 표를 한 번 더 적던 것을 없앤다. 명령 목록은 core read 한 곳에서 받는다)
  - 결정: `../README.md` 3장 #41(tool 이름 정본과 model용 이름), #57(`project_manager`), #4
  - 지금 코드(읽기만): `conversation/agent-core-source.ts`와 `agent-core-source-{commands,env,face,link,model,notices,rewind,thread,values}.ts`. 옛 모양을 새 모양으로 옮길 때 route 호출과 메모(`Memo`) 처리, 페이지 읽기(`Page`), 오류 code 구분(결과를 모르는 실패)을 재사용한다.
- 계약:
  - 쓰는 것:
    - `packages/protocol/lophn-agent/`(contract-calls-places·contract-agent-tools): sessions, messages(본문 read), calls(call 읽기와 취소), questions, commands, models, traces의 route와 schema
    - `packages/protocol/approvals`(contract-approvals): 결정 command와 결과
    - `packages/protocol/apps`(contract-app-calls): session·turn별 write invocation 목록과 앱 rewind 계획(session rewind의 앱 고르기가 읽는다)
    - `CoreSource.call` (`desktop/connection/connection.ts`)
  - 내놓는 것: `coreAgentTabSourceFactory(core: CoreSource): AgentTabSourceFactory`. view task가 기존 이름 `coreAgentViewSourceFactory`(`conversation/agent-core-source.ts`)로 다시 내보낸다.

## 할 일

1. `AgentTabSource`의 읽기 칸을 route로 옮긴다: `agent()`(agent 정의와 place와 grant 요약), `sessions()`, `thread(session)`(메시지 목록 page, tool 호출 기록, 질문 묶음 상태, call 블록, 대기 입력 `queued`, turn 상태), `body(message)`, `envelope(message)`, `callState(call)`, `model`, `commands`, `permissions`, `recap`. 본문은 한 번 읽으면 바뀌지 않으므로 메모한다(옛 `Memo`). 근거: `U2.1#1`.
2. 쓰기 칸을 옮긴다: `send`(`delivery`가 `next_turn`이면 입력함에 쌓고 `steer`면 도는 turn에 넣는다. 같은 id·key로 다시 보내도 core가 이전 결과를 돌려준다), `sendQueuedNow`, `removeQueued`, `stop`, `answerQuestions`, `decidePermission`(`waiting/decide.ts`와 같은 호출), `retryTurn`, session 관리(`openSession`, `renameSession`, `archiveSession`, `deleteSession`, `forkSession`, `compactSession`), `cancelCall`.
3. rewind를 옮긴다: `rewindPoints`, `rewindPreview`(`sessionRewindPreview`: 파일, 앱별 `app_writes`, 함께 되돌아갈 다른 변경, 되돌아가지 않는 external, 되돌릴 수 없는 write는 앱 rewind 계획 route가 주는 값), `rewind(session, message, { files, apps })`(`sessionRewind`의 `choice`는 `files`가 참이면 `restore_all`, 거짓이면 `messages_only`, `apps`는 고른 앱). 확인 창 열기는 없다. `undoEdit`·`redoRewind`는 만들지 않는다.
4. 이름을 바꾼다. `run` → turn, `correction` → steer, `context_engineer` → `project_manager`, `handoff` → call, `assignment` → agent와 place. 오류 code는 공통 일곱(`invalid_input`, `not_found`, `forbidden`, `unauthorized`, `conflict`, `unavailable`, `internal`)만 쓰고, 결과를 모르는 실패(`unavailable`, `internal`, 통로 실패)와 core가 처리하지 않았다고 답한 오류를 구별하는 규칙은 옛 `agent-core-source-env.ts`의 것을 그대로 쓴다. 근거: `U2.2#17`.
5. 옛 `agent-core-source*.ts`는 이 task가 지우지 않는다. `screens-conversation-view`가 `agent-core-source.ts`를 이 task의 factory를 다시 내보내는 file로 바꾸고 나머지를 지운다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test: 없음 (route 연결. 결과를 모르는 실패의 구별 규칙은 `delivery-state_test.ts`가 본다)
- 남지 않음: `grep -rn "context_engineer\|\"correction\"\|handoff" packages/shell/renderer/conversation/agent-tab-core-source*.ts`가 0줄이다.

## 보고

- 바꾼 file
- 등록할 것: 없음
- 안 쓰게 된 export: 옛 `agent-core-source*.ts` 전체(view task가 지운다)
- 정한 것: 각 화면 값을 채우는 route와 event의 짝(어느 값은 snapshot read, 어느 값은 event), 앱 write 목록을 읽는 route
- 계약 바꾸기 요청(wave 3): 화면 값에 모자란 칸(call 읽기, 대기 입력 목록, rewind 미리보기)이 있으면 여기 적는다
