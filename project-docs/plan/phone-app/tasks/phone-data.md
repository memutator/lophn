# phone-data

폰의 data 층을 짓는다: 붙인 컴퓨터와 그 연결의 store, 컴퓨터마다 화면이 읽는 것(workspace와 session, Inbox, 대화)을 desktop과 같은 로직으로 내는 hook, core 없이 화면을 그리게 하는 sample 컴퓨터.

- 단위: mobile-data (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/mobile/src/data`
  - `packages/mobile/src/connection`
  - `packages/mobile/src/pairing`
  - `packages/mobile/src/remote.ts`
  - `packages/mobile/metro.config.js`
  - `packages/mobile/tsconfig.json`
  - `packages/mobile/package.json`
  - `packages/mobile/package-lock.json`
  - `packages/shell/renderer/conversation/agent-tab-core-source.ts`
  - `packages/shell/renderer/conversation/agent-tab-core-source-sessions.ts`
  - `packages/shell/renderer/workspace/agents/coding-face.ts`
  - `packages/shell/renderer/prefixed-id.ts`
  - 추가 소유: `packages/shell/renderer/parts/vendor-icon/vendor-icon.tsx`와 `packages/shell/renderer/parts/vendor-icon/vendors.ts`(vendor 이름 표를 아이콘에서 가르는 만큼만), `packages/shell/renderer/conversation/agent-tab-source.ts`(React Native에서 import되게 하는 만큼만)
- 읽을 것:
  - 조사: `/home/pyosechang/projects/lophn/reports/phone-native-ui/lophn-inventory.md`의 A.4(대화 data 길), B(지금 폰 web 화면이 core에 붙는 법과 allowlist), D(session 목록과 Inbox의 data)
  - architecture: `project-docs/architecture/remote.md`, `acp.md`, `event.md`
  - 본보기(같은 일을 web으로 한 것): `packages/shell/renderer/remote/`(`CoreSource`를 받아 event client, `coreAgentTabSourceFactory`, waiting store, session 목록을 세운다)
  - 지금 폰의 연결: `packages/mobile/App.tsx`(컴퓨터 목록과 연결을 화면 안에서 든다. 이것을 store로 옮긴다), `packages/mobile/src/connection/connection.ts`, `packages/mobile/src/pairing/{pair,store}.ts`
  - wireframe의 예시 data: `tools/wireframes/drafts/phone/{shell,session,inbox,workspace,more}.tsx`
- 계약:
  - 쓰는 것: `packages/protocol/remote`(연결과 allowlist), `packages/shell/renderer/conversation/agent-tab-source.ts`의 `AgentTabSource`와 view type, `packages/shell/renderer/desktop/connection/`의 event client와 waiting model
  - 내놓는 것(`packages/mobile/src/data/mod.ts`, wave 2·3의 화면이 이것만 쓴다. 화면은 connection을 직접 만지지 않는다):
    - 컴퓨터: 목록(이름, 상태 `connecting|connected|offline|revoked`, 길 `direct|relay`, 기다리는 수), 지금 고른 컴퓨터, 고르기, pairing으로 더하기, 지우기, 이름 바꾸기. React 밖 store 하나와 hook
    - 지금 컴퓨터의 workspace 목록: 종류(`home|project|app`), 이름, 아이콘 값, worktree 묶음마다 session 줄(id, 제목, 누가(lophn agent의 character profile이나 coding agent 이름), 상태 `waiting|working|idle|failed`, 상태 한 줄, 시각), Recent 수
    - Inbox: 지금 기다리는 항목(desktop waiting model의 type 그대로)과 답하기(승인 고르기, 질문 답, 앱 update 허락·거절, job 넘기기·지금 돌리기), 지난 기록
    - 대화: session id로 desktop `AgentTabSource`와 같은 view(thread, live, pending, queued)와 행동(보내기, 멈춤, 승인, 질문 답)
    - 새 session 시작(workspace, agent, 첫 말)
    - sample 컴퓨터: `EXPO_PUBLIC_LOPHN_SAMPLE=1`인 dev build에서 목록 맨 앞에 서고 위 모양 그대로 wireframe의 예시 data를 낸다(행동은 메모리 안에서만 반영)

## 할 일

1. `packages/mobile/App.tsx`가 화면 state로 든 것(폰 key, 컴퓨터 목록 저장·읽기, 컴퓨터마다 연결 만들기·닫기, 앱이 background로 갈 때 pause·resume, revoked 표시)을 `packages/mobile/src/data`의 store로 옮긴다. `App.tsx`는 고치지 않는다(wave 2가 새로 쓴다). store는 React에 기대지 않고 Node test로 돈다.
2. desktop의 대화·Inbox·session 목록 로직을 React Native에서 import되게 한다. 사본을 만들지 않는다. 막는 것은 조사 A.4에 있다: `agent-tab-core-source-sessions.ts`가 `coding-face.ts`를 거쳐 vendor 아이콘(CSS와 svg)을 끌어온다. `prefixed-id.ts`가 `crypto.getRandomValues`를 쓴다. `crypto.subtle`, `URL.createObjectURL`. 아이콘과 이름 표를 가르고, 무작위와 blob 처리는 밖에서 넣게 한다. desktop의 동작은 그대로여야 한다.
3. `packages/shell/renderer/remote/`가 web에서 하는 조립을 폰에서 한다: `packages/mobile/src/connection`의 연결을 desktop `CoreSource` 모양으로 감싸 event client, 대화 source, waiting store, session 목록을 세우고 위 "내놓는 것"의 hook으로 낸다. 연결이 끊겼다 붙으면 다시 구독하고 snapshot을 읽는다(`architecture/event.md`).
4. sample 컴퓨터를 짓는다. wireframe의 예시(workspace Home·phroner·Orders·Calendar 등, session, Inbox 항목 넷, Weekly report 대화의 네 상태)를 같은 type으로 낸다.
5. Metro와 tsc가 위 import를 풀게 `packages/mobile/metro.config.js`와 `packages/mobile/tsconfig.json`을 고친다(지금은 `packages/` 안 bare import를 mobile의 `node_modules`로 푼다. `@lophn/i18n` 같은 workspace 이름이 필요하면 alias를 더한다). 필요한 JS 의존성은 `packages/mobile/package.json`에 판을 고정해 더한다. native module은 더하지 않는다.

## 끝남

- `cd packages/mobile && npm run typecheck && npm test`, root `npm run check:full`, `node packages/shell/renderer/build.ts`가 통과한다.
- 위험 test: "지운 컴퓨터는 연결이 닫히고 저장에서 빠진다", "revoked가 된 컴퓨터는 다시 붙지 않는다"(이미 있으면 store로 옮긴 뒤에도 통과), "sample 컴퓨터는 dev build가 아니면 목록에 없다"
- Metro가 `packages/mobile/src/data/mod.ts`를 bundle한다: `cd packages/mobile && npx expo export --platform android --output-dir .dev-data/phone-data/export`가 된다(끝나면 그 폴더는 지운다). 이 확인을 위해 `packages/mobile/index.ts`나 `App.tsx`를 고치지 않는다. 임시 entry는 `.dev-data/phone-data/` 아래에 두고 commit하지 않는다.
- 남지 않음: `grep -rn "vendor-icon" packages/shell/renderer/conversation/agent-tab-core-source*.ts`가 0줄이다.

## 보고

`.claude/skills/orchestrate/brief-template.md`의 "보고" 꼴. 더해서: `packages/mobile/src/data/mod.ts`가 내놓는 hook과 type의 목록(한 줄씩), desktop file에서 바꾼 것과 desktop 동작이 같다는 근거, wave 2가 `App.tsx`에서 지워도 되는 것.
