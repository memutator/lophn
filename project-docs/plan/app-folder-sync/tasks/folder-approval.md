# folder-approval

**opus high.** destination(`folder.destinations`)을 두고 바꾸고 지우는 것을 사람의 승인으로 만든다. 사람의 data가 data root를 떠나 바깥 도구가 올리는 폴더로 가기 시작하는 일이라 pairing·연결과 같은 무게다. 새 카드 종류를 만들지 않는다: agent가 그 설정을 바꾸려 하면 지금 있는 승인 카드(turn 안 request: 대화 카드, 대기 목록, 알림, 폰)가 열리고, 카드는 바뀜을 사람의 말로(이름과 전체 local 경로) 보이고, 사람이 그 한 번을 허락하면 바뀐다. 설정 선언의 새 칸 `approval: "person"`으로 열어 두어 같은 무게의 다른 설정도 같은 길을 쓸 수 있다.

- 단위: approval (wave 2)
- 선행: folder-contract. wave 1이다(`destinationsSetting`이 있고 지금은 `locked: true`다)
- 소유(이 task만 고친다):
  - `packages/protocol/config/declaration.ts`(`approval`, `describe`)
  - `packages/protocol/config/file.ts`(`settingsUpdate` 입력의 승인 id, 거절 이유 `needs_approval`)
  - `packages/core/config/routes.ts`, `packages/core/config/registry.ts`와 그 test
  - `packages/protocol/approvals/gate-call.ts`, `packages/protocol/approvals/turn-request.ts`
  - `packages/core/approvals/gate/judge.ts`와 `judge_test.ts`, `packages/core/approvals/turn-requests.ts`
  - `packages/cli/commands/settings.ts`
  - `packages/core/folder/destinations.ts`(선언을 `approval: "person"`과 `describe`로 바꾸는 만큼)
  - `packages/shell/renderer/conversation/approval-card/{subject-text.ts,approval-card.tsx}`, `packages/shell/renderer/desktop/connection/waiting/model.ts`
  - `packages/mobile/src/screens/session/{ask.tsx,thread.tsx}`(새 subject를 그리는 만큼)
  - ACP 승인 subject가 `askedCallSchema`를 쓰면 `packages/protocol/acp/{items,state}.ts`의 그 줄
- 읽을 것:
  - architecture: `project-docs/architecture/approval.md`(판정 run·ask·deny, turn 안 request, unattended·skip·팀 자식 규칙, 지키는 것 5·6: 사람의 결정은 사람 자격만), `remote.md`(폰도 사람 자격으로 승인한다)
  - 지금 잠긴 설정: `packages/core/config/routes.ts`의 `settingsUpdateHandler`(agent actor면 `locked` key를 `rejected: locked`로), `registry.ts`의 `locked`, 본보기 설정 `remote.push`(`packages/core/config/shell-settings.ts`), CLI `packages/cli/commands/settings.ts`의 `settings.set`·`settings.unset`
  - Gate와 기다림: `packages/protocol/approvals/gate-call.ts`(`askedCallSchema`, `gateCallSchema`), `turn-request.ts`(`turnRequestSubjectSchema`. `harness`는 Gate가 판정하지 않는 subject의 본보기, always가 없는 request는 `always_patterns`가 빈 목록), `packages/core/approvals/gate/judge.ts`, `turn-requests.ts`, lophn runtime의 `tool_gate/check` 길(`packages/core/lophn-agent/run-loop/runtime-access.ts`의 `HUMAN_WAIT_ROUTES`)
  - 계획 `README.md` "정한 것"(destination은 사람의 승인)과 계약 5
