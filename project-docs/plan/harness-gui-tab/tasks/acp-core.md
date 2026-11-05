# acp-core

lophn core가 새 ACP 입력·갱신(acp-session)을 lophn agent session에 대해 채운다. 입력은 지금 route로 옮기고(model 고르기, mode·skip, slash 명령, rewind, fork, compact, 이름), snapshot과 갱신에 `session` meta와 capability를 싣는다. lophn agent의 동작은 바뀌지 않는다(README 정한 것 5).

- 단위: acp (wave 2)
- 선행: acp-session
- 소유(이 task만 고친다):
  - `packages/core/main/daemon/wiring/acp-send.ts`
  - `packages/core/main/daemon/wiring/acp-send_test.ts`
  - `packages/core/main/daemon/wiring/acp-build.ts`
  - `packages/core/main/daemon/wiring/acp-build_test.ts`
  - `packages/core/main/daemon/wiring/acp.ts`
  - `packages/protocol/events/acp-project.ts`
- 읽을 것:
  - architecture: `project-docs/architecture/acp.md`("core가 하는 것", "입력", "권한"), `agent-chat.md`
  - 계획: `project-docs/plan/harness-gui-tab/README.md` 정한 것 5, `tasks/acp-session.md`(새 꼴. 이 task가 채울 칸)
  - 조사: `/home/pyosechang/projects/lophn/.cache/harness-gui-research/code.md` §4
  - 지금 renderer가 core route로 하는 일(이 task가 core로 옮길 논리의 본보기. 고치지 않는다, `acp-screen`이 지운다): `packages/shell/renderer/conversation/agent-tab-core-source-model.ts`(model 목록·축·지금 값·층, `shownModelsRead`, `agentRead`, `changeSessionModel`), `-commands.ts:94-114`(skill 명령을 사람 메시지로 보내기), `-sessions.ts:270-375`(이름, skip, fork, compact), `-rewind.ts:117-204`(preview를 읽고 hash와 함께 `sessionRewind`), `-status.ts`(`sessionStatusRead`)
  - route: `packages/protocol/lophn-agent/sessions.ts`(`renameSession`, `forkSession` 입력 `{id, source, through_seq}`, `requestSessionCompact`, `changeSessionModel`, `changeSessionSkip`), `commands.ts`(`commandsList`, `BUILTIN_COMMAND_IDS`), `models.ts`(`shownModelsRead`), `session-status.ts`(`sessionStatusRead`), `session-rewinds.ts`(`sessionRewindPreview`, `sessionRewind`), `agent-sessions.ts`(`placeSessionRead`의 `title`, `skip`)
  - 지금 core: `packages/core/main/daemon/wiring/acp.ts`(snapshot은 `machine:acp` 자격 `:51-55`, writer 감싸기 `:345-357`, Bus 구독), `acp-send.ts`(분배), `acp-build.ts`(`buildAcpState :598`, 승인 pending), `packages/protocol/events/acp-project.ts`(`TurnRequestOpened` → `approval_opened`)
- 계약:
  - 쓰는 것: acp-session의 `AcpSessionMeta`, `AcpCapabilities`, 새 `AcpInput`·`session_changed`. 지금 core route(model·skip·slash·rewind·fork·compact·rename)
  - 내놓는 것: `AcpSnapshot`의 `session` meta, `AcpUpdated`의 `session_changed`, `AcpSend`가 새 입력을 받는 것(권한은 가는 route가 본다, `acp.md` "권한")

## 할 일

lophn agent의 동작은 바꾸지 않는다. 화면이 지금 core route로 직접 하던 일을 같은 route, 같은 자격(부른 사람)으로 core가 한다(`acp.md` "권한": `AcpSend` 자체는 scope를 더 보지 않고 가는 route가 본다).

