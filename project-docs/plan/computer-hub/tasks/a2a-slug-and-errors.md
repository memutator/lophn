# a2a-slug-and-errors

- 단위: router, a2a, agent skills (wave 1)
- 선행: 없음
- 목표: 다른 컴퓨터 앱의 slug 해석(`remoteWorkspaceOf`, `a2a/agents`, `app take-in`)을 고치고, `carriesReason` 오류 마스킹·offline 안내를 개선하며, `lophn-agent`/`connect-computers`/`home.md`에 Two Promises·hub·send 안내를 반영한다.
- 소유:
  - `packages/core/router/remote-reach.ts`
  - `packages/core/router/commands.ts`
  - `packages/core/router/router_test.ts`
  - `packages/core/remote/a2a-lists.ts`
  - `packages/core/remote/mail-entry.ts`
  - `packages/core/remote/call.ts`
  - `packages/core/main/daemon/wiring/a2a-lists.ts`
  - `packages/core/apps/registration/folder-take-in.ts`
  - `packages/core/folder/apps/take-in.ts`
  - `packages/core/lophn-agent/tools/work.ts`
  - `packages/coding-agent/skills/lophn-agent.ts`
  - `packages/core/agent-workspaces/skills/connect-computers/`
  - `packages/core/agent-workspaces/prompts/home.md`
- 참조:
  - `packages/protocol/lophn-agent/calls.ts`
  - `packages/protocol/lophn-agent/a2a.ts`
  - `packages/protocol/folder/take-in.ts`
  - `packages/core/apps/lookups.ts`
  - `project-docs/products/roadmap/computer-hub.md`

## 구현

1. **교차 컴퓨터 앱 slug 해석**:
   - `packages/core/router/remote-reach.ts`: `remoteWorkspaceOf`가 `{ app }`로 `app_` ID뿐 아니라 slug를 받아도 local `apps` 조회 실패 시 곧바로 `not_found`로 죽지 않고, 대상 기계의 `folder_records`/replica(`computers/machines/<mch>/apps/*/app.json`)에서 해당 slug의 `app_` ID를 찾거나 찾지 못하면 원문 `{ app: slug }` 그대로 remote payload에 실어 보낸다.
   - `packages/core/remote/a2a-lists.ts`, `packages/core/main/daemon/wiring/a2a-lists.ts`, `packages/core/remote/mail-entry.ts`: 받는 컴퓨터 쪽 `a2a/agents`, `a2a/sessions`, `a2a/mail`이 `{ app }`에 `app_` ID뿐 아니라 slug가 와도 `apps` table의 slug로 해석한다.
   - `packages/core/apps/registration/folder-take-in.ts`, `packages/core/folder/apps/take-in.ts`: `app.take_in` 입력 `app`이 `app_` ID 또는 slug일 때 대상/원격 `app.json`에서 slug로 matching하여 take-in 가능하게 한다.

2. **`carriesReason` 오류 마스킹 해제 & offline 진단 명확화**:
   - `packages/core/lophn-agent/tools/work.ts`: `carriesReason(name, code)`가 `call.send`, `team.spawn`, `session.list`, `agent.list`, `send` 등 교차 컴퓨터/a2a command의 상세 이유(`unavailable`, `not_found`, `invalid_input` 등 원인 메시지)를 삼키지 않도록 고친다.
   - `packages/core/remote/a2a-lists.ts`: 대상 컴퓨터가 offline/미연결이라 `unavailable`일 때 agent가 원인("is offline or unreachable" vs 다른 오류)을 즉시 구별할 수 있는 명확한 메시지를 돌려준다(기존 에러 코드 `unavailable` 유지).

3. **Agent 지침·Skill 갱신**:
   - `packages/coding-agent/skills/lophn-agent.ts`, `packages/core/agent-workspaces/skills/connect-computers/SKILL.md`, `packages/core/agent-workspaces/prompts/home.md`:
     - **Two Promises** 구분 설명: **지금 바로** (`call`, `team`, `preview`, `session`, `agent`, 터미널, explorer — 대상 컴퓨터 켜짐 필요) vs **켜지면 도착** (파일 보내기 `lophn send`, 설정/workflow 내보내기, 앱 데이터·폰 변경사항, mail, handoff note — offline이면 Hub 컴퓨터 경유 보관 후 켜지면 도착).
     - `remote.hub`, `locked` 설정은 GUI(My computers / Settings)에서 직접 켜도록 안내, `remote.addresses` 확인, `lophn send` 사용법, `lophn app take-in <slug>` 반영.
     - (참고: `home.md`나 agent skill을 고칠 때 기존 테스트가 깨지지 않게 유지하고, 필요한 경우 wrap-up에서 `migrate-sdk` diff 메모를 확인할 수 있게 깔끔히 작성한다.)

4. **테스트**:
   - `packages/core/router/router_test.ts` 등에 cross-computer slug 전달(로컬에 없는 원격 앱 slug가 `not_found`로 막히지 않고 원격으로 전달되거나 해석됨)과 `carriesReason` 단위 테스트를 추가한다.

## 완료 기준

- `node --test packages/core/router/router_test.ts packages/core/lophn-agent/tools/work_test.ts packages/core/apps/registration/*_test.ts packages/core/remote/call_test.ts` (해당 파일 존재 시) 통과
- `npm run check` 통과
