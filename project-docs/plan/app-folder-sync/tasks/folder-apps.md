# folder-apps

**opus high.** 두 번째 기계가 앱을 받을 수 있게 한다. 컴퓨터는 `sync_to`가 있는 앱의 앱 기록(`app.json`), 활성 release의 봉인한 bundle(`releases/<bundle hash>/`), 앱 source의 증분 git bundle(`source/<n>.bundle`)을 자기 하위 폴더에 쓰고, 다른 기계의 source bundle을 자기 저장소의 `refs/remotes/<mch>/*`로 fetch한다. take-in은 폴더의 앱을 같은 id로 등록하고 bundle을 검사해 `prepared` release로 넣는다. 활성화와 동의, grant는 그 기계에서 지금처럼 사람에게 묻는다(옮기지 않는다). route와 CLI 등록은 `folder-surface`가 한다.

- 단위: folder (wave 2)
- 선행: folder-contract, folder-decl. 둘 다 wave 1이다
- 소유(이 task만 고친다):
  - `packages/core/folder/apps`(새 폴더: `records.ts`, `releases.ts`, `source.ts`, `git.ts`, `take-in.ts`, `mod.ts`와 test. 이름은 바꿔도 된다)
  - `packages/protocol/folder/take-in.ts`(새 file: route `apps/take_in`의 정의. 등록은 `folder-surface`)
- 공유 줄 허락(보고의 "넘길 줄"에): `packages/core/apps/releases/commands.ts`에서 release를 적는 길을 core 안에서 부를 수 없으면 그 검사와 insert를 함수로 떼는 만큼
- 읽을 것:
  - 계약: 계획 `README.md` "다른 계획이 기대는 계약" 1, 3, 7과 "정한 것"(앱 id는 같다, release 신분은 bundle hash, SDK 사본은 싣지 않는다, source는 fetch만), `folder-contract`의 `packages/protocol/folder`와 `packages/core/folder/{fs,destinations,schema}.ts`
  - 앱 등록: `packages/core/apps/registration/commands.ts`(`app.create`는 입력 `id`를 받는다 ~l.141, `source_path`), `source-folder.ts`(git을 global·system 설정 없이 부르는 `git`, template 저장소를 만드는 writer, `SOURCE_FOLDER_CONTEXT`: core 안에서 machine 자격으로 route를 부르는 본보기), `store.ts`, `schema.ts`(slug unique)
  - release: `packages/core/apps/releases/commands.ts`(release를 적는 machine 전용 command ~l.590–720: 선언 검증, `declaration_hash`, `manifestBytes`의 sha256 = `bundle_hash`, manifest의 `declaration.json` hash, SDK 의존 대조, `@me` 의존의 catalog 대조, `factsOfDeclaration`, `nextReleaseNumber`, status `prepared`), `store.ts`(`findPreparedRelease`, `loadActiveRelease`), 봉인 `bundle/seal.ts`(`bundleCopyPath`, `writeBundle`, `sealCopy`, `isSealed`), `bundle/manifest.ts`, SDK 설치 사본 `packages/core/apps/packages/builtin.ts`(`<root>/sdk/<part>/<판>`)
  - activation과 동의: `project-docs/architecture/activation.md`(첫 활성화는 늘 사람에게 묻는다), `packages/cli/commands/release.ts`의 `release.activate` 설명
  - 조사: `/home/pyosechang/projects/harness-lab/_report/multi-device/comparison.md` 10절(10.4 git host 없는 앱 source는 기계별 증분 bundle), 14 (ii) 5, `others.md` §5.7(Antigravity의 순번 붙은 bundle), `omp.md` §6.1(검사한 뒤 쓴다)
- 계약:
  - 쓰는 것: 위 계약
  - 내놓는 것(`mod.ts`. `folder-surface`가 조립한다):
    - `createFolderApps(deps)`. deps: `machine`, `destinations`, `apps()`(활성 선언에 `sync_to`가 있는 이 기계 앱: id, slug, name, description, sync_to, source_path, 활성 release의 id·bundle_hash·code_commit·data_schema·data_changes·created_at), `records()`(`folder-import`의 다른 기계 기록 사본), `progress(app) → {read: {<mch>: {n, at}}, settled, horizon}`(`folder-import`의 cursor와 `folder-export`의 `settled`·horizon. 앱 기록에 싣는다, README 계약 3·10), core route를 machine 자격으로 부르는 port(앱 만들기, release 적기), ledger `sql`·`transaction`, `clock`, `random`, data root
    - `runApp(app) → Promise<Result<void>>`: 그 앱의 `app.json`(`read`, `settled`, `horizon` 포함. 내용이 바뀌면 `revision` +1), 활성 release 폴더(없을 때만. file을 모두 쓴 뒤 `release.json`을 마지막에), source bundle(branch가 바뀌었을 때만)을 쓴다. 쓰기는 `folder-contract`의 writer와 `folder_streams`·`folder_written`(stream `app`, `source`)
    - `importSource(app) → Promise<Result<void>>`: 다른 기계의 `source/<n>.json`과 `.bundle`을 번호 순서로 검사하고 `git bundle verify` 뒤 `git fetch <bundle> 'refs/heads/*:refs/remotes/<mch>/*'`. 이 기계의 branch, HEAD, 작업 tree는 건드리지 않는다. prerequisite가 없으면 기다린다. cursor는 `folder_reads`(stream `source`)
    - `takeIn({app, from?: Id<"mch">, release?: bundle_hash}) → Promise<Result<{app, release: Id<"rel">, source_path: string | null, installed: "app_and_release" | "release" | "existing"}>>`. 같은 함수를 `machine-update`의 따라가기가 부른다:
      - 이 기계에 그 앱이 없으면 앱을 만들고 release를 설치한다(`app_and_release`). 이미 있으면 앱 행(이름, slug, source, 설정)을 건드리지 않고 그 release만 `prepared`로 설치한다(`release`). 같은 bundle의 release가 이미 있으면 그것을 돌려준다(`existing`). 몇 번 불러도 같다
      - 오류 `not_found`(폴더에 없음), `invalid_input`(release 폴더가 완전하지 않거나 hash가 맞지 않음, `details.reason: "release_incomplete"`), `conflict`의 `details.reason`: `"sdk_missing"`(이 lophn에 없는 SDK 판, `details.packages`), `"slug_in_use"`(slug가 이 기계의 다른 앱 것, `details.app`), `"dependency_missing"`(`@me` 의존을 이 기계 catalog에서 찾지 못함, `details.packages`)
    - `available() → {app, name, slug, machine, release}[]`(README 계약 7의 `available`)
    - route 정의 `apps/take_in`(command, actors `user`·`agent`, 입력 `{app: Id<"app">, from?: Id<"mch">, release?: 64 hex}`, 출력 위와 같음, 오류 넷)