1. `acp-send.ts`: 새 입력을 지금 route로 보낸다. key는 입력의 `key`다.
   - `set_model {model, options}` → `changeSessionModel`(model id는 이 task가 정한 꼴을 풀어 provider와 이름으로. 지금 `agent-tab-core-source-model.ts:206,276`과 같은 입력).
   - `set_mode {mode}` → `changeSessionSkip {skip: mode === "skip"}`. lophn의 mode는 `ask`와 `skip` 둘이다.
   - `run_command {name, argument}` → skill이면 `SendMessage`로 `Use the "<skill>" skill for this request.`(argument가 있으면 빈 줄 뒤에)를 `next_turn`으로 보낸다(지금 renderer `runCommand`와 같은 글, `packages/design/i18n/catalog/conversation.ts`의 `conversation.body.skill-command-request`). builtin 이름은 화면이 처리하므로 `invalid_input`이다.
   - `rewind {message, files, apps}` → 부른 사람 자격으로 `sessionRewindPreview`를 읽고 그 hash와 함께 `sessionRewind`(`files`면 `restore_all`, 아니면 `messages_only`. 지금 `rewindSession`과 같다). 숨긴 구간 갱신은 지금 writer 감싸기가 낸다.
   - `fork {message}` → `forkSession {id: 새 ses, source, through_seq}`(through_seq는 message의 순번. null이면 끝까지). 새 session id를 `AcpSend` 출력으로 돌려준다(`acp-session`이 출력 꼴을 정한 뒤. 정해지지 않았으면 보고한다).
   - `compact` → `requestSessionCompact`(지금 `compactSessionOf`와 같은 compare).
   - `rename {title}` → `renameSession`.
   - `decide`의 `session` choice는 `invalid_input`(lophn은 내놓지 않는다).
2. `acp-build.ts`: snapshot에 `session` meta를 채운다. `title`과 mode(`skip`)는 `placeSessionRead`, `cli_session` null, `capabilities`는 lophn이 가진 것 전부 true, `models`·`model`은 지금 renderer model part가 만드는 것과 같은 묶음·축·지금 값·층(`shownModelsRead`, `agentRead`), `commands`는 `commandsList`(builtin과 skill), `usage`는 `sessionStatusRead`. `plan`은 null(lophn agent에 todo가 없다). 승인 pending의 `choices`는 지금 판정(`once`, always 패턴이 있으면 `always`, `reject`)이다. snapshot의 읽기가 `machine:acp` 자격으로 안 되는 route면(`actors`) 부른 사람 자격으로 읽게 바꾸고 보고한다.
3. `acp.ts`: 바뀐 meta를 `session_changed`로 낸다. writer 감싸기(지금 rewind 뒤 숨김을 내는 곳)에서 `renameSession`·`changeSessionModel`·`changeSessionSkip`이 성공하면 그 칸을, Bus의 `TurnEnded`·`CompactEnded` 뒤에는 `usage`를 다시 읽어 낸다. 다른 client가 바꾼 것도 같은 writer를 지나므로 화면이 따로 다시 읽지 않는다.
4. `acp-project.ts`: `approval_opened`에 `choices`를 싣는다(2와 같은 판정). snapshot과 갱신이 같은 상태가 되게 같은 함수를 쓴다(`acp.md` "같은 상태가 되는 방법").
5. test:
   - `acp-send_test.ts`의 경계 test("가는 route의 scope가 없는 호출자는 `AcpSend`로도 `forbidden`")에 새 입력(`set_model`, `set_mode`, `rename`, `fork`, `compact`, `rewind`, `run_command`)을 더한다.
   - `acp-build_test.ts`의 "갱신을 접은 상태와 snapshot이 같다" 꼴에 `rename` 뒤의 `session_changed`가 snapshot의 `title`과 같은 case 하나.
6. 새 route를 core 안 machine 자격으로 부르게 되면 `RUNTIME_MACHINE_ROUTES`(`packages/core/lophn-agent/run-loop/runtime-access.ts`)에 더할 것을 "등록할 것"에 적는다.

등록할 것(lead): core 조립 목록에 새 wiring이 생기면 그 줄. 새 route가 machine 자격으로 불리면 `packages/core/lophn-agent/run-loop/runtime-access.ts`의 `RUNTIME_MACHINE_ROUTES`(orchestrate skill의 함정).

## 끝남

- `npm run check`가 통과한다. core 두 번 기동(`project-docs/plan/tools/lead/boot.sh`)이 `boot 1 exit 0`, `boot 2 exit 0`이다.
- 위험 test: "가는 route의 scope가 없는 호출자는 새 ACP 입력으로도 `forbidden`이다"(`acp-send_test.ts`).
- 남지 않음: 없음(renderer의 옛 core source 논리는 `acp-screen`이 지운다).

## 보고

`.claude/skills/orchestrate/brief-template.md`의 "보고"대로. snapshot을 machine 자격에서 부른 사람 자격으로 바꾼 route, model id 꼴, `AcpSend` 출력이 정해지지 않아 fork id를 못 돌려준 경우를 적는다.
