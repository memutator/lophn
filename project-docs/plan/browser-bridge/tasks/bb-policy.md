# bb-policy

bridge가 URL과 요청을 받아들일지 정하는 순수 함수를 `main/browser-bridge/policy.ts`에 모으고, link를 열 곳 설정 둘(`shell.browser.web_links`, `shell.browser.local_links`)을 core에 선언한다. 이 함수들이 bridge의 권한 경계다(어떤 URL이 browser 탭으로 넘어갈 수 있는가, 어떤 요청 줄을 받는가, 사용자의 `BROWSER`를 건드리지 않는가). Electron도 socket도 부르지 않는다.

- 단위: bb-policy (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/shell/main/browser-bridge/policy.ts`
  - `packages/shell/main/browser-bridge/policy_test.ts`
  - `packages/core/config/shell-settings.ts`
- 읽을 것:
  - 계획: `project-docs/plan/browser-bridge/README.md`("정한 것")
  - 제품 결정: `project-docs/products/roadmap/browser-tab.md`의 "무엇을 만드나" 2(서버, shim의 전송 조건)·4(link를 열 곳)
  - 본보기(순수 함수와 표 test): `packages/shell/main/browser/navigation.ts`와 `navigation_test.ts`, `permission.ts`와 `permission_test.ts`
  - 본보기(declareSetting): `packages/core/config/shell-settings.ts`의 `densitySetting`, `SETTING_KEY` 규칙은 `packages/protocol/config/declaration.ts`
  - 가져올 규칙(코드를 복사하지 않고 계약만 따른다): `../rea/project/desktop-embeded-browser/src/main/policy.js`의 `isRelayableUrl`, `parseBridgeRequest`, `PRIVATE_HOST_PATTERNS`, `isPrivateHost`
  - 이미 있는 비슷한 검사: `packages/shell/main/app-frame/external-link.ts`의 `checkExternalUrl`(http/https, userinfo 없음, 8192자 이하)
- 계약:
  - 쓰는 것: 없음.
  - 내놓는 것(`policy.ts`의 export. 다른 task가 이 이름으로 부른다):
    - 상수 `BRIDGE_ENV = "LPN_BROWSER_BRIDGE"`, `MAX_REQUEST_BYTES = 8192`, `MAX_REPLY_BYTES = 1024`, `SOCKET_TIMEOUT_MS = 3000`, `MAX_URL_CHARS = 8192`, `BRIDGE_KEY_PATTERN = /^[0-9a-f]{64}$/`, `LINK_SETTING_KEYS = { web_links: "shell.browser.web_links", local_links: "shell.browser.local_links" }`.
    - `type LinkWhere = "browser_tab" | "system_browser"`, `type LinkPrefs = { web_links: LinkWhere; local_links: LinkWhere }`, `DEFAULT_LINK_PREFS`(둘 다 `browser_tab`).
    - `parseBridgeRequest(line: string): { key: string; url: string } | null`.
    - `isRelayableUrl(input: string): boolean`.
    - `isLocalHost(hostname: string): boolean`.
    - `linkTarget(url: string, prefs: LinkPrefs): LinkWhere | null`(relayable이 아니면 null).
    - `linkPrefsOf(listed: unknown): LinkPrefs`.
    - `bridgeEnv(processEnv, issued: { shim: string; socket: string; key: string }): Record<string, string> | null`.
  - 선언 설정: core의 `shell.browser.web_links`, `shell.browser.local_links`(값 `browser_tab` | `system_browser`, 기본 `browser_tab`). 이 key 이름은 고정이다. renderer의 Settings(`bb-settings`)와 main이 같은 이름으로 읽는다.

## 할 일

1. `policy.ts`를 만든다. 모든 함수는 인자만 보고 답한다(`Date`, `process`, 파일, 전역 상태를 읽지 않는다).
   - `parseBridgeRequest(line)`: JSON 한 줄을 읽어 `v === 1`, `key`가 `BRIDGE_KEY_PATTERN`, `url`이 비지 않은 string이면 `{ key, url }`, 아니면 null. 줄이 `MAX_REQUEST_BYTES`(UTF-8 byte)를 넘어도 null. 줄 끝 개행은 호출한 쪽이 이미 떼었다.
   - `isRelayableUrl(input)`: `new URL(input)`이 되고, 프로토콜이 `http:`·`https:`이고, `username`·`password`가 비었고, 입력이 `MAX_URL_CHARS` 이하이면 true. 상대 경로, `file:`, `javascript:`, `mailto:`, userinfo가 있는 URL은 false.
   - `isLocalHost(hostname)`: `localhost`, `*.localhost`, `127.0.0.0/8`, `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `169.254.0.0/16`, `::1`, `fc00::/7`, `fe80::/10`, `*.local`이면 true. 끝의 `.`는 떼고, 대소문자를 가리지 않고, `new URL(...).hostname`이 주는 대괄호 IPv6(`[::1]`)를 받는다. rea의 `PRIVATE_HOST_PATTERNS`에 `.local`(roadmap)을 더한 것이다. `localhost.evil.com`은 local이 아니다.
   - `linkTarget(url, prefs)`: `isRelayableUrl`이 아니면 null. 호스트가 local이면 `prefs.local_links`, 아니면 `prefs.web_links`.
   - `linkPrefsOf(listed)`: core `memory:settings/list`의 답(`{ settings: [{ key, default?, chosen? }] }`, renderer의 `desktop/settings/declared.ts`가 읽는 모양)에서 두 key의 값을 읽는다. `chosen`이 있으면 그것, 없으면 `default`. 두 값 중 `browser_tab`·`system_browser`가 아닌 것, 답의 모양이 틀린 것, `undefined`는 key별로 기본값이다. 던지지 않는다.
   - `bridgeEnv(processEnv, issued)`: `{ BROWSER: issued.shim, [BRIDGE_ENV]: JSON.stringify({ socket: issued.socket, key: issued.key }) }`. 단 `processEnv.BROWSER`가 비지 않았고 `processEnv[BRIDGE_ENV]`가 없으면(사용자가 `BROWSER`를 직접 둔 것) null이다. `BRIDGE_ENV`가 있으면 그 `BROWSER`는 바깥 lophn이 넣은 shim이므로(lophn 터미널 안에서 lophn을 개발할 때) 덮어쓴다.
2. `policy_test.ts`: 표 test 셋. (a) `parseBridgeRequest`와 `isRelayableUrl`의 받는 줄·거절하는 줄, (b) `linkTarget`의 local/web 구분(local: `localhost`, `app.localhost`, `127.0.0.2`, `10.1.2.3`, `192.168.0.5`, `172.16.0.1`, `169.254.1.1`, `[::1]`, `[fd00::1]`, `[fe80::1]`, `nas.local`. web: `example.com`, `8.8.8.8`, `172.32.0.1`, `localhost.evil.com`)과 `linkPrefsOf`의 빠진 값·틀린 값 기본값, (c) `bridgeEnv`가 사용자 `BROWSER`를 덮지 않고 바깥 lophn의 것은 덮는 것. `node:test`와 `node:assert/strict`를 쓴다(`navigation_test.ts` 꼴).
3. `packages/core/config/shell-settings.ts`: `webLinksSetting`·`localLinksSetting`을 `declareSetting`으로 선언하고(`type: z.enum(["browser_tab", "system_browser"])`, `default: "browser_tab"`) `shellSettings` 배열 끝에 더한다. `policy.ts`의 `LINK_SETTING_KEYS`는 shell이 core를 import하지 못해서 같은 글자를 따로 적은 것이다. 두 곳에 서로를 가리키는 주석을 한 줄씩 단다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test: "userinfo가 있는 URL·`file:`·`javascript:`는 relayable이 아니고, 키·버전이 틀린 요청 줄은 받지 않으며, 사용자가 둔 `BROWSER`는 덮지 않는다" (`policy_test.ts`의 셋).
- 남지 않음: 없음(새 file).

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: 없음. wording의 setting name·help는 `bb-settings`가 쓴다.
- 안 쓰게 된 export: 없음
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 넘길 줄: 없음
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- **무겁게 짠 것**: 없으면 "없음"
- **알려진 미완 동작**: 없으면 "없음"
