# carry-settings

desktop Settings에 "Sync" 항목을 둔다: 사람이 이름 붙인 폴더들과 "내 컴퓨터들이 같이 보는 폴더"(설정 `folder.shared`)를 보고 더하고 바꾸고 지우며, 지금 길을 본다(컴퓨터마다 연결이 있는지와 그 길, 그 컴퓨터의 file을 마지막으로 어느 길로 언제 받았는지, 앱마다 마지막으로 맞춘 때). 길을 고르는 설정은 두지 않는다. Google Drive, Syncthing, Tailscale을 붙이는 일은 lophn 안에 넣지 않고 home의 lophn agent가 읽는 내장 skill에 지침으로 쓴다. wireframe을 먼저 그린다.

- 단위: carry (wave 3)
- 선행: carry-links, carry-folder
- 소유(이 task만 고친다):
  - `tools/wireframes/pages/screens/settings-pages.tsx`, `tools/wireframes/pages/screens/settings.tsx`, `tools/wireframes/pages/screens/settings-frame.tsx`
  - `packages/shell/renderer/desktop/settings/sync/`(새 폴더: 화면, `source.ts`, `core-source.ts`, `testdata/fake-source.ts`)
  - `packages/shell/renderer/desktop/settings/model.ts`, `packages/shell/renderer/desktop/settings/settings-screen.tsx`
  - `packages/design/i18n/catalog/settings-sync.ts`(새 file), `packages/design/i18n/en.ts`(한 줄)
  - `packages/protocol/remote/carry.ts`(`carry/status`만), `packages/core/folder/carry-status.ts`(새 file), `packages/core/main/daemon/wiring/folder.ts`(route 한 줄)
  - `packages/core/agent-workspaces/skills/connect-computers/`(새 내장 skill), `packages/protocol/lophn-agent/skill-settings.ts`(`BUILTIN_SKILLS` 한 항목)
  - `project-docs/flows/areas/app-runtime.yaml`, `project-docs/flows/areas/agents.yaml`, `project-docs/flows/areas/shell-desktop.yaml`
- 읽을 것:
  - 계획 README "정한 것"의 "설정 화면", "바깥 도구는 lophn agent가 돕는다", "사람의 폴더는 맡겨 두는 곳 하나다", roadmap `multi-device.md` "원칙"(사람에게는 지금 어느 길인지를 보인다), "사람이 정한 것"(Tailscale)
  - `carry-contract` brief의 "갈 곳"과 "사람의 폴더", carry-folder의 보고(`FolderReplica`의 기계마다 상태)
  - architecture: `project-docs/architecture/folder-sync.md`(carry-contract가 고친 판, 결정의 Google Drive 평문 경고), `remote.md`(`machines/list`, 설정 `remote.addresses`), `settings.md`·`approval.md`(사람 승인 설정)
  - `.claude/skills/ui-design/SKILL.md`(전부), `.claude/skills/flows/SKILL.md`
  - 본보기(화면): `packages/shell/renderer/desktop/settings/remote/`(pane 하나의 source·core-source·fake-source, `machines/list` 읽기), wireframe `SettingsRemote`(`settings-pages.tsx`)와 `fakeRemote`(`settings-frame.tsx`), 폴더 고르기 IPC `packages/shell/ipc/folder-picker.ts`
  - 본보기(지침): `packages/core/agent-workspaces/skills/design-app/folder-sync.md`의 "Set up a destination", "Move the folder with a tool", 내장 skill `update-apps`의 frontmatter
- 계약:
  - 쓰는 것: 설정 `folder.destinations`·`folder.shared`(`settings/list`·`settings/update`, `packages/protocol/config/file.ts`. 사람 자격이라 바로 바뀐다), `machines/list`, `machine/environment`(destination 상태, 앱마다 읽기), `ctx.folderReplica`의 기계마다 상태, 표 `folder_reads`의 `read_at`
  - 내놓는 것: route `carry/status`(read, actors user, 기기 route 목록에는 없다): `{}` → `{machines: [{machine, revision, received_at, via: "link" | "phone" | "folder" | null}], apps: [{app, name, sync_to, read_at}]}`. `read_at`은 그 앱 `folder_reads`의 가장 늦은 때다.

시작 전에 다시 볼 것: `fix-setup`은 `machines/call|watch`만 shell capability로 막고 `machines/list`는 그대로다. Settings › Remote가 `machines/list`를 읽는 길을 merge된 code에서 보고 같은 길로 읽는다. `one-screen`의 `screen-inbox`가 Settings에 "기계 고르기"를 넣었으면(같은 `settings-screen.tsx`·`model.ts`·`settings-frame.tsx`) 그 위에서 짓고, 다른 기계를 고른 동안 이 항목은 Remote 항목과 같게 다룬다.

## 할 일

