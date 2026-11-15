# mobile-coding-mobile-data

폰의 data 층에 coding session을 더한다: 컴퓨터의 coding session 목록(`useCodingSessions`), relay된 대화를 lophn agent와 같은 `AgentTabSource` view로 내는 길(`codingSource`), view 전환(switch)·열기·깨우기 행동, sample 컴퓨터의 coding session. 폰 allowlist에 `coding_sessions/*` route를 더한다. 화면은 그리지 않는다.

- 단위: coding-phone (wave 5)
- 선행: mobile-coding-state, mobile-coding-shell, mobile-coding-open-host
- 소유(이 task만 고친다). 아래 `packages/mobile/...` path는 `mobile-app` brief에서 예상한 이름이다. land된 실제 path를 먼저 확인한다(README "돌리기 전에"):
  - `packages/protocol/remote/allowlist.ts`
  - `packages/mobile/src/data/coding.ts`(새 file)와 `coding.test.ts`(새 file)
  - `packages/mobile/src/data/mod.ts`(내보내기)
  - `packages/mobile/src/data/hooks.tsx`(`useConversation`이 coding session을 받게 하는 만큼만)
  - `packages/mobile/src/data/link.ts`와 `sample.ts`(sample 컴퓨터의 coding session)
  - `packages/shell/renderer/conversation/agent-tab-gui-source.ts`(React Native에서 import되게 하는 만큼만. `mobile-app`의 `mobile-data`가 `agent-tab-core-source.ts`에 한 것과 같은 방식으로 vendor 아이콘과 browser 전용 부분을 가른다. 동작은 그대로)
- 한 줄씩 허락(공유 file. 한 줄만 더하고 "넘길 줄"에 적는다): `project-docs/flows/`의 area file와 `tests/*.yaml` 줄
- 읽을 것:
  - 조사: `/home/pyosechang/projects/lophn/reports/mobile-program/coding-agent-relay-survey.md`의 2(설계 4), 3(마지막 "mobile-app plan과의 interface"), 7(4번: capability와 `readFace`)
  - architecture: `project-docs/architecture/remote.md`("지키는 것": 폰 자격의 route 목록), `harness-gui.md`, `acp.md`
  - 이 계획이 먼저 낸 것: `packages/protocol/coding-agent/relay.ts`(`coding_sessions/{list,switch_plan,switch,open,wake}`의 모양과 오류), `acp/snapshot`·`acp/send`의 relay 분기, `StateChanged{coding_sessions}`와 `AcpUpdated`(`mobile-coding-state`·`mobile-coding-open-host` 보고)
  - 본보기: `packages/shell/renderer/conversation/agent-tab-gui-source.ts`(`guiAgentTabSource`. 상태는 `feed`, 쓰기는 `input`. 폰은 `feed`를 `acp/snapshot`과 `AcpUpdated`로, `input`을 `acp/send`로 채운다), `packages/shell/renderer/terminal/terminal-gui.tsx`의 `createGuiFeed`(snapshot에 update를 `reduceAcp`로 접는 모양. 놓친 update를 `reread`로 다시 읽는 규칙은 `packages/shell/renderer/conversation/agent-tab-data.ts`), 폰 쪽 `packages/mobile/src/data/{hooks.tsx,link.ts,workspaces.ts}`(`useConversation`, `dataOf`, `coreAgentTabSourceFactory`), wireframe `tools/wireframes/drafts/phone/coding.tsx`(`mobile-coding-wireframes`)
