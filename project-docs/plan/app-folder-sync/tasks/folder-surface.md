# folder-surface

wave 2의 module을 core에 조립하고 겉을 낸다: folder wiring(계기, destination 감시, timer, backoff, 앱을 지울 때 정리), route `machine/environment`(agent와 사람이 읽는 환경, 뒤 계획이 section을 꽂는 자리 포함), `apps/take_in`, `machine/forget`, `apps/sync_held`, 흔적 정리의 계기와 식(README 계약 10), "너무 오래 떨어져 있었다" 알림, CLI `machine.environment`와 `app.take_in`, flows 줄. 여기까지 오면 두 data root가 한 폴더로 앱을 주고받는다.

- 단위: folder (wave 3)
- 선행: folder-export, folder-import, folder-apps, folder-runtime, folder-approval. 다섯 다 wave 2다
- 소유(이 task만 고친다):
  - `packages/core/main/daemon/wiring/folder.ts`(새 file)
  - `packages/core/folder/environment.ts`와 test(새 file: 읽기 명령의 출력을 모은다)
  - `packages/protocol/folder/environment.ts`(새 file: route `machine/environment` 정의)
  - `packages/cli/commands/machine.ts`(새 file)
  - `packages/cli/commands/app.ts`(`app.take_in`, `app.sync_held`)
  - `packages/protocol/folder/held.ts`(새 file: route `apps/sync_held`), `packages/protocol/folder/forget.ts`(새 file: route `machine/forget`)
- 공유 줄 허락(한 줄씩, 보고의 "넘길 줄"에): `packages/core/main/daemon/assembly.ts`의 `WIRINGS`에 `folderWiring`(`appCallsWiring` 뒤, `remoteWiring` 앞), `packages/cli/commands/mod.ts`의 `COMMANDS`에 `MACHINE_COMMANDS`, `packages/core/main/daemon/wiring/context.ts`의 Late 칸 둘(`folderApply`, `folderEnvironment`)과 `LATE_KEYS` 두 줄, 그것을 채우는 `packages/core/main/daemon/wiring/apps.ts`(또는 calls를 만드는 wiring)의 `ctx.provide` 한 줄, `packages/core/main/daemon/wiring/remote.ts`의 `lanAddresses`를 export하는 한 낱말, `packages/core/main/daemon/wiring/apps-delete.ts`의 앱 지우기 정리 한 줄(`eraseSyncLog` 옆)
- 읽을 것:
  - 계획 `README.md` "다른 계획이 기대는 계약" 5~7, 10, "정한 것"의 계기 줄
  - 뒤 계획이 꽂을 칸: `project-docs/plan/{always-on,project-identity,machine-update,desktop-remote}/README.md`의 이 도구에 넘기는 칸(이 task는 자리만 낸다. 그 계획들이 자기 wiring에서 등록한다)
  - 알림: `project-docs/architecture/app-notice.md`(core가 내는 사람의 알림)
  - wave 2가 낸 것: `packages/core/folder/export/mod.ts`(`createFolderExport`, deps), `import/mod.ts`(`createFolderImport`), `apps/mod.ts`(`createFolderApps`, `takeIn`, `available`), `packages/protocol/folder/take-in.ts`, calls의 `folder`(`packages/core/apps/calls/service.ts`)와 `exclusive`, `AppProcessLink.snapshot`, `packages/core/folder/destinations.ts`, `packages/protocol/folder/limits.ts`. 각 task 보고의 "등록할 것"
  - 조립 본보기: `packages/core/main/daemon/wiring/remote.ts`(operations, records, 기동·종료), `wiring/apps.ts`(sync log, `AppSyncChanged`를 bus로 내는 곳 ~l.320), bus를 구독하는 wiring(`wiring/jobs.ts`), `wiring/context.ts`(Late, `ctx.machine`은 `machine-identity`)
  - read 명령 본보기: `packages/cli/commands/app.ts`의 `app.phone_target`(route + `defineCommand`, `effect: "read"`, `workspaces`), `packages/core/apps/phone/target.ts`(좁은 select로 key를 보이지 않는다)
  - 기계 기록의 사실: `remote.enabled|port|relay` 설정(`packages/core/config/shell-settings.ts`), lophn 판(`wiring/notices.ts`의 `productVersion`), remote protocol 판 범위(`machine-identity` 계약 2)
  - flows: `.claude/skills/flows/SKILL.md`, `project-docs/flows/areas/{app-runtime,cli}.yaml`
