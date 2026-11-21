# project identity in lophn: 기계를 넘는 project id를 저장소 밖으로

상태: 로드맵 초안. 2026-11-21 사람이 방향을 냈고 lead가 큰 결정을 정했고 agent가 썼다. lead의 검수 전이다. `(agent)`로 적은 것은 agent가 근거를 적어 정한 것이라 검수에서 뒤집을 수 있다.
배경 문서: `project-docs/architecture/{project-identity,folder-sync,remote,app-call}.md`, `project-docs/products/roadmap/{multi-machine,multi-device}.md`, 계획 `machine-a2a`(`tasks/mail-router.md`, `mail-lists.md`, `handoff-note.md`).

## 사람의 말 (원문, 2026-11-21)

> 프로젝트 id 확보하는 거를 git을 통해서 하던데, 난 이게 좀 반대인게 만약에 public하고 여러 명이서 쓰는 프로젝트면 지 혼자 쓰는 lophn 때문에 파일을 커밋하고 그러는 게 말이 되나?

> 자동

## 왜

- git project가 다른 컴퓨터에서 같은 project가 되는 길은 저장소에 commit한 `.lophn-project.json` 하나다. public 저장소나 여럿이 쓰는 저장소에 한 사람의 도구 file을 commit하라는 것은 말이 안 된다. 그런데 lophn은 그것을 권한다(등록 dialog의 기본 켬 줄, 상세의 [Set up], "Not committed yet").
- 그 설계 때는 git만 기계를 건넜다. 지금은 컴퓨터 사이 link와 `computers` 폴더(link, 폰, 같이 보는 폴더로 옮긴다)가 있다.
- file이 없는 git project는 `identity`가 null이다. 다른 컴퓨터와 같은 project가 되지 못하고, 앱 data와 계획 `machine-a2a`의 mail이 그 project를 가리키지 못한다.

## 지금 코드

