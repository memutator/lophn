# carry-phone

폰이 한 컴퓨터에서 받은 file(manifest와 그것이 싣는 file)을 들고 있다가 다른 컴퓨터에 붙었을 때 넘긴다. 폰에 화면이 없는 앱의 것도 내용을 모르고 나른다. 폰은 file을 검증하거나 적용하지 않는다(받는 컴퓨터가 한다). 명단의 다른 모든 컴퓨터가 가졌거나 상한(크기, 날수)을 넘으면 지운다. 큰 file은 Wi-Fi에서만 나르고 그 기준 크기는 폰의 설정이다. 폰 앱을 열어 둔 동안만 움직인다.

- 단위: carry (wave 2)
- 선행: carry-contract
- 소유(이 task만 고친다):
  - `packages/mobile/src/apps/carry/`(새 폴더: 저장소, 나르기, network 종류 port, test)
  - `packages/mobile/src/data/local-stores.ts`
  - `packages/mobile/src/screens/settings/index.tsx`
  - `packages/mobile/package.json`, `packages/mobile/package-lock.json`, `packages/mobile/app.json`(module이 config plugin을 요구할 때만)
  - `tools/wireframes/drafts/phone/more.tsx`
  - `packages/design/i18n/catalog/mobile-carry.ts`(새 file), `packages/design/i18n/en.ts`(한 줄)
  - `project-docs/flows/tests/libs-tooling.yaml`
- 읽을 것:
  - 계획 README "정한 것"의 "폰이 나른다", "큰 file은 Wi-Fi에서만 나른다", "남는 한계", roadmap `multi-device.md` "길"의 폰 줄
  - `carry-contract` brief의 "고정할 모양"(route 넷, manifest `body`의 `machine`·`revision`·`files`, `CARRY_CHUNK_MAX_BYTES`, `CROSS_EVENT_MAX_AGE_MS`, `carry_files`)
  - architecture: `project-docs/architecture/folder-sync.md`(carry-contract가 고친 판), `app-sync.md`(지키는 것 7: 폰은 앞에 있을 때만), `remote.md`("내 기기 명단"의 폰 쪽)
  - 본보기: 컴퓨터마다 연결 따라가기(`packages/mobile/src/data/local-stores.ts`), 폰 sync의 port와 node test(`packages/mobile/src/apps/local/{ports.ts,sync.ts,local.test.ts}`), native 파일·DB(`packages/mobile/src/apps/local/native.ts`), 폰 local 설정(`packages/mobile/src/app/appearance.tsx`의 SecureStore key), Settings flow(`tools/wireframes/drafts/phone/more.tsx`)
  - `packages/mobile/README.md`, `.claude/skills/ui-design/SKILL.md`, `.claude/skills/write-test/SKILL.md`
- 계약:
  - 쓰는 것: `carry/manifests`, `carry/wants`, `carry/file`, `carry/put`, event `StateChanged{carry_files}`, 컴퓨터마다의 `Link.data.core`(`Remote` port), 폰 명단의 컴퓨터 목록(`Computer`의 `machine`)
  - 내놓는 것: 없음

시작 전에 다시 볼 것: `fix-roster`가 폰과 같이 쓰는 명단 code(`packages/protocol/remote/roster.ts`)와 판(4)을 바꿨다. 컴퓨터의 `machine`을 어디서 읽는지 merge된 code에서 본다. `one-screen`의 `screen-phone`이 `local-stores.ts`나 Settings 화면을 고쳤으면 그 위에서 짓는다.

## 할 일

1. wireframe 먼저(`ui-design`): `drafts/phone/more.tsx`의 Settings에 "Between your computers" 절: 지금 들고 있는 양(file 수, 크기), "Over mobile data, carry files up to" 고르기(256 KB, 1 MB, 8 MB, Any size. 기본 1 MB), 한 줄 설명(폰이 열려 있을 때 한 컴퓨터의 것을 다른 컴퓨터로 나른다).
2. 저장소(`apps/carry/`): `Paths.document` 아래 `carry/`(`files/apps/` 밖이다. `forget()`가 그 아래를 컴퓨터 폴더로 보고 지운다). SQLite 하나(`nativeDeps.open`)에 표 셋과 file bytes는 `carry/files/`에.
   - manifest: `machine`마다 가장 큰 revision의 text와 받은 때.
   - file: `(machine, path)`, size, sha256, 받은 때, 받아 온 컴퓨터.
   - 컴퓨터 X의 상태: X가 든 manifest revision(기계마다)과 마지막 `wants`(받은 때).
