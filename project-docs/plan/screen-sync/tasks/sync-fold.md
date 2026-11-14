# sync-fold

"다시 읽어라"뿐인 event 넷을 `StateChanged`로 합치고 옛 읽기 hook을 지운다.

- 단위: sync (wave 4)
- 선행: sync-lists, sync-app-detail, sync-settings.
- 소유(이 task만 고친다):
  - `packages/protocol/events/transient.ts`
  - `packages/core/main/daemon/wiring/{jobs,workflows,apps,config}.ts`
  - `packages/core/{jobs,workflows,config}/`와 `packages/core/apps/tray/`의 event를 내는 곳
  - `packages/shell/main/desktop/wiring/{context,coding,extensions,agent,artifact}.ts`
  - `packages/shell/renderer/desktop/connection/events/{hooks.tsx,waiting-store.ts}`
  - `packages/shell/renderer/desktop/jobs/`, `packages/shell/renderer/shell/tray/use-tray-values.ts`
  - `packages/shell/renderer/app-frame/app-detail/use-read.ts`, `packages/shell/renderer/desktop/settings/use-reload.ts`
  - workflow instance 화면과 `packages/sdk/`의 tray 값 문서
  - `project-docs/flows/`의 event 항목
- 읽을 것:
  - 계획 README "정한 것"
  - architecture: `project-docs/architecture/event.md` 지키는 것 15~18, `job.md`, `workflow.md`, `settings.md`, `app-notice.md`의 tray 값
- 계약:
  - 쓰는 것: `StateChanged`, `useCoreRead`
  - 내놓는 것: 없음

## 할 일

1. `JobChanged`, `WorkflowInstanceChanged`, `AppTrayChanged`, `SettingsChanged`를 내는 곳을 `StateChanged`(이름과 id)로 바꾼다. route에서 나는 것은 `sync-core`의 `changes`가 이미 내므로 옛 push를 지우기만 한다. route 밖에서 나는 것(설정 file watch, job scheduler)은 내는 함수를 부른다. job의 commit 뒤 scheduler 깨우기는 그대로 둔다.
2. 듣는 곳을 바꾼다: renderer의 `useJobChanges`, `useWorkflowChanges`, `useSettingsChanged`, tray 값, Inbox의 `JobChanged`. shell main의 `SettingsChanged` 넷(key prefix로 거르던 것은 id로 거른다)과 `WorkflowInstanceChanged`(artifact view 다시 load).
3. event 넷의 정의와 flows 항목을 지운다.
4. 쓰는 곳이 없어진 `use-read.ts`, `use-reload.ts`, 종류마다의 hook을 지운다.
5. Inbox History가 `ready`에 다시 읽지 않는 것(`waiting/history.ts:160`)을 고친다.

## 끝남

- `npm run check`가 통과한다.
- 위험 test: 없음
- 남지 않음: `grep -rn "JobChanged\|WorkflowInstanceChanged\|AppTrayChanged\|SettingsChanged\|useReload" packages tools tests`가 0줄이다.

## 보고

`.claude/skills/orchestrate/brief-template.md`의 "보고" 꼴.

## lead가 더함

- 설정 store(`packages/core/config/store.ts`의 `publish`)가 route(`settings/update`), file watch, core 안 정리(`apps/delete`) 모두에서 바뀐 key를 안다. 그래서 store가 key마다 `{name: "settings", id: <key>}`로 낸다. `settings/update`의 `changes: ["settings"]`(id null)는 지운다(store와 겹쳐 두 번 난다). `sync-read`가 만든 check가 "route 밖에서 내는 이름"을 모르면 그 check에 `settings`를 route 밖 이름으로 더한다(추가 소유: 그 check file의 그 목록).
- shell main의 `SettingsChanged` 넷이 key prefix로 거르던 것은 `StateChanged`의 `settings` id로 거른다. id가 null이면 모든 key로 본다.
- wave 3가 남긴 정리: 안 쓰게 된 `WorkspaceSource.runs`와 그 core-source 구현, `MockDesktop`의 `runs` prop을 지운다. 앱 상세의 gallery 답을 감싸는 `answering`(`tools/wireframes/mock/core-answers/sync-app-detail.ts`)을 `packages/shell/renderer/desktop/connection/events/fake-source.ts`로 옮기고, `desktop/dev-mock/`의 `mockEvents()`가 wave 3 화면의 답(`fakeDetail(...).answers` 등)을 주게 한다(지금은 dev-mock에서 앱 상세 read가 `unavailable`이다). 추가 소유: `fake-source.ts`, `desktop/dev-mock/`, `tools/wireframes/mock/`, 그 정리가 닿는 workspace source file.