- **file 읽고 쓰기.** `packages/core/projects/identity/file.ts`(`readIdentityFile`, `createIdentityFile`(temp + hard link), `replaceIdentityFile`(temp + rename), `createIdentityFs`, `hasGitAbove`), `inspect.ts`(`inspectFolder`: file 상태 `none|committed|uncommitted|ignored|conflict|unreadable`), `git.ts`(`GitReader.topLevel|remotes|fileState`. `fileState`는 file이 commit됐는지만 본다), `service.ts`(`createIdentityService`: `reconcile`, `status`(`missing`, `duplicate_of`를 얹는다), `create`, `renew`, `match`). 꼴 읽기와 merge 충돌 풀기는 `packages/protocol/projects/identity.ts`(`PROJECT_IDENTITY_FILE`, `IDENTITY_FORMAT`, `serializeIdentityFile`, `parseIdentityFile`). 같은 file의 `remoteKeyOf`와 `matchProjects`(`same`, `suggested`)는 file과 상관없다.
- **clone.** `packages/core/projects/clone/clone.ts`의 `cloneProject`가 받은 저장소의 file을 읽어 기대한 id와 다르면 지우고 `different_project`, 없으면 note `NO_IDENTITY_FILE`("Commit and push it on the other computer, then pull here"), 못 읽으면 `UNREADABLE_IDENTITY_FILE`이다. 등록은 id 없이 하고 다음 읽기가 file에서 id를 얻는다. `alreadyHere`는 `projectByIdentity`(`packages/core/projects/lookups.ts`)로 찾는다.
- **ledger.** 표 `projects`의 `identity`(unique index), `former_identities`(16개), `repo`, `remote_key`·`remote_url`(`packages/core/projects/registry/schema.ts`의 step `projects.registry.identity`, `projects.registry.former-identities`). 쓰는 곳은 `registry/store.ts`의 `insertProject`(null로 넣는다), `storeIdentity`(옛 id를 `former_identities`에 더하는 한 자리), `clearIdentity`(같은 file을 읽은 두 번째 copy), `assignBornIdentities`(data step `projects.born-identity`, git이 아닌 것만)다. `registry/commands.ts`의 command 둘: `project.record_identity`(machine `machine:projects-identity`, input `file_identity`. `recordedIdentity`가 두 번째 copy와 보관 project의 넘김을 정하고 `repo: none`이면 `tx.newId("pri")`)와 `project.link_identity`(user, `repo: none`만).
- **다시 읽는 때.** `packages/core/main/daemon/wiring/projects.ts`: writer 층이 `project.create|relink_folder|unarchive`와 폴더를 바꾼 `project.edit` 뒤에 `reconcile`, `afterReady`가 active project를 4개씩 읽는다.
- **route**(`packages/protocol/projects/identity-api.ts`): memory 넷 `project.identity`, `project.create_identity`, `project.renew_identity`, `project.match`(`PROJECT_IDENTITY_MEMORY_ROUTES`), command 둘 `project.record_identity`, `project.link_identity`. `project.clone`(`clone-api.ts`, reason `different_project` 포함). 기기 route 목록 `packages/protocol/remote/allowlist.ts:519-522`(identity, create, renew, match), 창의 memory route 목록 `packages/shell/main/desktop/core/allowlist.ts:84-87`.
- **CLI** `packages/cli/commands/project.ts`: `project.clone`, `project.share`(`create_identity`를 부른다), `project.identity`(file 상태 일곱 글 `FILE_STATE`).
- **화면.**
  - 등록 dialog `packages/shell/renderer/desktop/workspaces/register-dialog.tsx`: `project.match`로 첫 폴더를 읽어 "Same project on my other computers" 켬 줄(`canShare`), note 여섯(not-git, registered, another-copy, existing, relink, adds-file), 폴더를 잃은 project를 remote key로 제안하는 [Relink {title} here]. 등록 뒤 `createIdentity`를 이어 부른다(`desktop/workspaces/projects/core-source.ts:270`, 실패면 `identityFailed`).
  - "Other computers" 줄 `desktop/workspaces/projects/identity-row.tsx`(208줄): 상태 글 9가지와 [Set up]·[Resolve]·[Restore]·[Separate project](확인 dialog). 상세(`project-detail.tsx:49`)와 project 설정 page(`workspace/project-settings/project-settings-page.tsx:94`)가 쓴다.
  - 잇기 dialog `desktop/workspaces/projects/link-dialog.tsx`(git이 아닌 project만), sidebar menu의 [Clone to this computer]·[Link to a project on this computer…](`workspace/sidebar/workspace-left-sidebar.tsx:484-570`, IPC `shell:machines-clone-here`가 `identity`를 싣는다).
  - 한 창의 목록 `desktop/workspaces/projects/machine-workspaces.ts`: 창이 기계마다 그 범위에서 읽은 `project.list`(`shell/use-left-sidebar.ts`의 `MachineListsProvider`)를 `matchProjects`의 `same`(identity가 같다)으로 묶는다. core는 다른 기계의 project를 모른다.
  - 글: `packages/design/i18n/catalog/workspace.ts`의 identity key 25개(`home.*identity*` 8, `projects.*identity*` 17). wireframe `tools/wireframes/pages/screens/shell/project-identity-scene.tsx`, `project-link-scene.tsx`.
