# browser-profile-settings

사람이 browser profile을 다루는 화면을 만든다. Settings › Browser에 Profiles 구역(만들기, 이름과 색, 데이터 지우기, profile 지우기, 그 profile을 쓰는 agent 목록)을 두고, Logins를 profile마다 나누며, agent 편집기에 `browser_profile` 칸을, agent card에 profile 표시를 둔다.

- 단위: browser-profile (wave 3)
- 선행: browser-profile-core, browser-profile-partitions. 설정 `shell.browser_profiles`, 정의 칸 `browser_profile`, login의 `profile`, profile마다 데이터 지우기 IPC가 거기서 온다.
- 소유(이 task만 고친다):
  - `packages/shell/renderer/desktop/settings/browser/browser-panel.tsx`
  - `packages/shell/renderer/desktop/settings/browser/login-rows.tsx`
  - `packages/shell/renderer/desktop/settings/browser/profile-rows.tsx`
  - `packages/shell/renderer/desktop/settings/browser/model.ts`
  - `packages/shell/renderer/desktop/settings/browser/source.ts`
  - `packages/shell/renderer/desktop/settings/browser/window-source.ts`
  - `packages/shell/renderer/desktop/settings/browser/testdata/fake-source.ts`
  - `packages/shell/renderer/workspace/agents/editor/tab-general.tsx`
  - `packages/shell/renderer/workspace/agents/editor/editor-model.ts`
  - `packages/shell/renderer/workspace/agents/agent-card.tsx`
  - `packages/shell/renderer/workspace/agents/agent-card.module.css`
  - `packages/shell/renderer/workspace/agents/source.ts`
  - `packages/shell/renderer/workspace/agents/core-source.ts`
  - `packages/shell/renderer/workspace/agents/fake-source.ts`
  - `packages/shell/renderer/workspace/agents/fake-data.ts`
  - `packages/design/i18n/catalog`
  - `tools/wireframes/pages/screens/settings.tsx`
  - `tools/wireframes/pages/screens/agent-settings.tsx`
  - `project-docs/flows/areas/projects.yaml`
- 읽을 것:
  - 계획: `project-docs/plan/tab-scope/README.md`("browser profile의 id와 partition", "agent 정의의 칸 이름은 `browser_profile`", "저장 login은 profile에 속한다", "profile을 지우면")
  - 제품 결정: `project-docs/products/roadmap/browser-profile.md`의 "화면", "정한 것" 6(지운 profile을 쓰던 agent는 기본으로 떨어지고 편집기에 표시)
  - architecture: `project-docs/architecture/browser-tab.md`의 지키는 것 18(데이터 지우기)·45(사람만 login을 넣는다), `project-docs/architecture/agent-definition.md`의 "agent 정의"
  - skill: `.claude/skills/ui-design/SKILL.md`(행동 단추는 오른쪽 끝, `danger`는 되돌릴 수 없는 일만)
  - 코드: `packages/shell/renderer/desktop/settings/browser/`(`browser-panel.tsx`의 구역, `login-rows.tsx`, `device-rows.tsx`가 설정 목록을 통째로 바꾸는 법(`chooseSetting`), `window-source.ts`), `packages/shell/renderer/workspace/agents/editor/tab-general.tsx`(`skip` 구역의 꼴), `packages/shell/renderer/workspace/agents/agent-card.tsx`, `packages/shell/renderer/browser/profiles.tsx`(`useBrowserProfiles`), `packages/shell/renderer/prefixed-id.ts`(`newId`)
- 계약:
  - 쓰는 것: `packages/protocol/shell/browser-profiles.ts`(`BROWSER_PROFILES_SETTING`, `browserProfileSchema`, `BROWSER_PROFILE_ID_PREFIX`, `BROWSER_PROFILES_MAX`), 설정 `shell.browser_profiles`(사람이 `settings/update`로 목록을 통째로 바꾼다), 정의 칸 `browser_profile?: <bpf id>`와 목록 행 `browser_profile: <bpf id> | null`(`browser-profile-core`), login 행의 `profile`, `logins/save`의 `profile?`(`browser-profile-core`), preload `clearData(profile: string | null)`(`browser-profile-partitions`).
  - 내놓는 것: 없음.

## 할 일