1. wireframe 먼저(`ui-design`): `settings-pages.tsx`에 page 셋을 그리고 `settings.tsx`의 목록에 더한다. gallery는 renderer component를 fake source로 그리므로 화면은 처음부터 `settings/sync/`에 짓고 `settings-frame.tsx`가 `fakeRemote`처럼 sync의 fake source를 panel에 꽂는다. 모양은 Remote 항목의 부품으로 맞춘다.
   - `settings-sync`: "Folder all my computers see"(path와 상태) 줄이 맨 위에 따로 서고 그 아래 이름 붙인 폴더 둘. 컴퓨터: 이 컴퓨터, 직접 붙은 컴퓨터, relay로 붙은 컴퓨터, 꺼졌지만 폰이 그 file을 나른 컴퓨터(“via phone, 3 h ago”), 꺼진 컴퓨터와 마지막으로 본 때. 앱: 몇 분 전, 몇 시간 전, 맞춘 적 없음.
   - `settings-sync-empty`: 같이 보는 폴더 없음(한 줄 설명: Google Drive, Syncthing, 두 OS가 같이 보는 디스크의 폴더를 고르거나 lophn에게 붙여 달라고 한다), remote가 꺼져 있으면 Remote를 켜라는 한 줄.
   - `settings-sync-edit`: 폴더 하나를 고치는 form(이름 붙인 폴더는 이름과 path, 같이 보는 폴더는 path만, [Choose…]), 저장 전 경고 줄.
2. `settings/sync/`: `source.ts`, `core-source.ts`, `testdata/fake-source.ts`. 폴더를 바꾸면 그 설정 값 전체를 새 값으로 쓴다(지금 CLI와 같다). 거절(check의 겹침, data root 안, 이름 `computers`)은 form 안에 그 글을 보인다. `StateChanged`의 `settings`·`remote_devices`·`carry_files`에 다시 읽는다.
3. `model.ts`·`settings-screen.tsx`에 pane `sync`를 더한다(Remote 다음). 글은 `settings-sync.ts` catalog의 key다.
4. `carry/status`: protocol은 `carry.ts`의 `CARRY_ROUTES`에, handler는 `carry-status.ts`(`folderReplica`의 상태와 `folder_reads`), 등록은 `wiring/folder.ts` 한 줄.
5. 내장 skill `connect-computers`(home): `SKILL.md` 하나. 쓸 때(다른 컴퓨터와 맞추고 싶다, 집과 직장, dual boot, 밖에서도 직접 붙고 싶다), lophn이 스스로 하는 것(link, 폰이 나르기, 앱은 `sync_to: "computers"`), 사람이 둘 수 있는 것: 같이 보는 폴더(`folder.shared`. dual boot의 공유 디스크, Syncthing, Google Drive. 평문으로 올리는 도구는 그 말을 먼저 하고 사람이 받아들일 때만. 바꾸기는 사람 승인 카드다), Tailscale(설치를 돕고, 그 이름을 locked 설정 `remote.addresses`에 두는 것은 사람이 Settings › Remote나 자기 터미널에서 한다). 길을 고르는 설정은 없고 Settings › Sync가 지금 길을 보인다. `BUILTIN_SKILLS`에 `{name: "connect-computers", workspaces: ["home"]}`.
6. flows(`flows` skill): `app-runtime.yaml`에 `carry/status` flow, `agents.yaml`에 `skill:connect-computers` flow, `shell-desktop.yaml`의 outcome이 `observe: [screen:settings-sync]`로 page를 가리킨다. `node tools/flows.ts check`.

### 정한 것
- 폰 화면에는 지금 길을 더하지 않는다: 폰 Settings는 이미 컴퓨터마다 연결과 relay 줄을 보이고, 나르기 설정은 carry-phone이 두었다.
- 바깥 도구 지침은 app workspace의 `design-app`이 아니라 home의 새 skill이다: 폴더와 Tailscale은 앱 하나가 아니라 기계의 일이고, 앱 SDK 메모가 드는 앱 지침을 건드리지 않는다.

## 끝남

- `npm run check`가 통과한다. `node packages/shell/renderer/build.ts`가 된다. `npm run wireframes`가 되고 gallery의 `settings-sync`, `settings-sync-empty`, `settings-sync-edit`이 옮긴 component로 그려진다.
- 위험 test: 없음(화면과 읽기다. 폴더를 바꾸는 승인은 지금 설정 code가 본다).
- 화면 test, browser를 띄우는 test, E2E는 만들지 않는다.
- 남지 않음: 없음.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: lead가 고칠 목록 file(`protocol/*/mod.ts`, core 조립 목록, gallery `pages/index.ts`, `package.json`). 적어도 registry의 `carry/status`
- 안 쓰게 된 export(남이 쓰던 것은 지우지 않는다)
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 넘길 줄: 남의 file을 최소로 맞춘 곳
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- **무겁게 짠 것**: 가장 단순한 구현(AGENTS.md "속도")보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것. 없으면 "없음"