- **다른 컴퓨터를 아는 길(core).** remote wiring이 `ctx.machineLinks`(`RemoteMachines`, `packages/core/apps/calls/forward.ts`: `computers|list|resolve|call`)를 낸다. 기계 기록 `record.json`(`packages/protocol/folder/records.ts`의 `machineRecordSchema`: name, always_on, addresses, lophn 판)은 `packages/core/folder/export/record.ts`의 `publishRecords`가 destination마다(늘 `computers` 포함) 쓰고 그 뒤 `scheduleCarry`가 manifest와 나르기를 부른다(`main/daemon/wiring/folder.ts:737`). 받는 쪽 `packages/core/folder/import/scan.ts`가 `folder_records`에 기계마다 가장 큰 revision을 두고 바뀐 기계를 `outcome.updated`로 낸다. `computers`의 file은 link(`carry/*`), 폰, 같이 보는 폴더로 온다. 기록은 256 KiB(`RECORD_MAX_BYTES`)까지다. 읽는 쪽이 모르는 칸을 버리므로 칸을 더해도 꼴 판(`FOLDER_FORMAT`)은 그대로다.
- **data step.** runner(`packages/core/storage/migration/data-steps.ts`)는 기록에 있는데 모르는 step id가 있으면 기동을 거절한다. 그래서 `projects.born-identity`는 지울 수 없다.
- **flow.** `project-docs/flows/areas/projects.yaml`의 `project-identity-record|startup|read|create|link|renew`, `projects-born-identity`, `project-match`, `project-clone`. `cli.yaml`의 `project-identity-commands`. `shell-workspace.yaml`의 `project-identity-register-line`, `project-identity-row`. `shell-desktop.yaml`의 한 창 목록 flow, `ipc.yaml`의 `machines-clone-here`. journey `project-work.yaml`의 `project-register-share-identity`.
- **test.** `packages/core/projects/identity/identity_test.ts` 6개(file 만들기·덮기 셋, git이 아닌 id 둘, migration 하나), `clone/clone_test.ts` 2개, `packages/protocol/projects/identity_test.ts` 2개(충돌 file, remote key 자격), `registry/registry_test.ts`의 identity 5개, `main/daemon/wiring/projects_test.ts`(born-identity step). e2e는 없다.
- **앱 지침.** `packages/sdk/app-ui/guide.md` "project에 붙는 앱"이 "`identity`가 null이면 사람이 Other computers에서 켜지 않았다"고 말한다. type은 `use-projects.ts`, `use-place.ts`의 `identity: string | null`(`@lophn/app-ui` 2.23.0). 내장 skill, 앱 template, 폰 앱(`packages/mobile`)에는 file, `project share`, file 상태가 없다.
- **문서.** `architecture/project-identity.md`(거의 전부가 file 설계), `architecture/app-call.md` 241·314줄, `products/AGENT.md` C30(`lophn project share`), `boundary-catalog.yaml` 42줄, `context-component-registry.yaml`의 `architecture-project-identity`.
- **이슈.** `project-born-identity-before-git-read`(kept)와 `project-identity-agent-project-scope`(kept)가 file 설계에 기댄다.

## 무엇을 만드나

### id는 ledger에 있다

- 모든 project는 등록될 때(`project.create` 안) ledger에서 `pri_`를 받는다. `identity`는 null이 없다.
- clone은 다른 컴퓨터의 id를 들고 와 그 id로 등록한다. 받자마자 같은 project다.
- 이미 있는 id는 그대로 원본이 된다(file에서 온 것도). id가 없는 project(file이 없던 git project, 같은 file을 읽은 두 번째 copy)는 data step이 준다.
- lophn은 사람의 저장소에 아무것도 쓰지 않고 `.lophn-project.json`을 읽지 않는다. 이미 commit된 file은 그대로 둔다.
- git은 지금처럼 읽기만 한다: 폴더가 git인지와 remote key.

### 내 컴퓨터들이 서로의 git project 목록을 안다

- 기계 기록 `record.json`에 칸 `projects: [{identity, remote_key, separated}]`를 싣는다. active이고 git이고 remote key가 있는 project만, identity 순서로 512개까지, remote key는 256자까지만 싣는다. 이름, 경로, url은 싣지 않는다.
- 기록은 지금처럼 destination마다 쓴다. `computers`의 것은 link, 폰, 같이 보는 폴더로 가므로 같은 때 켜지지 않는 컴퓨터도 받는다.
- 이 컴퓨터의 목록이 바뀌면(등록, 폴더나 remote가 바뀜, 보관, 보관 풀기, id가 바뀜, 나누기) 기록을 다시 쓰게 한다.

### 자동 match (core)

이 컴퓨터의 project p마다, 명단의 컴퓨터의 기록으로 본다.

1. p가 git이고, remote key K가 있고, active이고, 나누지 않았을 때만 본다.
2. 어느 컴퓨터의 기록에 p의 identity를 가진 `separated` 줄이 있으면 p도 나눈 것으로 적고 끝난다(나눈 project를 clone한 것이다).
3. 이 컴퓨터에서 K를 가진 active이고 나누지 않은 project가 p 하나뿐이어야 한다.
4. 기록마다 K를 가진 나누지 않은 줄이 정확히 하나면 그 identity가 후보다.
5. p의 `former_identities`에 없고 이 컴퓨터의 다른 project가 지금이나 옛 identity로 갖지 않은 후보 가운데 가장 작은 것이 p의 identity보다 작으면 p를 그 id로 바꾼다.

