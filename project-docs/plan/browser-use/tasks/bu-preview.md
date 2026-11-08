# bu-preview

앱 preview를 탭 kind `app_preview`로 띄우고, `lophn tab open --preview <app>`으로 그 앱 workspace의 agent session과 사람 token이 연다. preview 탭에서 보낸 annotation은 release 대신 preview의 bundle hash를 싣는다.

- 단위: bu-preview (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/protocol/lophn-agent/host-queue.ts`
  - `packages/core/host-queue/{queue,queue_test}.ts`
  - `packages/core/main/daemon/wiring/host-queue.ts`
  - `packages/cli/commands/tab.ts`
  - `packages/cli/commands/preview.ts`(추가 소유: `preview start`가 ready 뒤 탭을 여는 곳만)
  - `packages/shell/renderer/workspace/{app-screen-tab.tsx,app-screen-tab.module.css}`(추가 소유: [Preview] 버튼만)
  - `packages/shell/renderer/workspace/use-surface-requests.ts`
  - `packages/shell/renderer/workspace/kinds/app-preview.tsx`(새로), `packages/shell/renderer/workspace/kinds/registry.ts`
  - `packages/shell/renderer/workspace/{app-preview-tab.tsx,app-preview-tab.module.css}`(새로)
  - `packages/shell/main/workspace/kinds/`(main이 이 kind를 알아야 할 때만)
  - `packages/shell/main/app-frame/{annotate,annotate_test}.ts`, `packages/shell/ipc/annotation.ts`
  - `packages/protocol/apps/annotation.ts`
  - `packages/core/apps/annotations/`
  - `packages/protocol/lophn-agent/input-tags.ts`(annotation 속성 하나만)
  - `packages/design/i18n/catalog/app-space.ts`
  - `tools/wireframes/pages/screens/app-space/`(preview 탭 page)
- 읽을 것:
  - 계획: `project-docs/plan/browser-use/README.md`, `project-docs/products/roadmap/browser-use.md`("무엇을 만드나" 1, "정한 것" 5·6), `project-docs/products/roadmap/app-preview.md`("무엇을 만드나" 1·3, 정한 것(agent))
  - architecture: `project-docs/architecture/{workspace-layout,app-call,annotation}.md`
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `host-queue-interface`, `host-queue-core`, `coding-agent-cli-interface`. `project-docs/module-catalog.yaml`의 `packages/core/host-queue`
  - 본보기(화면): `packages/shell/renderer/workspace/kinds/app-screen.tsx`, `packages/shell/renderer/workspace/app-screen-tab.tsx`(앱 view를 탭에 거는 법), `tools/wireframes/pages/screens/app-space/`
  - 본보기(preview 규칙): `packages/cli/commands/preview.ts`(앱 workspace만), `packages/core/apps/preview/service.ts`(`gate`, `current`), `packages/shell/main/app-frame/app-connection.ts`(`currentPreview`)
  - skill: `ui-design`, `write-test`
- 계약:
  - 쓰는 것: `packages/shell/ipc/app-frame.ts`의 `appViewOpenSchema`(`mode: "preview"`, release는 null일 수 있다), `previews.get|stop` route, `ctx.appsControl.previews.current(app)`
  - 내놓는 것:
    - `hostTabTargetSchema`에 `{ preview: { app: AppId } }`를 더한다. `bu-device`가 여기에 `device`를 더한다.
    - 탭 표의 주인: `TabEntry.opener: Id<"ses"> | null`을 `owner: Id<"ses"> | "person"`으로 바꾼다. kind는 `"agent" | "browser" | "preview"`. `owned(tab, caller)`의 caller도 `Id<"ses"> | "person"`이다. 사람 token(actor `user`) 호출은 모두 같은 주인 `"person"`이다.
    - `tabsOpen`·`tabsClose`의 actors는 `["agent", "user"]`. `browserRead`는 그대로(`bu-call`이 연다).
    - renderer 탭 key는 지금처럼 `host:<tab id>`, kind `app_preview`, 값 `{ app }`.
    - annotation item에 `preview_bundle: sha256 | null`을 더한다(아래 할 일 6).

## 할 일

1. protocol `host-queue.ts`: preview target을 더하고, `tabsOpen`·`tabsClose`의 actors에 `user`를 더하고 주석을 고친다. 요청 `tab_open`의 workspace는 preview면 `{kind: "app", id: <app>}`이다.
2. core `queue.ts`: 주인을 `owner`로 바꾸고 kind `preview`를 더한다. `read()`는 browser 탭만 답한다(preview는 `not_found`, 지금과 같다).
3. core wiring `host-queue.ts` open·close:
   - caller: actor `agent`이고 `conditions.session`이 있으면 그 session, actor `user`면 `"person"`, 그 밖은 `forbidden`.
   - preview target: agent는 그 session의 workspace가 `{kind: "app", id: <그 app>}`일 때만 연다. 아니면 `not_found`(남의 앱을 알리지 않는다). 사람은 아무 앱이나 연다. 앱이 없으면 `not_found`. `ctx.appsControl.previews.current(app)`가 null이면 `conflict`("no preview is running; run preview start first").
   - 사람 token은 이 task에서 `--preview`만 연다. `--session`·`--tui`·`--url`은 `invalid_input`("a person token opens --preview tabs")이다. `--url`은 `bu-call`이 연다.
   - close: 주인만 닫는다(남이면 `forbidden`, 지금과 같다).
4. CLI `tab.ts`: `--preview <app>`을 더한다(`--session`·`--url`·`--preview` 가운데 정확히 하나). help 문구에 preview가 그 앱 workspace session과 사람만 열 수 있고 돌고 있는 preview가 없으면 `conflict`라는 것, 사람 token에서 부를 수 있는 것을 적는다. 첫 줄 주석의 "binary(사람)에서는 forbidden"을 고친다.
5. renderer:
   - `use-surface-requests.ts`가 `preview` target이면 `app_preview` 탭을 `host:<tab>` key로 연다.
   - kind `app_preview`: layout에 저장하지 않는다(`toStored`가 null, 되살리지 않음). 앱 view를 `mode: "preview"`, `release`는 지금 preview의 release(없으면 null)로 연다. 탭 위 안내 줄 한 줄(preview, fixture data, 바깥 연결은 대역)과 [Stop](`previews.stop`). preview가 멈추거나 없으면 view 대신 "돌고 있는 preview 없음"을 보인다. 다시 start되면 같은 탭이 새 preview를 load한다(`app-preview.md` 정한 것).
   - 앱 live 화면(`app_screen`, `app_panel`, 카드)은 고치지 않는다.
   - gallery: `tools/wireframes/pages/screens/app-space/`에 preview 탭(돌 때, 멈춘 뒤) page를 더하고 renderer가 같은 component를 쓰게 한다(`ui-design`). 글은 `app-space.ts` catalog.
6. preview annotation (`annotation.md`, `app-preview.md` 3):
   - `annotationInputSchema`와 저장 꼴에 `preview_bundle: sha256Schema.nullable()`을 더한다. app target은 `release !== null || preview_bundle !== null`이고 screen이 있다. 그 밖 target은 둘 다 null이다.
   - 저장 표는 ledger라 `packages/core/apps/annotations/schema.ts`에 새 schema step(새 id)으로 칸을 더한다. 이미 낸 step의 SQL은 고치지 않는다(AGENTS.md 호환성).
   - shell `annotate.ts`: preview view(mode preview)면 그 view의 bundle hash를 싣고, release가 null이어도 거절하지 않는다. live view는 지금처럼 release를 요구한다.
   - 받는 쪽 메시지: annotation tag 속성에 `preview`(bundle hash)를 더한다(`INPUT_TAG_ATTRIBUTES.annotation`). 메시지 본문의 release 줄은 preview와 bundle hash를 적는다.

## lead가 더함 (planner, 2026-11-09: `app-preview.md` 정한 것(사람)을 살림)

7. 저절로 열기: `lophn preview start`가 preview의 ready를 본 뒤(지금 명령이 `previews.get`로 기다리는 끝) 같은 자격으로 `tabs/open {target: {preview: {app}}}`를 부른다. 새 통로나 core event를 만들지 않는다. 주인은 부른 쪽(agent session, 사람 token이면 `"person"`)이라 그 agent가 바로 그 탭을 다룬다. 명령 `routes`에 `tabsOpen`을 더한다. 탭 열기가 실패해도(`unavailable` 등) preview start는 성공으로 끝내고 `note`에 적는다. 결과에 탭 id를 싣는다.
8. 같은 앱의 preview 탭은 하나다(`app-preview.md` 정한 것(agent)):
   - core: 표에 그 앱의 preview 탭이 이미 있으면 새로 넣지 않고 그 탭 id를 돌려주며 주인을 새 caller로 바꾼다. 탭은 이미 지금 preview를 따라간다.
   - renderer: `tab_open`의 preview 탭이 올 때 그 창에 같은 앱의 `app_preview` 탭(사람이 [Preview]로 연 것)이 있으면 그것을 닫고 그 자리에 `host:<tab>` 탭을 연다.
9. [Preview] 버튼: 앱 화면 탭(`app-screen-tab.tsx`) toolbar에 둔다. 그 앱에 돌고 있는 preview가 있을 때만 보인다(`previews.get`). 누르면 사람이 연 `app_preview` 탭(key `app-preview:<app>`, host 표에 없다)을 연다. 이 탭은 agent가 다루지 못한다(roadmap 정한 것 5). gallery page에 버튼을 더한다.

## 끝남

- `npm run check`가 통과한다.
- 위험 test:
  - "다른 앱이나 project·home workspace의 agent session이 `tab open --preview <app>`을 부르면 `not_found`이고 탭 표에 아무것도 남지 않는다. 그 앱 workspace session과 사람 token은 연다"(`packages/core/host-queue` 또는 wiring test)
  - "사람 token은 agent session이 연 탭을 닫지 못하고(`forbidden`), agent session도 사람이 연 탭을 닫지 못한다"
  - "preview가 없는 앱의 `tab open --preview`는 `conflict`다"
  - "같은 앱에 preview 탭을 두 번 열면 탭 표에 하나만 있고 주인은 나중 caller다"
  - "새 schema step이 옛 annotation 행을 `preview_bundle` null로 남긴다"(ledger migration)
- 남지 않음: `grep -rn "opener" packages/core/host-queue packages/core/main/daemon/wiring/host-queue.ts`가 0줄. `grep -rn "binary(사람)에서는 forbidden" packages/cli`가 0줄.
- (화면) `npm run wireframes`가 되고 gallery의 preview 탭 page가 renderer와 같은 component로 그려진다.
- 진짜 Electron에서 한 번 연다: dev core에서 앱 하나의 preview를 띄우고 `lophn tab open --preview <app>`으로 탭이 뜨고 앱 화면이 그려지는 것, [Stop] 뒤 "돌고 있는 preview 없음"을 본다(`run` skill의 Electron 길, headless + `--remote-debugging-port` screenshot). 못 돌렸으면 보고에 "진짜 Electron에서 안 돌림"이라고 쓴다.

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