## 할 일

1. 앱 기록·release 쓰기(`records.ts`, `releases.ts`): README 계약 3. bundle file은 봉인한 사본(`bundleCopyPath`)에서 그대로 읽어 `files/<path>`로 쓰고, 목록의 size·sha256을 적는다. release 폴더는 활성 release와 그 바로 앞 것만 남기고 그보다 옛 자기 release 폴더는 30일 뒤 지운다.
2. source 쓰기(`source.ts`, `git.ts`): 앱의 `source_path`에서 `refs/heads/*`를 읽어 마지막으로 낸 heads와 다르면 `git bundle create <temp> --branches ^<앞서 낸 heads> ^<refs/remotes/*의 heads>`(새 commit이 없으면 쓰지 않는다), 그 뒤 `<n>.json`(heads, prerequisites, size, sha256). 한 bundle 64 MiB 한도. git은 `source-folder.ts`와 같은 꼴(global·system 설정 끔, prompt 없음, 바로 실패)로 부른다. git이 없거나 실패하면 그 앱의 오류로 남기고 data 내보내기는 막지 않는다.
3. source 받기: 위 계약. 처음 take-in으로 저장소를 만들 때만 그 release의 `code_commit`을 `main`으로 둔다.
4. take-in(`take-in.ts`): (a) `records()`에서 앱을 찾는다. `from`이 없으면 그 앱의 `app.json`이 가장 최근인 기계. `release`가 없으면 그 기계의 활성 release. (b) release 폴더를 전부 검사한다: `release.json` schema, 모든 file의 size·sha256, manifest의 sha256이 폴더 이름의 bundle hash와 같음. 하나라도 어기면 아무것도 등록하지 않는다. (c) 고정한 `@lophn/*` 판이 이 기계의 `<root>/sdk`에 없으면 `conflict`("update lophn on this machine"). (d) 이 기계에 그 앱이 없으면 같은 id·slug·name·description으로 만들고, 있으면 앱 행을 건드리지 않는다. 없을 때는(template 저장소를 만들지 않는다: source bundle이 있으면 그것으로 `<root>/apps/<app>/source`를 만들고, 없으면 `source_path`는 null이고 뒤의 `importSource`가 채운다). (e) bundle을 봉인 사본으로 쓰고(`writeBundle`, `sealCopy`) release를 지금 준비가 쓰는 같은 검사로 `prepared`로 적는다(`created_by`는 출처 기계를 알 수 있는 값). grant, 동의, secret, OAuth, invocation 기록, 앱 data는 옮기지 않는다. 앱 data는 활성화 뒤 `folder-import`가 snapshot으로 받는다.
5. test(임시 폴더, test ledger, 실제 `git`. git이 없는 환경이면 source test는 건너뛰고 보고한다).

## 끝남

- `npm run check`가 통과한다.
- 위험 test:
  - "take-in은 동의도 grant도 옮기지 않는다": 출처 기계에서 활성이고 grant가 있는 앱을 받으면 이 기계의 release는 `prepared`이고 grant·동의 행이 없으며, `release.activate`가 사람의 동의를 기다린다(`waiting_consent`)
  - "take-in을 두 번 부르거나 이미 들인 앱에 부르면 앱 행은 그대로이고 release는 하나다"
  - "완전하지 않은 release는 아무것도 등록하지 않는다": `release.json`이 없거나, file 하나가 빠지거나 1 byte 다르거나, manifest hash가 폴더 이름과 다르면 take-in이 실패하고 앱 행, release 행, bundle 사본이 생기지 않는다
  - "source 받기는 사람의 code를 덮지 않는다": 이 기계에 commit하지 않은 수정과 다른 branch가 있는 저장소에 다른 기계의 bundle을 받아도 작업 tree, HEAD, `refs/heads/*`가 그대로이고 `refs/remotes/<mch>/*`만 생긴다
- 남지 않음: 없음(더하기).
- flows catalog: 이 task가 더하는 test file의 줄은 이 task가 project-docs/flows 에서 고친다(자기 줄만. 꼴은 .claude/skills/flows/SKILL.md). route와 CLI의 줄은 `folder-surface`가 쓴다. `node tools/flows.ts check`가 통과해야 한다.

## 보고

`.claude/skills/orchestrate/brief-template.md`의 "보고" 꼴. 더해서: `mod.ts`의 이름과 deps(한 줄씩, `folder-surface`가 꽂을 것), release를 적는 길을 어떻게 불렀나(route 그대로인가, 뗀 함수인가), take-in 한 번의 시간(실제 크기 앱 하나), `@me` 의존 앱의 처리.