- 바꾸기는 core 안 machine 자격만 부르는 command `project.match_identity { project, from, identity | separated }`다. tx 안에서 위 조건을 다시 보고 `storeIdentity`로 적는다. `from`이 지금 값과 다르면 아무것도 하지 않는다(늦게 돈 계산이 덮지 않게).
- match는 합치기만 한다. 나누기는 사람의 [Separate project]뿐이다. 나중에 한쪽 remote가 달라져도 이미 같은 id는 그대로다.
- 계기는 셋이다: 다른 컴퓨터의 기계 기록이 `folder_records`에 들어왔다(어느 길이든 scan의 `updated`), 이 컴퓨터의 project 목록이 바뀌었다(위 "목록이 바뀌면"과 같은 때, 다시 읽기가 remote key를 바꾼 때 포함), 기동 때 다시 읽기가 끝났다. 계기마다 이 컴퓨터의 project 전부를 한 번에 본다.

### 나누기

- [Separate project](사람만)는 새 id를 주고 `separated`를 켠다. ledger 칸 `separated`를 더한다(schema step `projects.registry.separated`). `project.renew_identity`는 ledger만 쓰는 command가 된다. git이 아닌 project도 나눌 수 있다(이 컴퓨터의 잇기를 푼다).
- 나눈 project는 어느 컴퓨터에서도 자동 match에 들지 않는다. 이 컴퓨터는 그 id를 바꾸지 않고, 다른 컴퓨터는 그 줄을 후보로도 수로도 세지 않는다.
- 나눈 project를 다른 컴퓨터로 clone하면 id를 들고 가고, 받은 컴퓨터는 규칙 2로 그것도 나눈 것으로 적는다.

### 화면

- 등록 dialog: "Same project on my other computers" 줄과 file note(adds-file, existing, registered, another-copy)를 지운다. 남는 것은 셋이다. "Not in git, so this project stays on this computer.", 이 컴퓨터에 같은 저장소의 active project가 있으면 "{title} on this computer uses the same repository, so lophn matches neither with your other computers." 한 줄, 폴더를 잃은 같은 저장소 project의 [Relink {title} here].
- 상세와 project 설정 page의 "Other computers" 줄:
  - 자동: "Matched by its repository on your other computers", menu에 [Separate project].
  - 같은 저장소가 이 컴퓨터에 둘: "{title} on this computer uses the same repository, so lophn matches neither", [Separate project].
  - 나눔: "Kept separate from your other computers".
  - remote 없음: "No git remote, so lophn cannot find it on your other computers".
  - git이 아님: 지금 글 그대로.
- [Separate project] 확인 dialog는 "이 project는 다른 컴퓨터의 같은 저장소와 다시 자동으로 맞춰지지 않는다"를 말한다.
- 한 창의 목록, [Clone to this computer], [Link…]는 그대로다. 같은 project는 identity가 같은 것이고 core가 맞춘 뒤 창이 그대로 묶는다.

### agent와 앱

- `lophn project share`와 `project.create_identity`를 지운다. `lophn project identity`는 id, git 여부, remote, 나눔, 같은 저장소의 다른 project를 낸다.
- 앱: `identity`가 늘 있다. `@lophn/app-ui` 다음 판에서 type이 `string`이고, guide는 "key는 `identity`다. `id`나 `formerIdentities`로 붙은 줄은 같은 write operation으로 옮긴다. `identity`는 lophn이 다른 컴퓨터에서 같은 저장소를 찾거나 사람이 잇거나 나누면 바뀐다"로 바뀐다. `migrate-sdk` 메모를 쓴다.

## 정한 것