- 계약:
  - 쓰는 것: `destinationsSetting`(`folder-contract`)
  - 내놓는 것:
    - 설정 선언 칸 `approval?: "person"`과 `describe?(before, after) → string[]`(영어 한 줄씩. `locked`와 같이 쓰지 않는다). `folder.destinations`는 `approval: "person"`이고 describe는 `Add sync folder "<이름>": <전체 경로>`, `Change sync folder "<이름>": <옛 경로> → <새 경로>`, `Remove sync folder "<이름>" (<경로>)`
    - GateCall과 turn request subject `{kind: "setting", key, lines: string[]}`. 판정: attended와 skip은 `ask`(skip도 묻는다: 사람이 "묻지 마"라고 한 것은 이 무게의 일이 아니다), unattended와 팀 자식(`spawned_by`)은 `deny`(이유: "ask from a session the person is in"). always 없음
    - 흐름: agent turn의 `lophn settings set|unset`이 그 key가 `approval: "person"`이면 먼저 `tool_gate/check`로 묻고 허락되면 `settingsUpdate`에 그 request id를 싣는다. core는 agent actor의 그 key 바꾸기를 같은 turn에서 `allow`로 닫힌, 같은 key와 같은 값(정규 JSON의 hash)의 request id가 있을 때만 한 번 받는다. 그 밖은 `rejected: [{key, reason: "needs_approval"}]`. 사람 자격(Settings 화면, 사람의 터미널, 폰은 이 route가 allowlist에 없다)은 지금처럼 바로 쓴다. 이 길을 Gate에 두는 것과 settings route가 request를 여는 것 가운데 다른 쪽이 더 단순하면 그렇게 하고 보고한다(위 판정과 "한 번, 같은 값"은 그대로)
    - 카드: desktop 대화 카드와 대기 목록, 폰이 `lines`를 그대로 보인다(경로를 줄이지 않는다)

## 할 일

1. 선언 칸과 registry(`approval`, `describe`). `folder.destinations`를 `locked: true`에서 `approval: "person"`으로.
2. Gate call·subject·판정과 test.
3. settings route: agent actor와 `approval` key의 검사, 승인 id 한 번 쓰기(core 메모리의 결정 기록에서 찾고 쓰면 지운다. core가 다시 뜨면 남은 것은 없다).
4. CLI `settings.set|unset`: 묻고 싣기. 거절되면 사람이 거절했다는 것과 사람의 이유를 결과로.
5. renderer와 폰의 subject 그리기(`lines`, 제목 "Change a lophn setting"). `packages/mobile`은 root workspace 밖이다: `cd packages/mobile && npm ci && npm run typecheck && npm test`.

## 끝남

- `npm run check`가 통과한다. `packages/mobile`의 typecheck와 test가 통과한다.
- 위험 test:
  - "agent 자격은 사람의 허락 없이 destination을 두지도 바꾸지도 지우지도 못한다": 승인 id 없이, 거절된 id로, 다른 값을 허락받은 id로, 다른 turn의 id로, 한 번 쓴 id로 다시 부르면 모두 `needs_approval`이고 설정 file이 그대로다
  - "unattended turn과 팀 자식은 destination을 요청하지 못한다": 판정이 `deny`이고 카드가 열리지 않는다
  - "사람이 허락한 그 값만 쓰인다", "사람 자격은 지금처럼 바로 쓴다"
- 남지 않음: `grep -rn "folder.destinations" packages/core/folder/destinations.ts`의 선언에 `locked`가 없다.
- flows catalog: 이 task가 바꾸는 `settings/update`의 거절 갈래, 승인 subject, CLI `settings.set|unset`의 갈래와 test file의 줄은 이 task가 project-docs/flows 에서 고친다(자기 줄만. 꼴은 .claude/skills/flows/SKILL.md). `node tools/flows.ts check`가 통과해야 한다.

## 보고

`.claude/skills/orchestrate/brief-template.md`의 "보고" 꼴. 더해서: 고른 길(Gate 앞 묻기 또는 route가 여는 request)과 이유, 카드의 실제 글(desktop과 폰), 승인 id를 어디에 얼마나 쥐는지.
