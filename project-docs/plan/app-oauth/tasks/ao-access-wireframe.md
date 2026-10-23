# ao-access-wireframe

앱 Access 탭의 secret 줄을 gallery Drafts에 그린다: OAuth가 없는 secret의 [Set value], OAuth secret의 client id·[Set client secret]·[Sign in]·상태와 실패 이유. 사람이 gallery를 보고 승인해야 화면 task(`ao-access-screen`)를 띄운다.

- 단위: ao-access (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `tools/wireframes/drafts/index.tsx`
  - `tools/wireframes/drafts/app-oauth/data.ts`(새 file)
  - `tools/wireframes/drafts/app-oauth/secret-rows.tsx`(새 file)
  - `tools/wireframes/drafts/app-oauth/secret-rows.module.css`(새 file)
  - `tools/wireframes/drafts/app-oauth/pages.tsx`(새 file)
  - `packages/design/wording/catalog/app-space.ts`
  - `packages/design/wording/catalog/app-space.placeholders.ts`
- 읽을 것:
  - skill: `.claude/skills/ui-design/SKILL.md`("모든 화면의 규칙", "새 화면 만들기", "함정"), `.claude/skills/wording/SKILL.md`
  - 계획: `project-docs/plan/app-oauth/README.md`의 "정한 것"의 화면, token, client
  - architecture: `project-docs/architecture/ui-kit.md`
  - 본보기(화면): `packages/shell/renderer/app-frame/app-detail/access/access-tab.tsx`(지금 Access 탭: 줄 모양, [Revoke]의 자리, `Pill`·`Mono`·`Section`·`Note`), `packages/shell/renderer/app-frame/app-detail/parts.tsx`, `packages/shell/renderer/app-frame/app-detail/app-detail.module.css`(`.item`, `.rowText`, `.rowTitle`, `.muted`, `.actions`), `tools/wireframes/pages/screens/app-space/space.tsx`와 `pages.tsx`(Access가 어떻게 그려지는지), `tools/wireframes/pages/screens/questions.tsx`의 `new-secret-input-app`(값 넣는 창은 이미 있다. 이 task가 그리지 않는다)
  - 부품: `packages/design/components/input/mod.ts`(`Field`, `Input`), `packages/design/components/primitives/mod.ts`(`Button`), `packages/design/components/feedback/mod.ts`(`StatusMark`)
- 계약:
  - 쓰는 것: 상태 이름은 `ao-contract`가 고정한 것과 같게 쓴다: `none`, `in_progress`, `signed_in`, `failed`와 이유 `callback_timeout`, `state_mismatch`, `exchange_failed`, `refresh_rejected`, `expired`, `store_failed`. protocol은 아직 없을 수 있으니 import하지 말고 `data.ts`에 같은 literal type을 둔다.
  - 내놓는 것: 사람이 보고 승인할 Drafts page 여섯과, `ao-access-screen`이 그대로 옮길 file 이름(`secret-rows.tsx`, `secret-rows.module.css`, `data.ts`)과 wording key.

## 그릴 것

한 줄(row)은 지금 Access 탭의 "Outside resources" 목록의 secret 줄이다. [Revoke]는 오른쪽 끝에 그대로 있다. 새 단추들도 규칙대로 오른쪽 끝 고정 열에 둔다. 토큰·값은 어디에도 보이지 않는다.

1. OAuth가 없는 secret: 이름(`Mono`), "Not set"/"Set" 상태, [Set value]/[Change value]. 값은 보호된 입력 창이 받는다(그 창은 그리지 않는다).
2. OAuth secret의 줄은 위에 더해 다음을 보인다:
   - 앱이 선언한 sign-in 곳: authorize host와 요청 scope(짧게. 예: "Sign in at accounts.google.com · drive.file"). 선언에서 오는 값이라 사람이 바꿀 수 없다.
   - client id: 글 입력(`Input`)과 [Save]. 저장된 뒤에는 값을 보이고 [Change].
   - client secret: "Not set"/"Set"과 [Set client secret]/[Change client secret](보호된 입력 창). secret은 선택이다(PKCE만 쓰는 서비스도 있다).
   - [Sign in]: client id가 없으면 꺼져 있고 이유 글이 줄 아래에 있다. 누르면 OS browser가 열린다는 안내를 한 줄 둔다.
   - 상태: `none` = "Not signed in", `in_progress` = "Waiting for you to finish in your browser" + [Cancel], `signed_in` = "Signed in" + [Sign in again], `failed` = 이유 글 + [Sign in again].
   - 실패 이유 글(영어, 사람 말, 안쪽 말 금지): callback_timeout "You didn't finish signing in in time.", state_mismatch "The sign-in response didn't match this request.", exchange_failed "The service rejected the sign-in.", refresh_rejected "The service ended the sign-in. Sign in again.", expired "The sign-in expired. Sign in again.", store_failed "lophn couldn't save the sign-in."
3. page 여섯(id는 주소라 이대로 쓴다):
   - `draft-app-access-secrets`: plain secret 둘(Not set, Set)과 OAuth 줄이 없는 상태.
   - `draft-app-access-oauth-setup`: client id 없음, client secret 없음, [Sign in] 꺼짐과 이유 글.
   - `draft-app-access-oauth-ready`: client id와 secret이 있고 `none`, [Sign in]이 켜짐.
   - `draft-app-access-oauth-waiting`: `in_progress`.
   - `draft-app-access-oauth-signed-in`: `signed_in`.
   - `draft-app-access-oauth-failed`: 줄 여섯(이유 하나씩)이 위아래로. 같은 앱에 OAuth secret이 여럿일 때 줄이 어떻게 쌓이는지도 보인다.

## 할 일

1. `data.ts`: 줄 하나의 고정 data type `SecretRowData`(`name`, `configured`, `oauth: null | { authorizeHost, scopes, clientId: string | null, clientSecretSet, state, reason }`)와 page마다의 고정 값. 상태를 이름 literal로 둔다.
2. `secret-rows.tsx`: `SecretRow`(plain·OAuth 둘 다)와 이를 감싼 Access 탭 모양(`Note` + `Section title`). 지금 `access-tab.tsx`의 목록·줄 class(`app-detail.module.css`)를 import해 같은 모양에서 시작하고, 새 모양만 `secret-rows.module.css`에 둔다. 색·간격은 token(var)만 쓴다. 단추와 입력은 design 부품(`Button`, `Input`, `Field`, `StatusMark`)이다. 새 design 부품은 만들지 않는다. 필요해 보이면 보고에 적는다.
3. `pages.tsx`와 `drafts/index.tsx`: 위 page 여섯을 `draftsArea.pages`에 `{ id, title(영어), description(한국어 한두 문장), render }`로 더한다. 인자 없이 한 상태를 그린다. gallery의 iframe 창 안에서 탭 본문 기둥(최대 폭, 가운데)으로 보이게 한다.
4. 문구는 모두 wording key로 쓴다(`tools/wireframes`의 직접 문구는 check-wording이 못 잡으니 스스로 지킨다). `catalog/app-space.ts`에 `app-detail.*` key를 더한다(예: `app-detail.button.set-value`, `app-detail.button.change-value`, `app-detail.button.set-client-secret`, `app-detail.button.sign-in`, `app-detail.button.sign-in-again`, `app-detail.button.cancel-sign-in`, `app-detail.label.client-id`, `app-detail.label.client-secret`, `app-detail.label.secret-set`, `app-detail.label.secret-not-set`, `app-detail.label.oauth-*`, 실패 이유 여섯 `app-detail.note.oauth-failed-*`). 이미 있는 key는 쓴다(`app-detail.button.cancel`, `app-detail.note.resource-secret`). `deno task wording`으로 placeholders를 만든다. 손으로 고치지 않는다.
5. `deno task wireframes`로 build하고 `index.html?frame=<id>`로 light·dark 둘 다 본다(ui-design "확인"). 규칙과 부딪히는 모양은 임의로 정하지 말고 보고에 질문으로 적는다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test: 없음.
- (화면) `deno task wireframes`가 되고, gallery Drafts에 위 page 여섯이 그려진다. 값·token 글자가 어느 page에도 없다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: lead가 고칠 목록 file(`protocol/*/mod.ts`, core 조립 목록, wording 생성, gallery `pages/index.ts`, `deno.json`)
- 안 쓰게 된 export(남이 쓰던 것은 지우지 않는다)
- 정한 것: 문서에 답이 없어 worker가 정한 것(줄 모양, 입력 자리, 문구)
- 넘길 줄: 남의 file을 최소로 맞춘 곳
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- 사람에게 물을 것: 모양을 정하지 못한 곳(예: client id 입력이 줄 안인가 펼침인가, OAuth 줄과 plain 줄을 같은 목록에 섞는가)
- **무겁게 짠 것**: 가장 단순한 구현(AGENTS.md "속도")보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것. 없으면 "없음"
