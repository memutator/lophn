# bt-tab-kind

탭 kind `browser`를 main(layout schema, 복원)과 renderer(registry, 탭 줄, `keep()`)에 올리고 새 탭(+) menu에 Browser를 더한다. 다시 열면 같은 URL을 load한다. title과 history는 저장하지 않는다.

- 단위: bt-tab (wave 2)
- 선행: bt-tab-page
- 소유(이 task만 고친다):
  - `packages/shell/main/workspace/kinds/browser.ts`
  - `packages/shell/main/workspace/kinds/registry.ts`
  - `packages/shell/renderer/workspace/kinds/browser.tsx`
  - `packages/shell/renderer/workspace/kinds/registry.ts`
  - `packages/shell/renderer/workspace/add-tab-menu.tsx`
  - `packages/shell/renderer/workspace/workspace.tsx`
  - `packages/design/wording/catalog/browser.ts`
  - `packages/design/wording/catalog/browser.placeholders.ts`
- 읽을 것:
  - 계획: `project-docs/plan/browser-tab/README.md`
  - 제품 결정: `project-docs/products/roadmap/browser-tab.md`의 "무엇을 만드나" 1(kind, 열기)
  - 본보기(kind): `packages/shell/main/workspace/kinds/app-panel.ts`·`kind.ts`·`values.ts`(`tabKey`), `packages/shell/renderer/workspace/kinds/app-panel.tsx`(`keep`, `openAppPanel`), `kinds/terminal.tsx`(`openTerminal`), `kinds/kind.ts`(`TabKindDef`), `kinds/host.ts`(`TabHost.openTab`, `patchTab`)
  - 본보기(새 탭 menu): `packages/shell/renderer/workspace/add-tab-menu.tsx`, `workspace.tsx`의 `<NewTabMenu …>`(handler가 있는 항목만 준다)
  - 이 task가 쓰는 것: bt-tab-page(`BrowserTab`, `useBrowserApi`, `browserIcons`)
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `shell`, `project-docs/module-catalog.yaml`의 `packages/shell/main`, `packages/shell/renderer`
- 계약:
  - 쓰는 것: `BrowserTab`의 props(`url`, `shown`, `onState`).
  - 내놓는 것: `kinds/browser.tsx`의 `openBrowserTab(host: TabHost, url?: string): void`(빈 url이면 빈 주소 칸으로 열고 선택한다. 다른 task가 새 탭으로 bookmark를 열 때 쓴다), `browserKind: TabKindDef`.

## 할 일

1. `main/workspace/kinds/browser.ts`: `defineTabKind`로 `kind: "browser"`, layout `z.strictObject({ kind: z.literal("browser"), key: tabKey, url: z.string().max(8192) })`(빈 글 허용). `restore`는 항상 `{ kind: "tab", tab }`이다(주소는 browser view가 load할 때 검사한다). `main/workspace/kinds/registry.ts`의 `BUILT_IN_TAB_KINDS`에 한 줄.
2. `renderer/workspace/kinds/browser.tsx`: `browserKind`.
   - `labelKey: "browser.label.kind"`, `icon: browserIcons.globe`.
   - `fromStored(stored, { key })`: `url`이 문자열이고 8192자 이하일 때만 `{ key, kind: "browser", title: "", fields: { url } }`. 아니면 null. `toStored(tab)`: `{ kind: "browser", key, url }`만 쓴다(`fields`의 다른 값은 저장하지 않는다).
   - `keep(tab, shown, host)`: `<BrowserTab url={fields.url} shown={shown} onState={…} />`. `onState({ url, title })`는 `host.patchTab(tab.key, (current) => ({ title: title || host 이름 || 종류 이름, fields: { ...current.fields, url } }), { later: true })`다. 탭 이름은 page title, 없으면 url의 host, 그것도 없으면(빈 주소 칸) `browser.label.kind`다.
   - `render`는 두지 않는다(`keep`만 쓴다. 다른 탭으로 가도 page가 살아 있다).
   - `openBrowserTab`: 탭 key `browser-${Date.now().toString(36)}-${++count}`, `host.openTab({ key, kind: "browser", title: 위 이름 규칙, fields: { url: url ?? "" } })`.
   - `renderer/workspace/kinds/registry.ts`의 목록에 한 줄.
3. `add-tab-menu.tsx`: `onBrowser?: () => void` prop과 항목 `id: "browser"`(label `browser.label.menu-browser`, icon `browserIcons.globe`)를 Terminal 바로 뒤에 더한다. `workspace.tsx`: `useBrowserApi()`가 null이 아닐 때만 `onBrowser: () => openBrowserTab(host)`를 `NewTabMenu`에 준다.
4. wording: `catalog/browser.ts`에 이 task가 쓰는 key가 새로 필요하면 더하고 `deno task wording`.

## 정한 것

- 새 탭 menu의 Browser는 Terminal 바로 뒤에 둔다. roadmap이 자리를 정하지 않았고, 자주 쓰는 것을 앞에 두려는 것이다.
- `BrowserTab`의 `url` prop은 처음 열 때만 쓰이므로, `onState`가 `fields.url`을 저장해도 view를 다시 열지 않는다(`bt-tab-page` 계약). 이 task에서 effect 의존에 `tab.fields.url`을 넣어 무한 reload가 생기지 않게 한다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test: 없음. layout schema(zod strict)가 보장하는 것은 test하지 않는다.
- 남지 않음: 없음.
- 손으로 본다: `deno task dev:mock`에서 새 탭 menu에 Browser가 있고 열면 탭과 toolbar가 뜨며, 닫았다 `Ctrl+Shift+T`로 다시 열면 같은 탭이 돌아온다(`noReopen`을 쓰지 않는다. 다시 열면 같은 URL을 load한다).

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: wording 생성(`deno task wording`을 돌렸다)
- 안 쓰게 된 export: 없음
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 넘길 줄: `renderer/workspace/workspace.tsx`(`NewTabMenu`에 handler 한 줄)
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- **무겁게 짠 것**: 없으면 "없음"
- **알려진 미완 동작**: 없으면 "없음"
