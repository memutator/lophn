# carry-links

명단의 컴퓨터끼리 붙어 있으면 그 link로 서로 없는 file을 주고받는다. 이 컴퓨터가 상대의 manifest 목록을 받아 받는 자리에 넘기고, 믿는 manifest가 싣는데 이 컴퓨터에 없는 file을 상대에게서 조각으로 받아 받는 자리에 넘긴다. 상대가 다른 컴퓨터가 낸 file을 들고 있으면 그것도 받는다. 그래서 늘 켜 둔 기계가 저절로 가운데가 된다. 받은 file을 폴더 길에 넣는 것은 carry-folder다.

- 단위: carry (wave 2)
- 선행: carry-contract
- 소유(이 task만 고친다):
  - `packages/core/remote/links.ts`
  - `packages/core/remote/carry.ts`(새 file), `packages/core/remote/carry_test.ts`(새 file)
  - `packages/core/main/daemon/wiring/remote.ts`
  - `project-docs/flows/tests/core-rest.yaml`
- 읽을 것:
  - 계획 README "정한 것"의 바닥의 생각, "컴퓨터끼리 연결로 옮긴다"
  - `carry-contract` brief의 "고정할 모양"(route 넷, `CARRY_CHUNK_MAX_BYTES`, `carry_files`, `FolderReplica`)
  - architecture: `project-docs/architecture/remote.md`("컴퓨터끼리의 연결"), `folder-sync.md`(carry-contract가 고친 판, "계기와 물러남"), `event.md` 지키는 것 18(core가 듣는 wiring)
  - 본보기: 폴더 읽기의 계기·물러남·한 번에 하나(`packages/core/main/daemon/wiring/folder.ts`), link의 `call`·`watch`(`links.ts`)
  - 조사 `reports/multi-device/survey-n2-carry-paths.md` 1c, 9(`links.watch`가 통째로 바뀌는 것)
- 계약:
  - 쓰는 것: `carry/manifests`, `carry/file`(상대 컴퓨터에서 `device:<이 컴퓨터 id>`로), `ctx.peek.folderReplica`(`offerManifest(text, "link")`, `wants`, `receive(…, "link")`), `StateChanged{carry_files}`
  - 내놓는 것: 없음

시작 전에 다시 볼 것: `one-screen`의 `screen-base`가 먼저 main에 올라갔으면 `links.ts`의 watch가 "구독자들의 합"으로 바뀌었다. 그때는 그 API로 core 안 구독자 하나를 더하고 아래 1의 두 owner 합을 따로 만들지 않는다. `fix-setup`이 `machines/call|watch` handler를 `packages/core/remote/machine-routes.ts`로 옮기고 `wiring/remote.ts`의 두 줄을 바꿨다. 이 task는 `links`의 함수를 바로 부르고 그 route를 쓰지 않는다. carry-contract가 `wiring/remote.ts`에 둔 provide 셋은 그대로 둔다.

## 할 일

1. `links.ts`:
   - link마다 거는 watch 조건은 화면이 건 조건(`machines/watch`)에 `{types: ["StateChanged"]}` 하나를 더한 것이다. 화면이 조건을 바꿔도, link를 새로 열어도 남는다.
   - 그 컴퓨터에서 온 `StateChanged`에 `carry_files`가 있으면 deps의 새 callback `onPeerCarry(machine)`을 부른다. 화면의 조건이 원하지 않은 frame은 `MachineFrameReceived`로 싣지 않는다.
   - link가 `connected`가 될 때마다 deps의 `onPeerReady(machine)`.
2. `packages/core/remote/carry.ts`: 컴퓨터마다 한 번에 하나인 받기 일.
   - 계기: `onPeerReady`, `onPeerCarry`(2초 debounce), 이 기계의 `StateChanged{carry_files}`(새로 믿게 된 manifest가 상대에게 있는 file을 바랄 수 있다), 5분 timer. 실패하면 1분부터 두 배씩 1시간까지 물러난다. idle-exit를 막지 않는다.
   - 한 번: 상대의 `carry/manifests`를 읽어 하나씩 `offerManifest(text, "link")`. 그 뒤 `wants(1000)`의 file마다 상대의 `carry/file`을 8 MiB씩 불러 그 조각을 `receive({…, via: "link", chunks})`에 흘린다. `not_found`는 상대가 들고 있지 않은 것이라 건너뛴다. 남은 것이 있으면 이어 돈다.
   - 받는 쪽 검사는 `receive`가 한다. 이 file은 검증하거나 쓰지 않는다.
3. `wiring/remote.ts`: `createLinks`에 두 callback을 꽂고, 받기 일을 remote가 켜지고 꺼질 때 같이 시작하고 멈춘다. `ctx.peek.folderReplica`가 없으면 다음 계기로 미룬다. 이 기계의 `StateChanged{carry_files}`는 bus 구독으로 듣는다(folder wiring이 `AppSyncChanged`를 듣는 것과 같다).
4. 상대가 이 컴퓨터에서 받는 쪽은 carry-folder의 route handler가 한다. 이 task는 그것을 고치지 않는다.
5. `carry_test.ts`를 `project-docs/flows/tests/core-rest.yaml`에 올린다(`flows` skill).

### 정한 것
- 받는 쪽이 상대에게서 가져간다(pull): 보내는 쪽이 상대마다 무엇을 보냈는지 들 필요가 없고, 무엇이 없는지는 받는 자리의 `wants`가 안다.
- 상대가 바뀐 것을 아는 계기는 이미 기기 event 목록에 있는 `StateChanged`의 `carry_files`다: 새 frame이나 event type이 필요 없다.

## 끝남

- `npm run check`가 통과한다. `node tools/flows.ts check`가 통과한다.
- 위험 test: 없음(받은 file의 검증과 한 번 적용은 carry-folder의 위험 test가 본다). `carry_test.ts`는 가짜 link 호출과 가짜 `FolderReplica`로, 조각이 offset 순서로 하나의 `receive`에 가고 `not_found`인 file을 건너뛰는 것만 본다.
- link를 실제 socket으로 여는 test, subprocess·서버 test, E2E는 만들지 않는다. 실제 relay에 붙지 않는다.
- 남지 않음: 없음(더하기만 한다).

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