1. id는 저장소에 두지 않고, lophn은 누구에게도 file을 commit하라고 하지 않는다. git project는 사람의 컴퓨터들 사이에서 묻지 않고 자동으로 맞춘다. (사람, 2026-11-21)
2. 모든 project는 등록될 때 ledger에서 `pri_`를 받는다. (lead)
3. 저장소 file 길을 모두 지운다: 읽기, 쓰기, 상태 일곱, `lophn project share`, 등록 dialog의 줄, [Set up]·[Restore]·[Resolve]. lophn은 사람의 저장소에 아무것도 쓰지 않는다. 이미 commit된 file은 읽지도 쓰지도 지우지도 않는다. (lead)
4. 자동 match: 명단의 컴퓨터끼리 같은 remote key의 project가 양쪽에 정확히 하나씩이면 같은 project이고, 작은 id(ULID라 먼저 만든 것)로 모인다. git이 아닌 project는 [Link…] 그대로다. (lead)
5. [Separate project]는 사람만 하고 붙어 있어야 한다. 자동 match는 project를 자기 `former_identities`의 id로 돌려보내지 않는다. (lead) 이 규칙만으로는 붙어 있지 않아 나눈 표시를 더했다(아래 "정한 대로 되지 않은 것", 정한 것 17).
6. [Clone to this computer]는 id를 들고 가 받은 project가 바로 같은 project다. (lead)
7. 같은 때 켜지지 않는 컴퓨터도 모인다: 목록은 컴퓨터 link와 `computers` 폴더(기계 기록) 두 길로 간다. (lead)
8. match는 창이 아니라 core가 한다. (lead)
9. 기존 data: file에서 온 ledger id는 그대로 원본이 되고, id가 없는 git project는 data step이 준다(`projects.born-identity`처럼). 모든 id 바뀜은 `former_identities`에 더하는 store 함수 하나(`storeIdentity`)를 지난다. (lead)
10. 옛 file을 위한 호환 장치를 두지 않는다. 옛 설계의 route, CLI, 화면, flow, test는 지운다. (lead)
11. 목록은 기계 기록 `record.json`의 칸 `projects`다. 이유: 기록은 이미 모든 destination에 쓰이고 `computers`의 것은 link·폰·같이 보는 폴더로 가며, 받는 쪽이 `folder_records`에 기계마다 든다. link에 따로 route를 두면 같은 목록에 길과 cache가 둘이 된다. (agent)
12. 목록의 꼴은 `{identity, remote_key, separated}`이고 active git project이며 remote key가 있는 것만 싣는다(512개, key 256자까지). 이유: match에 드는 것만 싣는다. clone의 url은 창이 그 컴퓨터의 `project.list`에서 읽는다. 그 상한이면 256 KiB 기록 상한 안에 든다. (agent)
13. 계기는 다른 컴퓨터의 기록이 들어올 때, 이 컴퓨터의 목록이 바뀔 때, 기동 뒤 한 번이다. link가 붙는 때는 따로 두지 않는다. 이유: link가 붙으면 나르기가 상대의 기록을 곧 들여와 첫 계기가 받는다. 계기 하나가 모든 project를 보므로 놓친 계기가 다음 계기에 메워진다. (agent)
14. 셋 이상의 컴퓨터가 어느 순서로 만나도 같은 값에 선다: id는 더 작은 쪽으로만 바뀌고 id는 전체 순서라, 같은 저장소의 묶음은 그 묶음의 가장 작은 id에서 멈추고 오가지 않는다. 바뀐 컴퓨터는 기록을 다시 쓰므로 가운데 컴퓨터를 거쳐서도 따라온다. (agent)
15. 한 컴퓨터에 같은 remote key의 active project가 둘이면(같은 저장소의 두 번째 clone, worktree를 따로 등록) 그 key는 그 컴퓨터에서 아무것과도 맞추지 않는다. 사람이 하나를 보관하거나 [Separate project]하면 남은 하나가 맞춰진다. 등록 dialog와 상세가 알린다. 이유: 어느 쪽인지 모르면 묻지 않고 맞추지 않는다(지금 `matchProjects`의 "한 목록에 같은 key가 둘이면 제안하지 않는다"와 같다). (agent)
16. 틀린 자동 match는 그 컴퓨터에서 [Separate project]로 되돌린다. 새 id와 `separated`가 서고, 나눈 project는 어느 컴퓨터에서도 자동 match에 들지 않아 되돌린 것이 남는다. 나눈 것을 다시 잇는 길은 두지 않는다(같은 project를 원하면 clone이 id를 들고 간다). (agent)
17. 나눈 표시는 ledger 칸 `separated`이고 기록에 싣는다. 이유: 아래 "정한 대로 되지 않은 것". (agent)
18. `identity`는 protocol과 SDK에서 null이 없다. `@lophn/app-ui`를 올리고 `sdk-note` skill대로 `migrate-sdk` 메모(`## Instruction diff`)를 쓴다. `lophn.supported_from`은 그대로다(옛 앱의 `identity ?? id`는 그대로 돈다). (agent)
19. 기록은 이름 붙인 destination에도 지금처럼 같은 내용으로 쓴다(remote key 포함). 이유: 받는 쪽은 destination을 건너 기계마다 가장 큰 revision 하나를 두므로 destination마다 내용이 다르면 목록이 사라진다. 그 폴더는 사람이 자기 컴퓨터들을 위해 고른 곳이고 이미 앱 data가 간다. (agent)
20. 다른 컴퓨터의 기록은 명단의 컴퓨터 것만 쓴다. remote가 꺼져 명단이 없으면 맞추지 않는다. (agent)
21. 자동 match는 이 컴퓨터의 다른 project가 지금이나 옛 identity로 가진 id로 바꾸지 않는다. 이유: `project.link_identity`의 `identity_in_use`와 같은 규칙이고, 앱이 옛 id로 붙은 줄을 두 project로 옮기지 않게 한다. (agent)
22. clone이 들고 온 id를 이 컴퓨터의 다른 project가 지금 가지면 지금처럼 "already on this computer"이고, 옛 identity로 가지면 `conflict`(`identity_in_use`)로 받지 않는다. `project.create`의 `identity` 입력은 clone 자격(`machine:projects-clone`)만 쓴다. `different_project`는 없어진다(견줄 file이 없다). (agent)
23. 등록 dialog의 "already registered"와 "another copy"는 같은 저장소 note 하나가 된다(identity가 아니라 remote key로 안다). `project.match`의 출력은 `{found, repo, remote, same_repository}`로 줄고 `matchProjects`의 `suggested`는 지운다. (agent)
24. 창의 `ListedProject.identity`(다른 컴퓨터가 보낸 값) type은 그대로 둔다. 이유: 바꾸면 계획 `tab-scope`가 고치는 sidebar file을 건드린다. 묶는 규칙은 그대로다. (agent)
25. 위험 test는 git을 띄우지 않는다. match는 순수 함수와 command를 주입한 기록으로 보고, 실제 두 컴퓨터는 개발 core로 손으로 본다. (agent)