1. Settings › Browser › Profiles(`profile-rows.tsx`, 새 file): 맨 위에 기본 profile 줄(이름 "Default", 지우지 못한다)과 사람이 만든 profile 줄. 줄마다 색 점, 이름, 그 profile을 쓰는 agent 이름(agent 목록 행의 `browser_profile`), 오른쪽 끝에 Rename·Color·Clear data·Delete. [Add profile]은 `newId(BROWSER_PROFILE_ID_PREFIX)`로 id를 짓고 이름과 색을 받아 설정 목록 끝에 더한다(최대 `BROWSER_PROFILES_MAX`, 이름이 겹치면 core가 `invalid_input`).
2. Delete: 확인 dialog(지울 login 수와 그 profile을 쓰는 agent가 기본 profile로 떨어진다는 문장)를 거쳐 이 순서로 한다. ① 그 profile의 login을 모두 `logins/delete`로 지운다 ② `clearData(<id>)`로 partition data를 지운다 ③ 설정 목록에서 뺀다. 중간에 실패하면 멈추고 알린다(profile이 남아 있어 다시 할 수 있다).
3. 데이터 지우기: 지금 Browsing data 구역의 [Clear browsing data]는 기본 profile을 지운다(`clearData(null)`). profile 줄의 Clear data는 그 profile을 지운다.
4. Logins(`login-rows.tsx`): profile마다 묶어 보이고(기본 먼저), [Add login]은 그 묶음의 profile로 `logins/save {profile}`을 부른다. 다른 profile로 옮기는 동작은 두지 않는다.
5. agent 편집기(`tab-general.tsx`, `editor-model.ts`): General에 "Browser profile" 고르기(Default와 profile들). Default를 고르면 칸을 지운다(파일에 적지 않는다). 정의의 id가 지금 목록에 없으면 "Deleted profile — uses Default" 표시와 함께 Default로 보인다. agent card(`agent-card.tsx`)는 기본이 아닌 profile이면 색 점과 이름을 작게 보인다. `source.ts`·`core-source.ts`·fake가 새 칸을 나른다.
6. i18n: 이 wave의 catalog는 이 task가 고친다(`packages/design/i18n/catalog/browser.ts`의 Settings 문구, `agents.ts`). lead가 이 wave 전에 넣은 `shell.button.tab-hand`·`shell.button.tab-take-back`·`shell.text.tab-hand-none`·`shell.toast.tab-hand-failed`(같은 wave의 `tab-owner-hand`가 쓴다)는 지우지 않는다.
7. gallery: `settings.tsx`의 `settings-browser`가 Profiles 구역을 보이게 하고, page `settings-browser-profiles`(profile 둘, 하나는 agent 둘이 쓴다), `settings-browser-profile-delete`(확인 dialog), `settings-browser-logins`를 profile 묶음으로 고친다. `agent-settings.tsx`의 `agent-settings-agent`가 Browser profile 칸을 보이고, 지운 profile을 가리키는 상태 page `agent-settings-browser-profile-deleted`를 더한다. fake는 `desktop/settings/browser/testdata/fake-source.ts`와 `workspace/agents/fake-data.ts`에 둔다.
8. flows `projects.yaml`: `browser-clear-data` flow를 profile 하나 지우기로 고치고, profile 만들기·지우기를 `ui:` flow로 쓴다(`uses`에 `route:settings/update`, `route:logins/delete`, `ipc:shell:browser-clear-data`). `node tools/flows.ts check`.

정한 것:
- profile을 지우면 그 profile의 login도 지운다. profile 하나가 partition과 그 login이라(roadmap "profile") 남기면 어느 화면에도 보이지 않는 login과 secret 값이 남는다. 확인 dialog가 지울 login 수를 말한다.
- 색은 agent 얼굴과 같은 색 목록(`AGENT_CHARACTER_COLORS`)에서 고른다.

## 끝남

- `npm run check`가 통과하고 `node packages/shell/renderer/build.ts`가 된다.
- 위험 test: 없음(사람만 쓰는 칸의 거절과 login의 profile 검사는 core test가 본다).
- 남지 않음: 없음.
- `npm run wireframes`가 되고 gallery의 `settings-browser`, `settings-browser-profiles`, `settings-browser-profile-delete`, `settings-browser-logins`, `agent-settings-agent`, `agent-settings-browser-profile-deleted`가 고친 renderer component로 그려진다.

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
