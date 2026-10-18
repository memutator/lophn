# bt-rules

browser 탭이 인터넷 page를 다룰 때 쓰는 결정 규칙을 Electron 없는 순수 함수로 옮겨 짠다: navigation(scheme 거절, OS로 넘기기), popup(사용자 입력 5000ms 창, `features`의 크기로 floated인지 docked인지), permission, 입력 활동 기록, 주소 칸 입력 정리. rea `policy.js`의 규칙을 TS로 옮긴다(dependency로 넣지 않는다). 다른 task가 모두 이것을 부른다.

- 단위: bt-rules (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/shell/main/browser/navigation.ts`
  - `packages/shell/main/browser/navigation_test.ts`
  - `packages/shell/main/browser/popup.ts`
  - `packages/shell/main/browser/popup_test.ts`
  - `packages/shell/main/browser/permission.ts`
  - `packages/shell/main/browser/permission_test.ts`
  - `packages/shell/main/browser/activation.ts`
  - `packages/shell/main/browser/address.ts`
- 읽을 것:
  - 계획: `project-docs/plan/browser-tab/README.md`
  - 제품 결정: `project-docs/products/roadmap/browser-tab.md`의 "무엇을 만드나" 1(navigation, popup, permission)과 "정한 것"
  - 본보기(규칙): `/home/pyosechang/projects/rea/project/desktop-embeded-browser/src/main/policy.js`(`decideNavigation`, `decidePopup`, `decidePermission`, `isActivationFresh`), `src/main/popups.js`(`markUserInput`)
  - 본보기(test 꼴): `packages/shell/main/app-frame/app-call_test.ts`(`node:test`와 `node:assert/strict`)
  - 같은 모양의 앱 쪽 규칙: `packages/shell/main/app-frame/network-policy.ts`, `external-link.ts`의 `checkExternalUrl`
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `shell`, `project-docs/module-catalog.yaml`의 `packages/shell/main`
  - test 기준: `.claude/skills/write-test/SKILL.md`
- 계약:
  - 쓰는 것: 없음(Electron도 import하지 않는다. `packages/base`도 shell이 import하지 못하므로 시각은 인자다).
  - 내놓는 것(이 모양을 다른 task가 부른다):
    - `navigation.ts`
      - `type NavigationDecision = { allow: true } | { allow: false; reason: "unparseable" | "scheme" | "credentials"; external?: true }`
      - `decideNavigation(input: { url: string; isMainFrame: boolean }): NavigationDecision`
    - `popup.ts`
      - `type PopupPlacement = { kind: "docked" } | { kind: "floated"; width: number; height: number }`
      - `type PopupDecision = { action: "allow"; url: string; placement: PopupPlacement } | { action: "deny"; reason: "unparseable" | "scheme" | "credentials" | "no-activation"; external?: true }`
      - `decidePopup(input: { url: string; features: string; activated: boolean }): PopupDecision`
      - `parseWindowFeatures(features: string): { width?: number; height?: number }`
    - `permission.ts`: `decidePermission(input: { permission: string; requestingUrl: string; isMainFrame: boolean }): boolean`
    - `activation.ts`
      - `ACTIVATION_WINDOW_MS = 5000`
      - `createActivation(clock: { nowMs(): number }): { mark(contentsId: number): void; fresh(contentsId: number): boolean; forget(contentsId: number): void }`
    - `address.ts`: `normalizeAddress(text: string): string | null`

## 할 일

1. `navigation.ts`: `decideNavigation`.
   - 파싱이 안 되면 `unparseable`.
   - main frame: `http:`·`https:`는 host를 가리지 않고 허용한다. localhost와 사설 IP도 막지 않는다(roadmap "정한 것"). 다만 userinfo(`user:pass@`)가 있으면 `credentials`로 거절한다(rea와 같다. 피싱에 쓰이는 모양이다). `about:blank`는 허용한다(popup이 빈 page로 시작한다). 최상위 `data:`·`blob:` navigation은 `scheme`으로 거절한다(Chrome도 막는다).
   - subframe: `http:`·`https:`(userinfo가 있어도 허용)와 `data:`·`blob:`·`about:`(`about:blank`, `about:srcdoc`)를 허용한다. 실제 site가 iframe에 쓴다(rea `requests.js`의 `ALLOWED_OPAQUE_SCHEMES`도 `data:`, `blob:`, `about:`를 통과시킨다).
   - 그 밖의 scheme(`file:`, `lophn-shell:`, `lophn-app:`, `chrome:`, `devtools:`, `javascript:`, custom protocol)은 main frame과 subframe 모두 `scheme`으로 거절한다.
   - `mailto:`와 `tel:`은 main frame에서만 `external: true`를 붙여 거절한다(OS가 다루는 것은 OS로 넘긴다. 넘기는 쪽이 fresh activation을 요구한다). subframe은 조용히 거절하고 `external`을 붙이지 않는다. 그래서 제3자 iframe이 OS를 열지 못한다.
   - 이 함수는 navigation만 정한다. subresource 요청은 막지 않는다(session에 요청 guard를 두지 않는다. `bt-session`).
2. `activation.ts`: `createActivation(clock)`. `mark(id)`가 그 시각을 기억하고, `fresh(id)`는 `0 <= now - last < 5000`일 때만 true다. 기록이 없으면 false다. `forget(id)`는 지운다. 시각은 인자로만 받는다(전역 `Date.now()`를 부르지 않는다).
3. `popup.ts`: `parseWindowFeatures`와 `decidePopup`.
   - `parseWindowFeatures`: `window.open`의 `features`(쉼표로 나뉜 `key=value`, 대소문자 무시, 공백 허용)에서 `width`, `height`를 읽는다. 양의 정수만 받고(소수는 내림), 아니면 없는 것으로 본다.
   - `decidePopup`: 먼저 `decideNavigation({url, isMainFrame: true})`를 부른다. 거절이면 그 `reason`과 `external`을 그대로 실어 `deny`로 낸다. 허용인데 `activated`가 false이면 `no-activation`이다. 그 밖에는 `allow`이고, `width`와 `height`가 둘 다 있으면 `placement`가 `floated`, 아니면 `docked`다(`target=_blank` link가 docked에 든다).
4. `permission.ts`: `decidePermission`. `clipboard-sanitized-write`를 main frame의 http/https 주소가 요청했을 때만 true다. clipboard read, 카메라·마이크(`media`), 위치, 알림, 그 밖의 모든 것, subframe은 false다.
5. `address.ts`: `normalizeAddress`. 앞뒤 공백을 지운다. 빈 글이면 null이다. `://`가 든 것은 그대로 둔다. `about:`, `mailto:`, `tel:`, `javascript:`, `data:`, `file:`, `blob:`, `chrome:`로 시작하는 것도 그대로 둔다(거절은 `decideNavigation`이 한다). 나머지는 scheme 없는 입력이다: host(첫 `/`, `?`, `#` 앞, port 제외)가 `localhost`나 `127.0.0.1`이면 `http://`를, 아니면 `https://`를 붙인다. 붙인 결과가 `new URL`로 파싱되지 않으면 null이다. 검색어 처리는 하지 않는다(roadmap).
6. test(`*_test.ts`, 대상 옆, 위험 test 셋. 아래 "끝남").

## 정한 것

- main frame의 userinfo URL 거절은 roadmap이 정하지 않았고 rea를 따랐다. `checkExternalUrl`(OS browser로 보내기)도 같은 규칙이라 사용자에게 새로운 제한이 아니다.
- `mailto:`·`tel:` 말고 `slack://`, `vscode://` 같은 custom protocol은 OS로 넘기지 않고 거절한다. roadmap의 "custom protocol은 막는다"를 따랐다. 쓰이면 목록에 더한다.
- 최상위 `data:`·`blob:`는 거절하고 subframe의 `data:`·`blob:`·`about:`는 허용한다. roadmap의 "그 밖의 scheme은 막는다"를 실제 site가 쓰는 opaque scheme만큼 좁혔다(planner 검토에서 정함).
- 시각 인자는 `{ nowMs(): number }`다. shell은 `packages/base`의 Clock을 import하지 못하므로 `main/app-frame/registry.ts`의 `deps.clock`과 같은 모양을 쓴다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test(세 개. 모두 순수 함수라 process·Electron을 띄우지 않는다):
  - "`file:`, `lophn-app:`, `chrome:`, `javascript:`, custom scheme으로 가는 main frame과 subframe navigation은 거절되고, 최상위 `data:`·`blob:`도 거절되지만 subframe의 `data:`·`blob:`·`about:`는 허용되며, `mailto:`는 main frame에서만 OS로 넘기기로 표시되고, http/https(localhost와 사설 IP 포함)는 허용된다." (`navigation_test.ts`, 표로 돈다.)
  - "popup은 사용자 입력 5000ms 안에서만 허용되고(4999ms는 허용, 5000ms와 기록 없음은 거절), `width`와 `height`가 둘 다 있을 때만 floated이며, 주소 검사에 걸린 주소는 입력이 있어도 거절된다." (`popup_test.ts`, 수동 clock의 `createActivation`과 `decidePopup`을 같이 본다.)
  - "clipboard write만 main frame에서 허락되고 clipboard read, media, geolocation, notifications, 그 밖의 permission은 모두 거절된다." (`permission_test.ts`)
- `normalizeAddress`는 test하지 않는다(보안 경계가 아니다. 결과는 어차피 `decideNavigation`을 지난다).
- 남지 않음: `grep -rn "Date.now\|from \"electron\"" packages/shell/main/browser`가 0줄이다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: 없음
- 안 쓰게 된 export: 없음
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 넘길 줄: 없음
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- **무겁게 짠 것**: 없으면 "없음"
- **알려진 미완 동작**: 없으면 "없음"