## 정한 대로 되지 않은 것

정한 것 5의 "자동 match는 자기 `former_identities`의 id로 돌려보내지 않는다"만으로는 [Separate project]가 붙지 않는다.

- 셋째 컴퓨터: A와 B가 `pri_1`로 맞춰진 뒤 B에서 나눠 `pri_9`가 된다. 아직 맞춰지지 않은 E가 더 오래된 `pri_0`을 들고 오면 A가 `pri_0`으로 가고, B도 `pri_0`이 자기 옛 id가 아니라 그리로 간다. 나눈 것이 풀린다.
- 시계: B의 시계가 늦어 새 id가 `pri_1`보다 작으면 A가 B의 새 id로 간다.

가장 가까운 설계: 나눈 project에 `separated`를 적고 기록에 실어, 나눈 project는 어느 컴퓨터에서도 자동 match에 들지 않게 한다(정한 것 16·17). 사람만 나누고 나눈 것이 붙어 있다는 결정은 그대로 서고, 옛 id 규칙도 그대로 지킨다.

## 계획 `machine-a2a`의 mail에 바뀌는 것

- `remoteWorkspaceOf`(`tasks/mail-router.md`): project의 `identity`는 늘 있으므로 "identity가 null이면 `invalid_input`(run lophn project share)" 갈래를 지운다. branch `mail/mail-router`에 이미 있는 `SessionDirectory.identityOfProject`(`Result<string | null>`)는 `Result<string>`이 되고 router의 그 글도 지운다.
- `tasks/mail-lists.md`의 `remoteWorkspaceOutputSchema`: project `identity`는 null이 아니다.
- `tasks/handoff-note.md`의 `handoff/write`: identity null 갈래("run lophn project share")를 지운다.
- 주소는 그대로 `pri_`이고 받는 쪽은 지금 identity로만 찾는다(`projectByIdentity`). 옛 identity로 찾지 않는다: 나눈 project의 옛 id로 다른 컴퓨터 묶음의 mail이 닿는다. 두 컴퓨터가 아직 맞춰지지 않은 짧은 동안(link가 붙어 있으면 몇 초) 보낸 mail은 `not_found`다.
- 같은 저장소라도 맞추지 않은 project(한쪽에 둘, 나눔)는 `pri_`가 달라 mail이 닿지 않는다. 그것이 맞다.

