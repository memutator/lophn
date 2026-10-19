# af-sandbox

봉한 scheme `lophn-artifact://`와 partition `persist:lophn-artifact`를 만든다. rea `sandbox.js`를 TS로 옮기고, root마다 host를 달리해 root 밖 file을 못 읽게 path 해석을 가둔다. view(WebContentsView)는 이 task에 없다(wave 2 `af-artifact-view`).

- 단위: artifact-sandbox (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/shell/main/artifact/paths.ts`
  - `packages/shell/main/artifact/paths_test.ts`
  - `packages/shell/main/artifact/serve.ts`
  - `packages/shell/main/artifact/entries.ts`
  - `packages/shell/main/artifact/roots.ts`
  - `packages/shell/main/artifact/session.ts`
  - `packages/shell/main/artifact/electron-session.ts`
  - `packages/shell/main/artifact/theme-css.ts`
  - `packages/shell/main/desktop/security.ts`
  - `packages/shell/main/desktop/wiring/appearance.ts`
- 읽을 것:
  - rea: `../rea/project/desktop-embeded-browser/src/main/sandbox.js`(148줄, 세 겹 장벽 + `createSandboxedSession`), `src/main/sandbox-paths.js`(`DEFAULT_CSP`, `resolveInsideRoot`, `contentTypeFor`). 이 file들이 없으면 보고에 적고 아래 설명대로 짠다.
  - 제품 결정: `project-docs/products/roadmap/artifact.md`의 "2. artifact 탭"의 "봉한 partition"과 "appearance CSS", "정한 것 (agent)"의 CSP·`_entries.json`
  - architecture: `project-docs/architecture/appearance.md`(흐름 4: `lophn-shell:`·`lophn-app:` 문서에만 insertCSS), `project-docs/architecture/browser-tab.md`("지키는 것"의 navigation·permission·download)
  - 본보기: `packages/shell/main/browser/session.ts`(`BrowserSessionHandle` + `installBrowserSession`, 순수 정책 + Electron adapter 분리), `browser/electron-session.ts`, `browser/permission_test.ts`, `desktop/shell-protocol.ts`(`safeJoin`, scheme CSP), `main/browser/bookmarks_test.ts`(node:test + 임시 폴더)
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `shell`, `project-docs/module-catalog.yaml`의 `packages/shell/main`
- 계약:
  - 쓰는 것: `packages/design/flatten.ts`의 `flatten()`과 `packages/design/tokens.ts`의 `tokens`(token을 CSS 변수로 만드는 재료), `packages/design/appearance.ts`의 `appearanceCss`(이미 wiring/appearance.ts가 쓴다)
  - 내놓는 것(wave 2 `af-artifact-view`가 import한다)
    - `session.ts`: `ARTIFACT_SCHEME = "lophn-artifact"`, `ARTIFACT_PARTITION = "persist:lophn-artifact"`, `sealArtifactSession(handle: ArtifactSessionHandle, serve): Promise<void>`(봉하지 못하면 던진다), `interface ArtifactSessionHandle`
    - `electron-session.ts`: `electronArtifactSession(): ArtifactSessionHandle`
    - `roots.ts`: `createArtifactRoots(): { register(realRoot: string): string; rootOf(host: string): string | undefined }` — `register`는 root의 realpath를 받아 host label을 낸다(`a-` + sha256(realRoot) 앞 24자 hex. 같은 root면 늘 같은 host라 localStorage가 이어지고 root가 다르면 origin이 다르다)
    - `serve.ts`: `createArtifactServer(deps): (request: Request) => Promise<Response>`
    - `paths.ts`: `resolveInsideRoot`, `ARTIFACT_MAX_BYTES`(4 MiB)

## 할 일

1. `paths.ts`(Electron 없는 순수 + node:fs): `resolveInsideRoot(root, urlPath)`. `root`는 호출하는 쪽이 realpath한 값이다.
   - `decodeURIComponent` 실패, NUL, 역슬래시, `..` 마디는 null. 앞의 `/`는 모두 떼고 root에 붙인다(절대 path처럼 보이는 요청도 root 안 path가 될 뿐이다).
   - 어휘 검사(`path.resolve` 결과가 `root + sep`로 시작) 뒤 `realpath`도 `root + sep` 안이어야 한다. 접두사만 같은 형제 폴더(`/x/art-evil`)는 밖이다(`root`에 `sep`를 붙여 비교한다).
   - 결과는 `{ absolute, relative }`. 없는 file은 null이다.
2. `serve.ts`: `createArtifactServer({ rootOf, maxBytes, csp, now })`가 `Request`를 받아 `Response`를 낸다. GET·HEAD만 받고 나머지는 405.
   - host로 root를 찾는다(없으면 404). 경로가 비었거나 `/`로 끝나면 `index.html`을 붙인다.
   - `data/_entries.json`은 가상 file이다(`entries.ts`). 디스크에 같은 이름이 있어도 가상이 이긴다.
   - 그 밖은 `resolveInsideRoot` → `open(O_RDONLY | O_NOFOLLOW)` → `fstat`이 일반 file이고 크기가 `maxBytes` 이하일 때만 byte를 준다. 아니면 404.
   - 응답 header: `content-type`(rea `CONTENT_TYPES` 표를 옮긴다. `.js`·`.mjs`는 `text/javascript; charset=utf-8`), `cache-control: no-store`, `x-dns-prefetch-control: off`, `content-security-policy`. 404도 `default-src 'none'` CSP를 단다.
   - CSP 문자열은 이 file의 상수 하나다. rea `DEFAULT_CSP`에서 `connect-src 'none'`만 `connect-src 'self'`로 바꾼다(template이 자기 `data/`를 fetch해야 갈아끼우기와 series가 된다).
3. `entries.ts`: `listDataEntries(root, fs)`가 `<root>/data/`의 바로 아래 일반 file만(하위 폴더·symlink는 `lstat`로 건너뛴다. 밖으로 가는 symlink의 이름·크기가 새면 안 된다) `[{ "name", "size", "modified" }]`(`modified`는 ISO 문자열, 이름 순)로 JSON을 만든다. `_entries.json` 자신은 뺀다. `data/`가 없으면 `[]`다.
4. `roots.ts`: 위 계약대로.
5. `session.ts`: `ArtifactSessionHandle`은 `denyPermissions()`(request·check·device handler 모두 거절), `onDownload(listener)`, `setProxy(rules)`, `probe(url): Promise<boolean>`(요청이 성공하면 true), `handleProtocol(scheme, handler)`. `sealArtifactSession`은 순서대로 permission 거절 → download `preventDefault` → proxy를 죽은 주소 `http://255.255.255.255:9`(고정 서버)로 → `probe("https://127.0.0.1/")`가 성공하면 던진다(rea의 `verifyNetworkSealed`는 3초 timeout) → `handleProtocol(ARTIFACT_SCHEME, serve)`. 한 handle에 한 번만 부른다.
6. `electron-session.ts`: `session.fromPartition(ARTIFACT_PARTITION)`에 잇는 adapter(`browser/electron-session.ts` 꼴). `probe`는 `session.fetch(url, { method: "HEAD", credentials: "omit", redirect: "error", cache: "no-store", signal: AbortSignal.timeout(3000) })`.
7. `theme-css.ts`: `artifactDocumentCss(appearance: string): string`. artifact 문서에는 `tokens.css`가 없으므로 token 정의 전체(`:root` light, `[data-theme="dark"]`, `@media (prefers-color-scheme: dark)`)를 `flatten()`으로 만들어 `appearance`(= `appearanceCss(...)` 결과, 빈 글일 수 있다) 앞에 붙인다. 글꼴 파일은 싣지 않는다(font token은 system-ui로 떨어진다).
   - `packages/design/generate.ts`의 `renderCss`와 같은 모양이지만 그 file은 top-level await가 있어 main(CJS)에서 import하지 못한다. 중복이 작아 design은 고치지 않고, 줄이려면 `renderCss`를 import 가능한 file로 옮기자고 "계약 바꾸기 요청"에 적는다.
8. `desktop/security.ts`: `VIEW_SCHEMES`에 `"lophn-artifact"`를 더한다(standard·secure·supportFetchAPI가 같이 붙는다. fetch가 되어야 `connect-src 'self'`가 쓸모 있다).
9. `desktop/wiring/appearance.ts`: `LOPHN_DOCUMENT` 정규식에 `artifact`를 더한다. `apply`는 `lophn-artifact://` 문서에는 `css`가 빈 글이어도 `artifactDocumentCss(css)`를 insertCSS한다(base token이 필요하다). 값이 바뀌면 옛 key를 지우고 다시 넣는 길은 그대로다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test(`paths_test.ts`, node:test, 임시 폴더, 표로 돌린다. `write-test` skill)
  - "봉한 scheme의 path 해석이 `..`, `%2e%2e`, 절대 path, root 밖을 가리키는 symlink(file·폴더), root와 접두사만 같은 형제 폴더로 가는 symlink, 폴더, 크기 상한을 넘는 file을 거절하고 root 안 file과 root 안으로 가는 symlink는 준다"
  - "`_entries.json`이 밖으로 가는 symlink와 하위 폴더를 목록에 싣지 않는다"
  - 이 둘이 전부다. CSP 문자열이나 header 값은 test하지 않는다.
- Electron을 띄워 죽은 proxy가 실제로 막는지 보는 check는 이 task에서 만들지 않는다. 필요하면 lead가 사람에게 먼저 묻는다(AGENTS.md). `sealArtifactSession`의 시작 때 검증이 런타임 방어다.
- 남지 않음: 이 task가 만든 이름만 있어 옛 이름은 없다. `grep -rn "lophn-artifact" packages`가 `artifact/session.ts`, `security.ts`, `wiring/appearance.ts`의 정규식 밖에서는 `ARTIFACT_SCHEME` 상수로만 나온다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: 없음(`desktop/main.ts`는 `af-artifact-view`가 연결한다)
- 안 쓰게 된 export: 없음
- 정한 것: 크기 상한 4 MiB, host label 규칙, 디렉터리 요청에 `index.html`을 붙이는 것, 가상 `_entries.json` 모양
- 넘길 줄: `desktop/security.ts`와 `wiring/appearance.ts`는 다른 계획도 건드린다(한 줄씩이다)
- 계약 바꾸기 요청: design의 `renderCss` import 가능 여부
- **무겁게 짠 것**: 없으면 "없음"
- **알려진 미완 동작**: Electron에서 죽은 proxy가 막는지는 확인하지 않았다(사람에게 묻기 전). 없으면 "없음"