3. 나르기: 컴퓨터 X와 연결이 섰을 때, X의 `StateChanged{carry_files}`, 연결된 동안 5분마다. X마다 한 번에 하나다.
   - X의 `carry/manifests`를 읽어 폰이 든 것보다 큰 revision을 저장하고, X가 든 revision을 X의 상태에 적는다.
   - 넘기기: 폰이 든 manifest 가운데 X의 것보다 큰 revision을 `carry/put`(path `manifest.json`)으로. 그 뒤 X의 `carry/wants`를 읽어 X의 상태에 적고, 그 가운데 폰이 든 file을 8 MiB씩 `carry/put`. `accepted`·`have`는 X가 가진 것, `rejected`는 폰의 사본이 틀린 것이라 폰에서 지운다.
   - 받기: 다른 컴퓨터의 마지막 `wants`에 있고 X가 든 file, 그리고 X에서 새로 받은 manifest에 있는데 지난 revision에는 없던 file을 `carry/file`로 받는다(`not_found`는 건너뛴다). 크기와 sha256이 manifest(또는 그 file을 덮는 `release.json`·`source/<n>.json`. 폰은 그 file도 들고 있으면 읽는다)와 다르면 버린다. 이것은 폰을 지키는 것이고 믿음은 받는 컴퓨터가 정한다.
4. 지우기: file 하나는 명단의 다른 모든 컴퓨터 Y에 대해 "Y가 든 그 기계의 manifest revision이 그 file을 실은 revision 이상이고 Y의 마지막 `wants`에 그 file이 없다"이면 지운다. 그 밖에 상수 `CARRY_MAX_BYTES = 256 MiB`를 넘으면 받은 때가 옛 것부터, `CARRY_MAX_AGE_MS = 30일`이 지난 것, event file은 `CROSS_EVENT_MAX_AGE_MS`가 지난 것을 지운다. 명단에서 빠진 컴퓨터의 상태와 그 기계의 manifest·file도 지운다.
5. network 종류: `expo-network`를 더한다. 판은 `npm ci` 뒤 `node_modules/expo/bundledNativeModules.json`이 Expo SDK 58에 적은 판 그대로 정확히 고정한다. Wi-Fi와 ethernet은 "재지 않는 길", 나머지와 알 수 없음은 "재는 길"이다. 재는 길에서는 기준보다 큰 file을 받지도 넘기지도 않는다(manifest는 늘 나른다). Wi-Fi가 되면 다시 돈다.
6. 기준 크기 설정은 appearance처럼 SecureStore의 key 하나(`carry`)에 둔다. Settings 화면에 wireframe대로 그린다. 글은 `mobile-carry.ts` catalog의 key다(`en.ts`에 한 줄).
7. `local-stores.ts`의 `followLocalComputers`가 연결이 선 컴퓨터마다 나르기를 잇고 끊는다. `AppState`가 연결을 멈추면 나르기도 멈춘다(background 작업을 만들지 않는다).
8. test file을 `project-docs/flows/tests/libs-tooling.yaml`에 올린다(`flows` skill).

### 정한 것
- 폰은 다른 컴퓨터가 바란 file과 새로 나온 file만 받는다: 모든 file을 받으면 release와 snapshot으로 폰이 찬다. 바람을 모르는 첫 만남에도 새 file은 간다.
- 저장소는 SQLite 하나와 file 폴더다: 폰 앱이 이미 가진 native module이라 dependency가 늘지 않고, 들고 있는 것과 컴퓨터의 상태를 한 transaction으로 고친다.
- 기준 크기는 고르기 넷이다: 사람이 고르기 쉽고 틀린 값이 없다.

## 끝남

- `npm run check`가 통과한다. `npm run wireframes`가 되고 gallery의 Settings flow에 새 절이 그려진다.
- `cd packages/mobile && npm ci && npm run typecheck && npm test`가 통과한다.
- 위험 test(`apps/carry/`의 node test, `node:sqlite`와 가짜 컴퓨터로): "폰은 file을 명단의 다른 모든 컴퓨터가 그 file을 실은 manifest를 들고 바라지 않을 때까지 지우지 않고, 크기나 날수 상한을 넘을 때만 받은 때가 옛 것부터 지운다."
- 화면 test, 실제 기기·emulator가 드는 test, E2E는 만들지 않는다. dev build와 emulator 확인은 lead가 사람에게 부탁한다.
- 남지 않음: 없음(더하기만 한다).

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: lead가 고칠 목록 file(`protocol/*/mod.ts`, core 조립 목록, gallery `pages/index.ts`, `package.json`)
- 안 쓰게 된 export(남이 쓰던 것은 지우지 않는다)
- 정한 것: 문서에 답이 없어 worker가 정한 것(고정한 `expo-network` 판과 그것을 읽은 곳)
- 넘길 줄: 남의 file을 최소로 맞춘 곳
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- **무겁게 짠 것**: 가장 단순한 구현(AGENTS.md "속도")보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것. 없으면 "없음"