## 단계

한 branch에서 worker 하나가 잇는다. 각 단계가 끝나면 `npm run check`가 통과한다. 단계 1과 2 사이에는 새로 등록한 git project가 아직 맞춰지지 않으므로 branch는 단계 2 뒤에 올린다.

1. **id를 ledger로, file 길 걷기.**
   - protocol `packages/protocol/projects/{identity.ts,identity-api.ts,project-api.ts,clone-api.ts,mod.ts}`: file 꼴과 `parseIdentityFile`·`PROJECT_IDENTITY_FILE`을 지우고(`remoteKeyOf`는 둔다), `matchProjects`의 `suggested`를 지운다. `createIdentity`를 지우고, `identity` 출력을 `{project, identity, repo, remote, same_repository}`로, `renewIdentity`를 command로, `match` 출력을 줄이고, `recordIdentity` input에서 `file_identity`를 뺀다. `ProjectRecord.identity`는 null이 없다. `project.create`에 clone 자격만 쓰는 `identity?`. `packages/protocol/remote/allowlist.ts`.
   - core `packages/core/projects/identity/`: `file.ts`를 지우고 `inspect.ts`·`service.ts`·`git.ts`(`fileState`)·`mod.ts`에서 file을 뺀다. `registry/store.ts`(`insertProject`가 id를 낸다, `clearIdentity` 지우기, 빈 id에 주는 함수 하나), `registry/commands.ts`(`recordIdentity`는 repo·remote만, `recordedIdentity` 지우기, renew command), `clone/clone.ts`(file 읽기와 note를 빼고 `identity`를 `project.create`로), `add.ts`, `main/daemon/wiring/projects.ts`(create handler를 빼고 data step `projects.identity-for-all`을 `projectsBornIdentityStep` 뒤에. 두 step이 같은 함수를 부른다).
   - CLI `packages/cli/commands/project.ts`: `share`를 지우고 `identity` summary와 `clone` 설명을 고친다.
   - shell: `desktop/workspaces/{register-dialog.tsx,source.ts}`, `desktop/workspaces/projects/{core-source.ts,source.ts,identity-row.tsx,machine-workspaces.ts,testdata/fake-projects.ts}`, `shell/main/desktop/core/allowlist.ts`, `packages/design/i18n/catalog/workspace.ts`(file 글 지우기). 상세 줄은 이 단계에서 git·not-git·remote 없음만 보인다.
   - test: `identity_test.ts`의 file test 셋과 `protocol/projects/identity_test.ts`의 충돌 test를 지운다. migration test를 "id 없는 모든 project가 서로 다른 id를 받고, 있는 id와 그 id를 key로 쓰는 행은 그대로"로 고친다. `clone_test.ts`의 다른 id test를 "들고 온 id로 등록되고, 이 컴퓨터가 옛 id로 가지면 받지 않는다"로 고친다. `registry_test.ts`의 record test를 file 없는 꼴로 고친다.
   - 문서: `architecture/project-identity.md`의 모델·지키는 것·경계·결정에서 file을 걷는다. flow(`projects.yaml`, `cli.yaml`, `shell-workspace.yaml`, journey `project-work.yaml`, `tests/core-rest.yaml`, `flows` skill), `boundary-catalog.yaml`, `context-component-registry.yaml`, `products/AGENT.md` C30, wireframe `project-identity-scene.tsx`.
