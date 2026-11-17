# sweep-phone-local-apps

폰에서 도는 앱의 local 호출과 sync, 설치 실패 화면, 위젯 binding을 고친다.

- 단위: phone-local-apps (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/mobile/src/apps/`
  - `packages/mobile/src/widgets/`
  - `packages/mobile/modules/`
  - `packages/mobile/src/screens/apps/`
  - `packages/mobile/src/data/{local-apps.ts,local-stores.ts}`
  - `packages/mobile/guest/{base.ts,bridge.ts,build-base.sh,no-network.ts,root.tsx,stubs,lab}`
  - `packages/protocol/apps/phone-screen.ts`
- 읽을 것:
  - 고칠 이슈마다 `project-docs/issues/<id>.yaml`의 `now`·`fix`·`decided`(추천안과 정한 것이 할 일이다)와 그 이슈의 `topic` 이름의 `project-docs/architecture/<topic>.md`
  - 화면을 바꾸면 `.claude/skills/ui-design/SKILL.md`(wireframe을 먼저 고친다)
- 계약:
  - 쓰는 것: 소유 밖의 protocol, port, shell IPC, preload는 고치지 않는다. 필요하면 보고의 "계약 바꾸기 요청"에 적는다.
  - i18n catalog(`packages/design/i18n/catalog/`)에는 key를 더하기만 한다.

## 할 일

아래 이슈를 하나씩 고친다. 이슈 file은 고치지 않는다(lead가 닫는다). 이슈의 글이 지금 코드와 다르면 코드를 믿고 보고에 적는다.

1. `phone-hung-handler-blocks-later-calls`
2. `phone-oversize-change-cannot-be-pushed`
3. `phone-local-call-context-has-no-app-id`
4. `phone-sync-only-for-current-computer`
5. `phone-install-failure-shows-raw-core-error`
6. `phone-guest-backend-copies-pile-in-cache`
7. `phone-app-menu-says-runs-on-computer`
8. `widget-bindings-written-by-native-and-js-unlocked`

알아 둘 것:
- native code(Kotlin, C++)는 여기서 build하지 못한다. 고친 것은 보고에 적고 dev build가 필요하다고 쓴다.
- kit(`packages/design/native`)과 guest fixture는 `sweep-kit-instructions`의 것이다.

## 끝남

- `npm run check:full`이 통과한다.
- 폰 앱을 고쳤으므로 `cd packages/mobile && npm ci && npm run typecheck && npm test`도 통과한다(root check 밖이다).
- 위험 test: 이슈의 `fix`가 "test를 쓴다"고 한 것과 데이터·권한에 닿는 것만(`write-test` skill). 나머지는 없음
- 이슈마다 고쳤는지, 못 고쳤으면 왜인지가 보고에 있다.

## 보고

- 이슈마다: 고침 / 일부 / 못 함(이유), 지금 코드가 어떻게 하나 한두 문장, 지키는 test 이름(없으면 없음)
- 바꾼 file, 통과한 check
- 등록할 것, 안 쓰게 된 export, 정한 것, 넘길 줄, 계약 바꾸기 요청
- **무겁게 짠 것**: `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것(실제 폰이나 Electron에서 못 본 것 포함). 없으면 "없음"
