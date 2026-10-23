# ao-access-screen

승인된 wireframe(`ao-access-wireframe`의 Drafts)을 앱 Access 탭의 secret 줄로 옮긴다: plain secret은 [Set value], OAuth secret은 client id·[Set client secret]·[Sign in]·상태와 실패 이유. **사람이 gallery Drafts를 보고 승인하기 전에는 띄우지 않는다**(lead가 wireframe task가 끝나면 멈추고 승인을 받는다. 승인에서 바뀐 모양은 lead가 이 brief의 "승인에서 바뀐 것"에 적는다).

- 단위: ao-access (wave 3)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/shell/renderer/app-frame/app-detail/source.ts`
  - `packages/shell/renderer/app-frame/app-detail/core-source.ts`
  - `packages/shell/renderer/app-frame/app-detail/model.ts`
  - `packages/shell/renderer/app-frame/app-detail/app-detail.module.css`
  - `packages/shell/renderer/app-frame/app-detail/access/access-tab.tsx`
  - `packages/shell/renderer/app-frame/app-detail/access/secret-row.tsx`(새 file)
  - `packages/shell/renderer/app-frame/app-detail/access/secret-row.module.css`(새 file)
  - `packages/shell/renderer/app-frame/app-detail/testdata/fake-source.ts`
  - `packages/shell/main/desktop/core/allowlist.ts`
  - `packages/design/wording/catalog/app-space.ts`
  - `packages/design/wording/catalog/app-space.placeholders.ts`
  - `tools/wireframes/drafts/index.tsx`
  - `tools/wireframes/drafts/app-oauth/`(옮긴 뒤 지운다)
  - `tools/wireframes/pages/screens/app-space.tsx`
  - `tools/wireframes/pages/screens/app-space/pages.tsx`
  - `tools/wireframes/pages/screens/app-space/space.tsx`
- 읽을 것:
  - skill: `.claude/skills/ui-design/SKILL.md`(화면 규칙, "새 화면 만들기"), `.claude/skills/wording/SKILL.md`
  - 계획: `project-docs/plan/app-oauth/README.md`의 "정한 것"의 화면(sign-in은 사람이 연다, 화면은 상태를 다시 읽는다, 막히는 `complete`를 쓰지 않는다), client
  - architecture: `project-docs/architecture/ui-kit.md`
  - 계약: `packages/protocol/apps/oauth.ts`(route 넷, 상태·이유), `packages/protocol/apps/permissions.ts`(grant scope의 `oauth`), `packages/protocol/secrets/`의 `secretStatus`(`secrets/status`, 이미 allowlist에 있다)
  - 옮길 wireframe(보고 다시 그리지 않고 옮긴다):
    - `tools/wireframes/drafts/app-oauth/secret-rows.tsx` → `packages/shell/renderer/app-frame/app-detail/access/secret-row.tsx`
    - `tools/wireframes/drafts/app-oauth/secret-rows.module.css` → `.../access/secret-row.module.css`
    - `tools/wireframes/drafts/app-oauth/data.ts`의 고정 data → `.../testdata/fake-source.ts`의 fake secret 줄
    - `tools/wireframes/drafts/app-oauth/pages.tsx`의 page 여섯 → `tools/wireframes/pages/screens/app-space/pages.tsx`와 `app-space.tsx`의 Screens page(id는 `new-app-access-secrets`, `new-app-access-oauth-setup|ready|waiting|signed-in|failed`)
    - 박아 둔 글은 wireframe task가 `catalog/app-space.ts`에 이미 넣은 `app-detail.*` key를 쓴다. 모자란 key만 더한다.
  - 본보기(core 호출): `packages/shell/renderer/desktop/settings/providers/core-source.ts`(`signIn`: `loginBegin` → `openLink` → 폴링 → 취소. `connectWithKey`: `enterSecret`), `packages/shell/renderer/desktop/settings/core-call.ts`(`enterSecret`, `windowSecretInputOpener`, `windowLinkOpener`), 지금 Access 탭 `access-tab.tsx`와 `core-source.ts`의 `access()`(grant → `ResourceRow`)
- 계약:
  - 쓰는 것: 위 protocol route와 grant scope. `AppDetailSource`(`source.ts`)가 renderer 쪽 계약이고 이 task가 고친다(이 task만 쓰는 곳이다).
  - 내놓는 것: 없음.

## 할 일

1. `source.ts`: `ResourceRow`(kind `secret`)에 `secret: { configured: boolean; oauth: null | { authorizeHost: string; tokenHost: string; scopes: readonly string[]; clientId: string | null; clientSecretSet: boolean; state: "none" | "in_progress" | "signed_in" | "failed"; reason: ... | null } }`를 더하고, `AppDetailSource`에 동작을 더한다: `setSecretValue(name, subject)`(보호된 입력 창, `"stored" | "cancelled"`), `setOAuthClientId(app, name, clientId)`, `setOAuthClientSecret(app, name, subject)`(이름은 `appOAuthNames(name).client`), `signIn(app, name)`(`oauth_begin` → 받은 URL을 `windowLinkOpener()`로 연다. 열 곳이 없거나 열기가 실패하면 `oauth_cancel`로 닫고 `unavailable`), `cancelSignIn(app, name)`. 화면은 `signIn` 뒤 `source.access(app)`를 다시 읽는다.
2. `core-source.ts`: `coreAppDetailSource(core, deps?)`가 `openSecret`·`openLink`를 `"openSecret" in deps ? deps.openSecret : windowSecretInputOpener()` 꼴로 받는다(providers의 `coreProviderSettingsSource`와 같은 꼴. `desktop/entry.tsx`는 고치지 않는다). `access(app)`: `secret.use` grant마다 `secrets/status`(`names`)로 `configured`를, grant scope에 `oauth`가 있으면 `apps/oauth_state`(`app`)로 줄을 채운다. host는 scope의 두 끝점에서 `new URL(...).host`로 뽑는다. 경로 안에 token·값이 없다.
3. `access/secret-row.tsx`·`.module.css`: wireframe 코드를 옮긴다. `AccessTab`의 Outside resources 목록에서 `kind === "secret"` 줄이 이 component를 쓴다(다른 kind와 [Revoke] 흐름은 그대로). 값이 없다는 안내 `app-detail.note.resource-secret`는 그대로 둔다.
4. `access-tab.tsx`: 줄의 동작을 `source`에 잇는다. [Set value]·[Set client secret]은 `stored`가 오면 `read.reload()`, `cancelled`면 아무 일 없음. [Sign in]은 누르면 `signIn`을 부르고 `in_progress`가 있는 동안 지금 `pollMs`(Access 탭은 거두기를 보려고 폴링하는 구조가 이미 있다)로 `access()`를 다시 읽는다(약 2초). 실패(`signIn` 실패, 열기 실패)는 탭 위쪽 `PaneToast`로 알린다(색 띠를 쓰지 않는다). 화면에서 token·secret 값을 만지지 않는다.
5. `model.ts`: 상태·이유를 사람 말 wording key로 잇는 순수 함수(안쪽 값을 화면에 보이지 않는다).
6. `testdata/fake-source.ts`: wireframe의 여섯 상태를 만드는 옵션(`fakeDetail({ ... })`)을 더하고 동작들은 `calls`에 기록한다(기존 `access`·`revoke`의 꼴). 기존 호출처(`dev-mock/app-space.ts`)가 옵션 없이 부르는 대로 돌아야 한다.
7. `allowlist.ts`: `RENDERER_MEMORY_ROUTES`에 `memory:apps/oauth_client_set`, `oauth_begin`, `oauth_cancel`, `oauth_state`를 더하고 머리 주석에 한 줄 덧붙인다. 빠뜨리면 화면이 늘 거절된다.
8. gallery: 옮긴 page 여섯을 Screens의 앱 공간 영역에 올리고(`pages/screens/app-space.tsx`, `app-space/pages.tsx`, `app-space/space.tsx`가 fake source 옵션으로 상태를 건다) Drafts의 같은 page와 `tools/wireframes/drafts/app-oauth/`를 지운다. `drafts/index.tsx`의 `pages`는 다시 빈 목록이다.
9. wording: 모자란 key만 `catalog/app-space.ts`에 더하고 `deno task wording`을 돌린다. 안쪽 말(`token`, `grant`, `secret_value` 등)이 값에 없다.
10. `deno run -A packages/shell/renderer/build.ts`로 renderer bundle이 서는지 본다. 앱에서만 깨지는 것(CSP `style-src`, 창 끌기 영역)은 ui-design "함정"을 본다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test: 없음(화면·문구는 test하지 않는다).
- 남지 않음: `grep -rn "app-oauth" tools/wireframes/drafts`가 0줄이다(Drafts에서 옮겼다).
- (화면) `deno task wireframes`가 되고, gallery Screens의 `new-app-access-secrets`, `new-app-access-oauth-*`가 옮긴 component로 그려진다. 값·token 글자가 어느 page에도 없다.
- `deno run -A packages/shell/renderer/build.ts`가 통과한다.

## 승인에서 바뀐 것

(lead가 wireframe 승인 때 사람이 바꾼 모양을 여기 적는다. 없으면 비워 둔다.)

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: lead가 고칠 목록 file(`protocol/*/mod.ts`, core 조립 목록, wording 생성, gallery `pages/index.ts`, `deno.json`)
- 안 쓰게 된 export(남이 쓰던 것은 지우지 않는다)
- 정한 것: 문서에 답이 없어 worker가 정한 것(폴링 간격, 열기 실패 처리)
- 넘길 줄: 남의 file을 최소로 맞춘 곳
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- **무겁게 짠 것**: 가장 단순한 구현(AGENTS.md "속도")보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것(예: sign-out 단추 없음). 없으면 "없음"