2. **공유 목록과 자동 match.**
   - protocol: `packages/protocol/folder/records.ts`(`machineRecordSchema.projects`, 기본 `[]`), `folder/limits.ts`(512, 256), `projects/project-api.ts`(`separated`), `projects/identity-api.ts`(`matchIdentity` command, machine만).
   - core: `projects/registry/schema.ts`(step `projects.registry.separated`)를 `main/daemon/wiring/remote.ts`의 `schemaStepsAfterTeams` 끝과 `storage/migration/schema-steps.lock.json` 끝에. `registry/{store.ts,commands.ts,record.ts}`(`separated`, `matchIdentity`, renew가 `separated`를 켠다), 새 `projects/identity/match.ts`(순수: 이 컴퓨터의 project와 기록들 → 바꿀 것), `projects/lookups.ts`(공유 목록 읽기), `folder/export/record.ts`(facts의 `projects`), `main/daemon/wiring/folder.ts`(fact, project 목록이 바뀌면 기록 쓰기, scan의 `updated` 뒤 match 부르기), `main/daemon/wiring/projects.ts`(계기, `ctx.provide`로 match와 목록을 낸다).
   - test: match 순수 함수(셋이 어느 순서로 만나도 가장 작은 id, 한쪽에 둘이면 아무것도, 나눈 project는 더 작은 셋째 id가 와도 그대로, 나눈 줄의 id를 clone한 project는 나눈 것이 됨, 자기 옛 id로 가지 않음), `matchIdentity` command(`from`이 다르거나 다른 project가 가진 id면 바꾸지 않고, 바꾸면 옛 id가 `former_identities`에 남는다), schema step이 행을 그대로 둔다.
   - 문서: `architecture/project-identity.md`(자동 match, 나누기, 지키는 것), `architecture/folder-sync.md`("기계 기록과 환경"의 꼴), flow.
3. **화면.** `desktop/workspaces/projects/identity-row.tsx`(상태 다섯과 [Separate project]), `desktop/workspaces/register-dialog.tsx`(같은 저장소 note), `packages/design/i18n/catalog/workspace.ts`, wireframe `project-identity-scene.tsx`(`ui-design` skill), flow `shell-workspace.yaml`과 journey `project-register-share-identity`(같은 저장소를 두 컴퓨터에 등록하면 저절로 같은 project가 되는 journey로).
4. **앱 지침과 마무리.** `packages/sdk/app-ui/{use-projects.ts,use-place.ts,guide.md,package.json}`과 pin, `packages/shell/main/app-frame/app-projects.ts`, `migrate-sdk` 메모 `app-ui-<판>.md`(`sdk-note` skill), `architecture/app-call.md` 241·314줄. 이슈 `project-born-identity-before-git-read`, `project-identity-agent-project-scope`를 닫는다(`issue` skill). change-log 항목 `project-identity-in-lophn`.

## 하지 않는 것

- 사람의 저장소에 쓰기. 옛 `.lophn-project.json`을 읽기, 지우기, ledger로 옮기기.
- remote가 없는 git project를 맞추기, 그 project의 [Link…].
- 나눈 project를 다시 잇기.
- remote 밖의 열쇠(첫 commit 등)로 맞추기. fork는 remote가 달라 맞추지 않는다.
- 자동으로 나누기. remote가 한쪽에서 달라져도 이미 같은 id는 그대로다.
- 다른 컴퓨터의 project를 이 컴퓨터에 저절로 clone하기.
- 한 컴퓨터 안의 두 copy를 한 project로 합치기.
- 옛 lophn의 기록(칸 없음)과 맞추기. 빈 목록으로 본다.

## 확인하지 않은 것

- 셋 이상의 실제 컴퓨터, 폰이나 같이 보는 폴더로만 이어지는 두 컴퓨터에서 맞춰지는 데 걸리는 시간.
- 앱 data가 맞춰지는 사이: B가 `pri_B`에서 `pri_A`로 가면 B의 앱이 화면을 열 때 줄을 옮긴다. 그 전에 A에 온 `pri_B` 줄은 A에서 어느 project의 것도 아니어서 무시된다. B에서 그 앱을 열지 않으면 그대로 남는다.
- [Separate project] 뒤 앱은 지금 규칙대로 옛 id(다른 컴퓨터와 같이 쓰던 id)로 붙은 줄을 새 id로 옮기고, 그 옮김이 다른 컴퓨터로 가면 그 컴퓨터의 project에서 그 줄이 빠진다. 지금 [Separate project]도 같다. 틀린 자동 match를 되돌릴 때 생기므로 단계 4에서 이슈로 올린다.
- clone 바로 뒤의 겨루기: 나눈 지 몇 초 안에 그 project를 clone하면 받은 컴퓨터가 나눈 컴퓨터의 새 기록을 받기 전에 원래 묶음과 맞춰질 수 있다.
- remote key가 256자를 넘는 project(맞추지 않는다)가 실제로 있는지.