- 계약:
  - 쓰는 것: 위 route와 event, `AgentTabSource`
  - 내놓는 것(`mobile-coding-phone-screens`, `mobile-terminal-phone`, `mobile-coding-open-phone`이 기댄다. 화면은 이것만 쓴다):
    - `useCodingSessions(project?)`: `{shell: "attached"|"absent"|null, sessions: CodingSession[], status: "loading"|"ready"|"failed"}`. `coding_sessions/list`를 읽고 `StateChanged{coding_sessions}`와 연결이 다시 붙을 때 다시 읽는다
    - `useConversation(target)`의 `target`에 coding 갈래: `{session, coding: {harness, project, cwd}}`. 이 갈래는 `codingSource`로 `AgentTabSource`를 만든다(상태는 `acp/snapshot`을 읽고 `AcpUpdated`를 접는다. 다시 읽을 일이 생기면 읽는다. 쓰기는 `acp/send`. 이미지·rewind 미리보기·지난 session 목록은 `unavailable`이라 화면이 숨긴다. 숨기는 기준은 ACP 상태의 `session.capabilities`다). 같은 `Conversation`(`send`, `stop`, `decide`, `answer`)을 낸다
    - `useCodingActions()`: `switchPlan(session)` (-> `{to, stops: {turn, tasks, queued}, blocked}`), `switchView(session, to)`(항상 `confirmed: true`와 새 key를 싣고 `coding_sessions/switch`를 부른다. 화면이 확인을 받은 뒤에만 부른다), `wake()`, `open({project, harness, resume?})`. 결과는 `SourceResult`이고 오류 code는 core의 것 그대로다
    - allowlist: `coding_sessions/list`, `switch_plan`, `switch`, `open`, `wake`를 `REMOTE_ALLOWED_ROUTES`에 더한다. 더하지 않는 것: `host/*`, `terminal_sessions/*`, `devices/set_terminal_input`
    - sample 컴퓨터(dev build의 `EXPO_PUBLIC_LOPHN_SAMPLE=1`)에 wireframe의 coding session들(chat view로 승인 대기 하나, terminal view 하나)과 switch 행동이 메모리 안에서 도는 것

## 할 일

1. `agent-tab-gui-source.ts`가 React Native에서 import되는지 본다(`mobile-data`의 `typecheck`와 test 경로). 막히면 vendor 아이콘과 browser API 부분만 가른다.
2. `data/coding.ts`: `codingFeed(core, session)`(snapshot과 update를 접은 상태와 `changed`), `codingSource`(`guiAgentTabSource`에 feed와 `input = acp/send`를 꽂는다), `useCodingSessions`, `useCodingActions`. `hooks.tsx`의 `useConversation`이 coding 갈래를 `codingSource`로 만든다. coding session의 agent 얼굴은 harness 이름과 vendor 아이콘이다(`guiAgentTabSource`가 이미 만든다).
3. allowlist 줄. 그 file에 두는 설명 주석(폰이 못 부르는 route 이유)에 `coding_sessions`의 "폰이 시작한 switch도 `confirmed: true`가 있어야 한다"는 것과 터미널 입력은 별도 장치라는 것을 한 줄 쓴다.
4. sample 컴퓨터에 coding session을 더하고 `coding.test.ts`(Node test): feed가 snapshot 뒤 update를 접는다, switch가 `confirmed: true`를 싣는다.
5. flows catalog(폰 allowlist를 가리키는 곳이 있으면)를 맞춘다. 개발 길은 보고에 적는다(`packages/mobile/README.md`는 lead가 끝에 고친다).

## 끝남

- `npm run check`와 `cd packages/mobile && npm run typecheck && npm test`가 통과한다.
- 위험 test: 없음(allowlist 경계는 기존 "폰 자격은 목록에 없는 route를 부르지 못한다" test가 새 목록에서 통과하는 것으로 본다)
- 남지 않음: 없음
- 확인: `npm run dev:core`와 `tools/fake-coding-host.ts`를 띄우고 `packages/mobile/README.md`의 Node client 길(`tools/remote-dev.ts` pairing)로 `coding_sessions/list`와 `acp/snapshot`을 폰 자격으로 부르는 `data/coding.ts`를 Node에서 한 번 돌려 본다. 끝나면 process를 모두 정리한다.

## 보고

`.claude/skills/orchestrate/brief-template.md`의 "보고" 꼴. 더해서: 내보낸 hook과 type의 정확한 시그니처, `agent-tab-gui-source.ts`에서 가른 것, allowlist에 더한 줄, 확인한 것과 못 한 것, 화면 task가 알아야 할 것(capability로 숨기는 행의 목록).
