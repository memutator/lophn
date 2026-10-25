# link

shell 창 webContents에 navigation guard를 두어 main frame이 `lophn-shell://` 밖으로 가지 않게 하고, `http`/`https`는 `shell:open-external`로 넘긴다. 파일 읽기의 `MarkdownPane`은 `onOpenLink`로 `lophnShell.openExternal`을 넘긴다(이슈 `shell.md` "파일 읽기의 markdown link를 누르면 shell 창이 그 web page로 넘어간다").

- 단위: link (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/shell/main/desktop/navigation-guard.ts` (새 file)
  - `packages/shell/main/desktop/navigation-guard_test.ts` (새 file)
  - `packages/shell/main/desktop/window.ts`
  - `packages/shell/main/desktop/wiring/desktop-window.ts`
  - `packages/shell/main/desktop/open-external.ts`
  - `packages/shell/renderer/editor/markdown-pane.tsx`
- 읽을 것:
  - 계획: `project-docs/plan/agent-chat/README.md`의 "정한 것"(link는 renderer `onOpenLink`와 main guard 둘 다), "위험 test" 첫 줄
  - 제품 결정: `project-docs/products/roadmap/agent-chat.md`의 "무엇을 만드나" 1, "지금 코드"의 `shell:open-external` 줄
  - 이슈: `project-docs/issues/shell.md` "파일 읽기의 markdown link를 누르면 shell 창이 그 web page로 넘어간다"(지금 코드와 추천)
  - architecture: `project-docs/architecture/artifact.md`의 "지키는 것" 중 "navigation은 `will-frame-navigate`와 `will-redirect`에서 정한다"(56줄)와 그 다음 줄, `project-docs/architecture/browser-tab.md` 60줄("navigation 결정은 순수 함수 하나가 한다", 표는 `_test`가 지킨다)
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `shell`, `design-api`, `project-docs/module-catalog.yaml`의 `packages/shell/main`, `packages/shell/renderer`
  - 본보기(코드):
    - `packages/shell/main/artifact/navigation.ts`(`decideArtifactNavigation`)와 `navigation_test.ts`(node:test 표 하나)
    - `packages/shell/main/artifact/electron-view.ts` 61-90줄(`will-frame-navigate`·`will-redirect`·`setWindowOpenHandler`에 같은 결정을 건다)
    - `packages/shell/main/desktop/wiring/desktop.ts` 159-169줄(`createOpenExternal` 등록, headless면 열지 않는 `open`)
    - `packages/shell/main/app-frame/external-link.ts`(`checkExternalUrl`, `externalLinkRecord`)
  - 고칠 코드: `packages/shell/main/desktop/wiring/desktop-window.ts`(`openDesktopWindow`의 `create`. desktop 창과 detached 창이 모두 여기서 만들어진다. `wiring/detached.ts:60`), `packages/shell/main/desktop/open-external.ts`(`createOpenExternal`), `packages/shell/main/desktop/security.ts`(`SHELL_SCHEME`), `packages/shell/main/desktop/shell-protocol.ts`(`DESKTOP_URL` = `lophn-shell://desktop/index.html`), `packages/shell/renderer/editor/markdown-pane.tsx`, `packages/shell/renderer/desktop/settings/core-call.ts`의 `windowLinkOpener`(이미 app-frame과 settings가 쓴다), `packages/design/components/reading/markdown/markdown.tsx` 62-83줄(`onOpenLink`가 있으면 click을 막고 호출자가 연다)
- 계약:
  - 쓰는 것: `shell:open-external`(`packages/shell/ipc/open-external.ts`, `packages/shell/main/desktop/open-external.ts`), `SHELL_SCHEME`(`packages/shell/main/desktop/security.ts`), design `Markdown`의 `onOpenLink`, renderer의 `lophnShell.openExternal`.
  - 내놓는 것: shell 창(desktop·detached 창 모두 `wiring/desktop-window.ts`에서 만든다)의 guard. main frame은 `lophn-shell://` 밖으로 가지 않고, 새 창 요청은 deny이며, `http`/`https`는 open-external로 간다. chat의 markdown(`chat-md`)이 그리는 `<a href>`도 이 guard가 막는다.

## 할 일

1. `navigation-guard.ts`를 새로 만든다. Electron을 import하지 않는 순수 함수 하나다(근거: `browser-tab.md` 60줄, 본보기 `artifact/navigation.ts`).
   - `export type ShellNavigation = { allow: true } | { allow: false; external?: true }`
   - `export function decideShellNavigation(input: { url: string; isMainFrame: boolean }): ShellNavigation`
     - subframe(`isMainFrame: false`)은 `{allow: true}`다(아래 "정한 것").
     - main frame: protocol이 `${SHELL_SCHEME}:`이고 host가 `desktop`이면 allow. `http:`·`https:`면 `{allow: false, external: true}`. 그 밖(`file:`, `lophn-app:`, `lophn-artifact:`, 다른 host의 `lophn-shell:`, `data:`, `blob:`, `javascript:`, `about:`, `mailto:`, 풀리지 않는 URL)은 `{allow: false}`.
   - import는 `./security.ts`의 `SHELL_SCHEME` 하나다. shell main test는 node로 돌므로 zod나 electron을 싣는 file을 import하지 않는다.
2. `open-external.ts`: URL 검사·기록·열기를 함수 하나로 뺀다. IPC 통로와 1의 guard가 같은 규칙(http/https만, userinfo 거절, 8,192자 상한, 기록은 origin·path만)을 쓰게 한다(근거: roadmap "지금 코드"의 `shell:open-external` 줄).
   - `export async function openExternalLink(deps: { open(url: string): Promise<void>; log(line: string): void }, url: string): Promise<OpenExternalReply>`: `checkExternalUrl` → 통과 못 하면 `{ok: false, code: "invalid_input"}`, `deps.open` 실패면 `unavailable`, 성공이면 `{ok: true}`. log 줄은 지금 것(`shell link opened …`, `shell link not opened …`) 그대로다.
   - `createOpenExternal`은 caller·입력 검사 뒤 이 함수를 부른다. 바깥 동작은 그대로다.
3. `wiring/desktop-window.ts`의 `create`(창을 `new BrowserWindow`로 만든 직후, `windowHooks.created`보다 앞)에서 `window.webContents`에 guard를 건다(근거: README 정한 것 "link는 … main의 navigation guard 둘 다", `artifact.md` 56줄).
   - `open`은 `(url) => headless.headless ? Promise.resolve() : shell.openExternal(url)`(`desktop.ts` 166-167줄과 같다. `shell`은 `electron`에서 import한다), log는 `ctx.log`.
   - `will-frame-navigate`와 `will-redirect`에 같은 함수: `decideShellNavigation({url: event.url, isMainFrame: event.isMainFrame})`가 allow가 아니면 `event.preventDefault()`, `external`이면 `void openExternalLink({open, log}, event.url)`. event type은 `artifact/electron-view.ts` 31줄의 `ElectronEvent & { url: string; isMainFrame: boolean }`를 따른다. `will-navigate`는 듣지 않는다. 주석 한 줄로 이유를 단다(main frame은 `will-frame-navigate`가 먼저 오고 거기서 막으면 `will-navigate`가 오지 않는다).
   - `setWindowOpenHandler((details) => …)`: `decideShellNavigation({url: details.url, isMainFrame: true})`가 `external`이면 같은 길로 열고, 늘 `{action: "deny"}`. ctrl·가운데 click이나 `target=_blank` link가 여기로 온다.
4. `window.ts`는 고칠 것이 없다. guard는 Electron webContents에 거는 일이라 `openWindow`(Electron 없는 factory)가 아니라 3의 wiring에 둔다. 고치지 않았으면 보고에 적는다.
5. `editor/markdown-pane.tsx`: `windowLinkOpener()`(`../desktop/settings/core-call.ts`)로 연다. 있으면 `<Markdown source={text} onOpenLink={(href) => void open(href)} />`, 없으면(gallery처럼 `lophnShell`이 없는 곳) 지금처럼 넘기지 않는다(근거: roadmap 1 "`Markdown`을 쓰는 곳은 `onOpenLink`로 `lophnShell.openExternal`을 넘긴다").
6. `navigation-guard_test.ts`: node:test(`node:test`, `node:assert/strict`)로 표 하나를 돈다. 본보기 `artifact/navigation_test.ts`.
   - 이름: `test("shell 창의 main frame은 lophn-shell://desktop 밖으로 가지 않고 http·https는 open-external로 넘긴다", …)`
   - 줄(main frame 결과): `lophn-shell://desktop/index.html`, `lophn-shell://desktop/index.html?mock#project=prj_…` → allow / `https://example.com/a?b#c`, `http://localhost:3000/` → external / `lophn-shell://overlay/index.html`, `lophn-app://x/index.html`, `lophn-artifact://a-0123456789abcdef01234567/index.html`, `file:///etc/passwd`, `data:text/html,<p>x</p>`, `blob:https://example.com/1`, `javascript:alert(1)`, `about:blank`, `mailto:a@example.com`, `not a url` → block. subframe 한 줄(`https://example.com/` → allow)로 subframe을 정하지 않는다는 것을 보인다.
   - shell main test는 `tools/check.ts`가 `git ls-files`로 찾는다. 새 file을 `git add`해야 `deno task check`의 "shell main test"가 돈다. 작업 중에는 `cd packages/shell/main && node --test --experimental-strip-types --no-warnings desktop/navigation-guard_test.ts`로 돌린다.

## 정한 것

- subframe은 정하지 않는다(늘 allow). 이유: README와 roadmap의 경계는 main frame이다. shell renderer에는 iframe이 없고(`grep -rn "<iframe" packages/shell/renderer` 0줄), 편집기의 pdf `<embed>`(`object-src blob:`)가 Chromium 안쪽 frame을 쓰므로 subframe을 막으면 pdf 보기가 깨질 수 있다. `<webview>` guest는 따로인 webContents라 이 guard에 오지 않는다.
- 사람 입력 검사(artifact view의 `activation.fresh`)를 두지 않는다. 이유: shell 창에서는 우리 renderer 코드만 돈다. `Markdown`은 raw HTML을 글로 그려 script가 없고, `<a href>`는 사람이 눌러야 이동한다.
- 파일이나 link를 창에 drop해 생긴 이동도 같은 규칙을 탄다(`file:`은 막히고 http/https는 OS browser로 열린다). 따로 다루지 않는다.
- `mailto:`는 막히고 열리지 않는다. `shell:open-external`이 http/https만 받는 지금 규칙을 넓히지 않는다.

## 끝남

- `deno task check`가 통과한다("shell main", "shell main test" 단계 포함).
- 위험 test: "shell 창의 main frame은 `lophn-shell://` 밖으로 가지 않고, `http`/`https`는 open-external로 넘어간다." (`navigation-guard_test.ts`의 표 하나)
- 들어감: `grep -n "will-frame-navigate\|setWindowOpenHandler" packages/shell/main/desktop/wiring/desktop-window.ts`가 2줄 이상, `grep -n "onOpenLink" packages/shell/renderer/editor/markdown-pane.tsx`가 1줄 이상이다.
- 남지 않음: 없음(지우는 이름이 없다).
- renderer를 고쳤으므로 `deno run -A packages/shell/renderer/build.ts`가 선다(`check:full`은 renderer build를 돌리지 않는다).
- 화면: 모양이 바뀌지 않는다. `deno task wireframes`가 서고 gallery `documents` 영역의 `MarkdownPane` page가 그대로 그려진다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: lead가 고칠 목록 file(`protocol/*/mod.ts`, core 조립 목록, wording 생성, gallery `pages/index.ts`, `deno.json`)
- 안 쓰게 된 export(남이 쓰던 것은 지우지 않는다)
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 넘길 줄: 남의 file을 최소로 맞춘 곳
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- **무겁게 짠 것**: 가장 단순한 구현(AGENTS.md "속도")보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것. 없으면 "없음"