- 계약:
  - 쓰는 것: wave 2의 module과 `ctx.machine`
  - 내놓는 것:
    - route `machine/environment`(read, actors `user`·`agent`, 입력 `{}`, 출력 `machineEnvironmentSchema`(README 계약 7)). 오류 없음(읽지 못한 부분은 그 칸의 `error`)
    - section 자리: `ctx.folderEnvironment.register({ name, top?(), machine?(id), app?(app) })`(README 계약 7). 같은 이름을 두 번 등록하면 기동 오류다. 함수 하나가 던지거나 2초를 넘으면 그 section만 `{ error }`
    - route `apps/take_in`(command, `folder-apps`의 정의)
    - route `machine/forget`(memory, actors `user`만, 입력 `{machine: Id<"mch">}`, 자기 id면 `invalid_input`, 모르는 id면 `not_found`)와 CLI `machine.forget`(사람의 터미널. agent workspace에 내지 않는다)
    - route `apps/sync_held`(memory, actors `user`·`agent`, 입력 `{app, action: "list" | "apply" | "discard", seq?}`)와 CLI `app.sync_held`(workspaces `home`·`app`). calls의 `syncHeld`를 부른다
    - CLI `machine.environment`(read, workspaces `home`·`app`, 요약 한 줄: 기계 수, destination 상태, 오류가 있는 앱 수). 설명은 agent가 읽는 글이다: 무엇이 나오는지, `display_name`, `waiting_for`와 `held`의 뜻, 실시간이 아니라는 것, destination은 `lophn settings set folder.destinations`로 둔다는 것, 폰은 이 컴퓨터를 거친다는 것
    - CLI `app.take_in`(write, workspaces `home`, 위치 인자 `app`): 끝나면 "activate it with `lophn release activate <release>`; the person is asked on this machine"을 요약에 싣는다
    - folder wiring이 always-on에게 주는 자리: `alwaysOn(): { keep_running, starts_at_login, keep_awake } | null`(지금 null을 돌려주는 한 줄. `always-on`이 `ctx.alwaysOn.status()`로 바꾼다)

## 할 일

1. `wiring/folder.ts`: `ctx.machine`, 설정, ledger, 앱 목록(활성 선언의 `sync_to`), calls의 `folder`와 `exclusive`·`link.snapshot`·sync log head로 만든 `snapshotAt`, invocation 읽기로 만든 `operationOf`로 export·import·apps를 만든다. 기동 때 data root의 `folder-tmp/`를 비우고 기계 기록을 쓴다.
1a. module 사이 port를 잇는다: export의 `readsCaughtUp`·`peerHorizons`는 import에서, import의 `exportState`는 export에서, `heldRows`는 sync log의 held 줄에서, apps의 `progress`는 import의 cursor와 export의 `settled`·horizon에서.
2. 계기: bus의 `AppSyncChanged`(앱마다 5초 debounce)와 5분 timer로 export와 앱 기록·release·source 쓰기, destination마다 `machines/`의 `fs.watch`(recursive. 안 되면 timer만, 2초 debounce)와 2분 timer로 scan, import, source 받기. (앱, destination)·(앱, 출처)마다 한 번에 하나만 돈다. 결과가 `more`면 바로 이어 돈다. 설정 `folder.destinations`가 바뀌면 감시를 다시 건다. 종료 때 감시와 timer를 닫는다. 이 일들은 idle-exit를 막지 않는다.
3. 앱을 지울 때(`apps-delete.ts` 한 줄): export·import의 `forget`(held file 포함).
3a. 흔적 정리(README 계약 10): 앱이 뜬 뒤와 하루에 한 번 `before = max(min(알려진 기계(forgotten 아님)와 자기의 settled), hlcAtMs(now − 90일))`을 세어 calls/link의 `sync_cleanup`을 부르고, 돌아온 `horizon`을 `folder_streams.horizon`에 둔다(앱 기록에 실린다). 알려진 기계 가운데 `settled`가 없는 기계가 있으면 그 앞쪽은 90일 쪽만 쓴다.
3b. horizon 밖 알림: 앱의 `away_since`가 생기거나 held 줄이 늘면 core 알림 하나("<앱> was away from the other computers too long: <n> changes are held on this computer"), 풀리면 닫는다. `machine.environment`의 `apps[].away`가 같은 값을 싣는다.
4. `packages/core/folder/environment.ts`와 route: `this_machine`, 기계 목록(자기 + `folder_records`. 이름이 겹치면 `display_name`에 id 앞 6자), destination 상태, 앱마다 export·imports 상태와 held 수, `available`. 경로 말고는 local file 내용을 싣지 않는다.
5. CLI 넷(`machine.environment`, `machine.forget`, `app.take_in`, `app.sync_held`)과 `machine.ts`의 `MACHINE_COMMANDS`. `machine.environment` 설명에 destination은 사람이 승인한다는 것, `away`와 `app.sync_held`의 뜻을 싣는다.
6. flows: route 넷, CLI 넷, 이 task의 test file 줄(`app-runtime`과 `cli` area).
7. `boot.sh`로 두 번 띄워 wiring이 오류 없이 서는지 본다.

## 끝남

- `npm run check`가 통과한다. `project-docs/plan/tools/lead/boot.sh`가 통과한다.
- 위험 test: "흔적 정리의 `before`는 알려진 기계 가운데 가장 늦은 `settled`를 넘지 않거나 90일보다 옛 값이고, 지운 기계는 붙잡지 않는다"(식의 표 test). 나머지 규칙의 test는 wave 1·2에 있고 두 core의 끝에서 끝 확인은 lead가 한다
- 남지 않음: 없음(더하기).
- flows catalog: 이 task가 더하는 route·CLI 명령과 test file의 줄은 이 task가 project-docs/flows 에서 고친다(자기 줄만. 꼴은 .claude/skills/flows/SKILL.md). `node tools/flows.ts check`가 통과해야 한다.

## 보고

`.claude/skills/orchestrate/brief-template.md`의 "보고" 꼴. 더해서: `machine.environment`의 실제 출력 한 벌(개발 data root, destination 하나), 이 기계에서 `fs.watch` recursive가 되었는지, 계기 수치.
