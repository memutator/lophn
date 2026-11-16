# update-status

사람이 기계 사이의 판 차이를 앱에서 보게 한다. memory route `apps/update_state`가 앱마다 각 기계가 돌리는 release, 이 기계의 따라가기 상태, 기다리는 변경과 그 이유, 그 앱을 주고받는 기계들의 lophn 판과 범위 안인지를 낸다. desktop App details에 "Machines" section을 두어 그것을 보인다("Needs an update here", 동의 기다림, 실패 이유, "Update lophn on this computer", 다른 기계가 옛 release나 옛 lophn이라 그 변경이 늦게 옴). 모든 기계를 올리는 단추는 없다.

- 단위: status (wave 2)
- 선행: update-held, update-follow
- 소유(이 task만 고친다):
  - `packages/protocol/apps/update-state.ts`(새 file: route와 출력 schema)
  - `packages/core/apps/update-state/`(새 폴더: `mod.ts`, `read.ts`. held·follow 상태와 폴더 기록 사본, ledger의 앱·release를 모은다)
  - `packages/shell/renderer/app-frame/app-detail/machines-section.tsx`(새 file)
  - `packages/shell/renderer/app-frame/app-detail/app-detail.tsx`(section을 다는 한 줄과 import만)
  - `packages/shell/renderer/app-frame/app-detail/source.ts`(view type과 읽기 하나)
  - `packages/shell/renderer/app-frame/app-detail/reads.ts`
  - `packages/shell/renderer/app-frame/app-detail/core-source.ts`
  - `packages/shell/renderer/app-frame/app-detail/testdata/fake-source.ts`
  - `tools/wireframes/pages/screens/app-space/space.tsx`(App details 상태 하나)
- 공유 줄 허락(한 줄씩, 보고의 "넘길 줄"에): `packages/protocol/apps/mod.ts`·`packages/protocol/apps/registry.ts`(route 등록), `packages/core/apps/register.ts`(handler 등록), `packages/core/main/daemon/wiring/apps.ts`(held·follow 상태를 read에 넘기고 바뀔 때 `publishStateChanged`하는 줄), `packages/shell/main/desktop/core/allowlist.ts`(`RENDERER_MEMORY_ROUTES`에 한 줄), `packages/design/i18n/catalog/machine-update.ts`(key만, `machine-update.status.*`)
- 읽을 것:
  - 계획 `README.md`의 "정한 것"(보이는 글, 단추 없음), "다른 계획이 기대는 계약"(agent 읽기 도구에 넘길 칸. 이 route가 같은 값을 같은 이름으로 낸다)
  - 앞 task의 결과: `update-held`의 `FolderExchange`(`machines()`, `held(app)`, `onChange`), `update-follow`의 `FollowState`(`state(app)`, `onChange`)
  - `project-docs/plan/app-folder-sync/README.md` 계약 3(앱 기록의 `active_release`), 7(`machine/environment`의 `display_name`)과 그 계획의 기록 사본(`folder_records`)
  - 본보기(화면): `app-detail.tsx`의 section 꼴(`run-section.tsx`, `folders-section.tsx`), `reads.ts`의 `useFollowedRead`, gallery `tools/wireframes/pages/screens/app-space/space.tsx`(App details를 fake source로 그린다)
  - route 꼴: `packages/protocol/base/route.ts`의 `defineMemory`(`reads`), 이웃 memory route와 `RENDERER_MEMORY_ROUTES`
  - `.claude/skills/ui-design/SKILL.md`의 "모든 화면의 규칙"
- 계약:
  - 쓰는 것: `FolderExchange`, `FollowState`, 폴더의 기계별 앱 기록 사본, 앱 행과 release 행
  - 내놓는 것: memory route `apps/update_state`(actors `user`, `agent`), 입력 `{ app: appId }`, 출력 `{ app, follow: FollowState, held: [{ machine, bundle_hash, data_schema, changes, bytes, full, why: "newer_release" | "older_release" }], machines: [{ machine, name, this_machine: boolean, lophn_version: string | null, exchange: "ok" | "update_this" | "update_peer", release: { bundle_hash, number: number | null, code_commit, data_schema } | null }] }`. `number`는 이 기계에 그 release가 있을 때의 `r<n>` 번호다. `why`는 보이는 글을 위한 것이다: 이 기계가 그 release를 활성한 적이 있거나 그 data schema가 지금 것보다 낮으면 `older_release`, 아니면 `newer_release`.

## 할 일

1. `update-state.ts`·`core/apps/update-state/`: 위 route. 폴더로 맞추지 않는 앱은 `not_found`. 메모리 값과 ledger 읽기만 하고 쓰지 않는다. held·follow가 바뀌면 `publishStateChanged`로 route의 `reads`에 맞는 변경을 낸다(renderer가 다시 읽는다).
2. `machines-section.tsx`(App details, Run과 Folders 아래, 폴더로 맞추는 앱에만): 기계마다 한 줄(보이는 이름, 그 기계의 release `r<n>` 또는 commit 앞 7자, 이 기계면 "This computer", `exchange`가 `ok`가 아니면 lophn 판). 이 기계 줄 아래 따라가기 상태 한 줄: `current`는 없음, `installing`·`activating` "Updating to …", `waiting_consent` "Needs your OK to update"(대기 panel로 가는 길은 지금 동의 카드가 쓰는 길을 그대로 쓴다), `declined` "You declined this update", `lophn_update` "Update lophn on this computer to run this release", `install_failed`·`activation_failed` "Couldn't update here: <reason>. It stays on r<n>.", `diverged` "Two machines released different versions. Ask the app's agent to combine them." 기다리는 변경: `newer_release` "Needs an update here: <n> changes from <machine> wait for it", `older_release` "<machine> is on an older release; its changes arrive when it updates", `full`이면 "… more wait in the folder". 기계 `exchange`가 `update_this`면 "Update lophn on this computer to exchange with <machine>", `update_peer`면 "<machine> runs an older lophn. Update it on that machine." 기다리는 동안 앱은 이 기계의 data로 그대로 돈다는 것을 한 줄로 말한다. 단추는 두지 않는다(올리기는 각 기계에서 한다).
3. `fake-source.ts`와 gallery: App details의 "동의 기다림 + 다른 기계의 기다리는 변경 + 옛 lophn 기계 하나" 상태 하나를 fake data로 그린다(실제 component를 쓴다).
4. 글은 모두 `machine-update.status.*` key로 둔다.

## 끝남

- `npm run check`가 통과하고 `npm run wireframes`가 되며 gallery의 App details 새 상태가 실제 section으로 그려진다.
- 위험 test: 없음(읽기와 화면).
- 남지 않음: 없음.
- flows catalog: 새 route `apps/update_state`와 App details의 Machines section 줄을 project-docs/flows 에서 고친다(자기 줄만. 꼴은 .claude/skills/flows/SKILL.md). `node tools/flows.ts check`가 통과해야 한다.

## 보고

`.claude/skills/orchestrate/brief-template.md`의 "보고" 꼴. 더해서: gallery 그림 path, 실제 route 출력 한 예, `machine/environment`(agent 읽기 도구)에 넘길 칸과 이 route 출력이 다른 곳.
