# mobile-sdk-phone-hooks

폰 화면이 bridge(`lophnApp`)를 쓰는 SDK part `@lophn/app-ui-native` 1.0.0을 새로 낸다: `useOperation`, `useEvent`, `usePlace`와 operation 하나의 React Native 단추 `OperationButton`. hook은 desktop의 `@lophn/app-ui`가 이미 가진 DOM 없는 file을 그대로 vendoring해 두 벌이 갈라지지 않게 한다. 폰의 guest runtime과 desktop preview가 같은 전역 `lophnApp`을 주므로 같은 hook이 둘 다에서 돈다.

- 단위: phone-sdk (wave 5)
- 선행: mobile-sdk-kit, mobile-phone-contract. **`mobile-app` 계획이 main에 land된 뒤에 띄운다**(`OperationButton`이 kit의 `Button`을 쓴다)
- 소유(이 task만 고친다):
  - `packages/sdk/app-ui-native`(새 폴더 전체: `package.json`, `mod.ts`, `operation-button.tsx`, `guide.md`)
  - `packages/core/agent-workspaces/skills/migrate-sdk/app-ui-native-1.0.0.md`(새 file)
- 공유 줄 허락(한 줄씩만 더하고 보고의 "넘길 줄"에 적는다):
  - `packages/core/apps/packages/vendor.ts`(`VENDOR_RULES`에 `@lophn/app-ui-native` 항목. file은 `mobile-sdk-kit`이 고쳤다)
  - `package-lock.json`(새 workspace 항목. `npm install --package-lock-only --offline`을 해 보고 안 되면 `packages/sdk/app-ui-native` 항목만 손으로 더한다)
- 읽을 것:
  - skill: `.claude/skills/sdk-note/SKILL.md`. 본보기: `packages/sdk/app-ui`(hook과 `guide.md`의 구성), 첫 판 메모 본보기 `cap-fs-1.0.0.md`
  - vendor할 file: `packages/sdk/app-ui/{use-operation.ts,use-event.ts,use-place.ts}`(DOM이 없다. `use-operation.ts`만 `@lophn/declaration`의 type을 import한다), 본보기 vendor 규칙 `vendor.ts`의 `DECLARATION`·`AGENT`(원본 file을 사본 안 `vendor/`로 담고 specifier를 바꾼다)
  - 계약: `packages/protocol/apps/phone-screen.ts`(`lophnApp`의 모양과 `callOperation`이 실패를 `"<code>: <message>"` Error로 reject한다는 규칙), `packages/protocol/shell/app-bridge-types.ts`(desktop의 `lophnApp`. 폰은 그 부분집합이다)
  - kit: `packages/design/native/mod.ts`의 `Button`(상태와 크기), `packages/design/i18n/catalog`(`@lophn/app-ui`의 `OperationButton`이 쓰는 문구 key를 그대로 쓴다: `packages/sdk/app-ui/operation-button.tsx`)
- 계약:
  - 쓰는 것: `@lophn/ui-native`(peer), `@lophn/declaration`(type, 정확한 판 pin)
  - 내놓는 것: `@lophn/app-ui-native` 1.0.0(`lophn.supported_from` 1.0.0). export: `OperationButton`, `useOperation`, `appBridge`, `useEvent`, `usePlace`와 그 type(`OperationSpec`, `OperationInput`, `OperationResult`, `OperationState`, `UseOperation`, `AppBridge`, `EventBridge`, `Place`, `PlaceValue`, `PlaceWorkspace`, `OperationButtonProps`). `useTabHead`·`useCommand`·`useProjects`·`useKeepAlive`·`AppErrorBoundary`는 없다(폰에 그 bridge가 없고 root의 오류 경계는 폰 앱의 base가 둔다)

## 할 일

1. `package.json`: `@lophn/app-ui-native` 1.0.0, `lophn.supported_from` 1.0.0, `exports "./mod.ts"`, `dependencies`는 `@lophn/declaration`(지금 판 4.6.0)·`@types/react`·`react`를 정확한 판으로(`packages/sdk/app-ui/package.json`을 본보기로), peer는 `@lophn/ui-native`와 `react-native`(kit의 `package.json`과 같은 판). 다른 SDK가 declaration 판에 정확히 기대므로 판을 올릴 때 이 part도 함께 올려야 한다는 것을 guide의 "version 정책"에 적는다(`@lophn/app-ui`의 같은 절).
2. `mod.ts`는 `../app-ui/use-operation.ts`·`use-event.ts`·`use-place.ts`에서 다시 낸다(저장소 안에서는 상대 경로로 닿는다). `vendor.ts`에 규칙을 더해 설치 사본에서는 `vendor/`로 담기고 specifier가 바뀐다.
3. `operation-button.tsx`: `@lophn/app-ui`의 `OperationButton`과 같은 props와 같은 동작(눌리는 동안 다시 눌리지 않는다, 실패는 원문 없이 한 문장과 다시 누르기)을 kit의 `Button`·`Text`와 `useOperation`으로 쓴다. 누르는 곳은 kit이 44 이상으로 준다. 문구는 `@lophn/i18n`의 `t()`로 desktop `OperationButton`과 같은 key를 쓴다(새 key를 만들지 않는다).
4. `guide.md`(한국어, 다른 SDK guide의 절 구성): 목적, 공개 API와 type, 요구 permission(없다), peer 의존 표, version 정책, 사용(폰 화면의 `phone.tsx` 예 하나: `usePlace`로 인자 읽기, `useOperation`/`OperationButton`으로 operation 부르기, `useEvent`로 event 받기). 규칙: 화면은 operation만 부르고 데이터는 bridge로만 받는다(network가 없다). 선언에 없는 이름과 command는 `forbidden`이다. event는 앱 선언의 `subscriptions`에 있어야 오고 화면이 떠 있는 동안만 받는다. `lophnApp`은 화면의 첫 render 전에 서 있다(폰 앱이 `init`을 받은 뒤에야 화면을 그린다). 이 kit이 폰 화면 전용이므로 `@lophn/app-ui`와 한 화면에 섞지 않는다.
5. 메모 `app-ui-native-1.0.0.md`(영어, `Previous: none`, `Breaking: no`, 새 part, 폰 화면에서 쓰는 방법 한 예, "Nothing is required of an existing app").
6. flows catalog: SDK export의 입구 줄은 이 task가 project-docs/flows 에서 고친다(자기 줄만. 꼴은 .claude/skills/flows/SKILL.md). `node tools/flows.ts check`가 통과해야 한다.

## 끝남

- `npm run check`(특히 `node tools/check-sdk-notes.ts`와 `packages/core/apps/packages/install_test.ts`)가 통과한다.
- 위험 test: 없음(hook은 `@lophn/app-ui`의 file 그대로이고, 사본이 자기 완결인지는 `mobile-sdk-kit`의 test가 모든 vendor 규칙에 걸리게 했으면 그것이 덮는다. 걸리지 않았다면 이 part를 그 test의 표에 올린다).
- 남지 않음: 없음(더하기뿐).
- `project-docs/flows/`가 check를 통과한다.

## 보고

`.claude/skills/orchestrate/brief-template.md`의 "보고" 꼴. 더해서: 설치 사본의 file 목록, `OperationButton`을 emulator나 preview로 그려 본 것은 없다는 것(그리기는 `mobile-preview-phone`과 `mobile-phone-guest`가 확인한다), 등록할 것·넘길 줄.
