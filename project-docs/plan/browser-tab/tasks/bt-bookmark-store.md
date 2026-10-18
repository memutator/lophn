# bt-bookmark-store

bookmark를 `<dataRoot>/shell/bookmarks.json` 파일 하나에 저장하는 main 쪽 store를 만든다. 쓰기는 `layout-store.ts`의 atomic write를 함수로 나눠 같이 쓴다. 파일이 깨져 있으면 어떤 쓰기도 그 파일을 덮어쓰지 않는다(사람이 모은 목록을 잃지 않으려는 것이다).

- 단위: bt-bookmark (wave 2)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/shell/main/workspace/atomic-file.ts`
  - `packages/shell/main/workspace/layout-store.ts`
  - `packages/shell/main/browser/bookmarks.ts`
  - `packages/shell/main/browser/bookmarks_test.ts`
- 읽을 것:
  - 계획: `project-docs/plan/browser-tab/README.md`("정한 것": atomic write를 나눠 같이 쓴다)
  - 제품 결정: `project-docs/products/roadmap/browser-tab.md`의 "무엇을 만드나" 5(저장)와 "정한 것"의 bookmark 셋
  - 본보기: `packages/shell/main/workspace/layout-store.ts`(`createLayoutStore`의 `write`: temp 파일 뒤 rename, 폴더 0700·파일 0600, `StoreDeps`, `StoreError`), `packages/shell/main/app-frame/external-link.ts`의 `checkExternalUrl`(http/https, userinfo 없음)
  - test 꼴: `packages/shell/main/app-frame/app-call_test.ts`(`node:test`), `packages/shell/main/editor/file-adapter_test.ts`(임시 폴더를 쓰는 test가 있으면 그 꼴)
  - test 기준: `.claude/skills/write-test/SKILL.md`
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `shell`, `project-docs/module-catalog.yaml`의 `packages/shell/main`
- 계약:
  - 쓰는 것: 없음.
  - 내놓는 것(`bt-bookmark-ipc`가 쓴다):
    - `atomic-file.ts`: `writeFileAtomic(file: string, content: string, deps?: Partial<StoreDeps>): Promise<StoreResult<null>>`와 `StoreDeps`, `StoreResult`, `StoreError`(지금 `layout-store.ts`가 가진 것을 옮긴다). `layout-store.ts`는 이것을 불러 쓰고 `createLayoutStore`의 모양(`read`, `write`, `deps` 주입)은 바뀌지 않는다.
    - `bookmarks.ts`
      - `type Bookmark = { id: string; title: string; url: string; created_at: string }`
      - `type BookmarkReason = "url" | "title" | "duplicate" | "limit" | "corrupt" | "missing" | "unreadable" | "unwritable"`
      - `type BookmarkList = { state: "ok"; bookmarks: Bookmark[] } | { state: "corrupt" }`
      - `createBookmarkStore(dataRoot: string, deps: { ids: { bookmark(): string }; clock: { nowIso(): string }; fs?: Partial<StoreDeps> })`가 돌려주는 값: `list(): Promise<{ ok: true; value: BookmarkList } | { ok: false; reason: BookmarkReason }>`, `add(input: { title: string; url: string })`, `update(input: { id: string; title?: string; url?: string })`, `remove(id: string)`. 쓰기의 성공 값은 `Bookmark`(`remove`는 null), 실패는 `{ ok: false; reason }`.

## 할 일

1. `atomic-file.ts`: `layout-store.ts`의 `write` 안 로직(mkdir 0700, 남은 temp 지우기, temp에 쓰고 chmod 0600, rename, rename 뒤 chmod, 오류 code를 `not_a_directory`/`unwritable`/`internal`로 가르기)과 그에 딸린 type을 옮겨 함수 하나로 만든다. `layout-store.ts`는 `write(content)`가 `writeFileAtomic(file, content, impl)`을 부른다. 동작은 바꾸지 않는다.
2. `bookmarks.ts`
   - 파일 `<dataRoot>/shell/bookmarks.json`: `{ version: 1, bookmarks: Bookmark[] }`(zod strict). 파일이 없으면(`ENOENT`) 빈 목록이다. JSON 파싱 실패, schema 불일치, `version`이 1이 아닌 것은 모두 `corrupt`다. 읽을 수 없는 그 밖의 오류는 `unreadable`이다.
   - `list`는 `corrupt`를 오류가 아니라 `{ state: "corrupt" }` 값으로 돌려준다. 쓰기(`add`, `update`, `remove`)는 먼저 읽고, `corrupt`이면 `{ ok: false, reason: "corrupt" }`로 거절하며 파일을 건드리지 않는다. 읽기가 `unreadable`이어도 쓰지 않는다.
   - 검증: `title`은 앞뒤 공백을 지운 뒤 1~200자(아니면 `title`), `url`은 8192자 이하의 http/https이고 userinfo가 없어야 한다(아니면 `url`). 저장하는 url은 `new URL(url).href`다. 같은 url(`href`가 같은 것)이 이미 있으면 `duplicate`(`update`는 자기 자신을 뺀다). 개수가 1000개를 넘기는 `add`는 `limit`. `update`/`remove`의 id가 없으면 `missing`.
   - id와 시각은 인자로 받는다(`deps.ids.bookmark()`, `deps.clock.nowIso()`). `packages/base`의 `IdSource`·`Clock`을 shell이 import하지 못하므로 같은 뜻의 좁은 interface를 쓴다.
   - 순서는 더한 순서다.
   - 읽고-바꾸고-쓰는 한 번이 다른 쓰기와 섞이지 않게 쓰기 호출을 promise chain으로 줄 세운다(창이 여럿이어도 저장하는 곳이 main 하나다. 두 요청이 동시에 오면 하나가 다른 하나의 변경을 덮어쓸 수 있다).
   - 쓰기 실패(`writeFileAtomic`의 `unwritable`/`internal`)는 `unwritable`로 답한다. 직전 파일은 그대로다.
3. `bookmarks_test.ts`: 위험 test 하나(아래).

## 정한 것

- 다른 version이나 모르는 field가 든 파일도 `corrupt`로 본다(덮어쓰지 않는다). "옛 파일을 옮겨 읽지 않는다"(AGENTS.md "호환성")와 "사람이 모은 data를 잃지 않는다"를 함께 지키는 가장 단순한 길이다.
- 같은 url의 판정은 `href` 완전 일치다. fragment가 다르면 다른 bookmark다.
- userinfo가 든 url을 거절하는 것은 navigation 규칙(`decideNavigation`)이 어차피 그 주소를 열지 않기 때문이다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test: "깨진 bookmarks.json(JSON이 아님, schema가 틀림, version이 다름)이면 `list`는 `corrupt`를 답하고, `add`·`update`·`remove`는 모두 거절되며, 파일 byte가 하나도 바뀌지 않는다." (임시 폴더에 세 가지 깨진 내용을 써 놓고 표로 돈다. 사람의 `~/.lophn`을 쓰지 않는다. 같은 file에서 정상 파일에 `add`한 뒤 `list`가 그 항목을 돌려주는지도 한 case로 본다.)
- `layout-store.ts`의 동작이 같다: `git diff`에서 `write`가 `writeFileAtomic` 호출로만 바뀌었다.
- 남지 않음: `grep -n "unlink(temp)" packages/shell/main/workspace/layout-store.ts`가 0줄이다(옮겼다).

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: 없음
- 안 쓰게 된 export: 없음
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 넘길 줄: `main/workspace/layout-store.ts`(atomic write를 함수로 나눔)
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- **무겁게 짠 것**: 없으면 "없음"
- **알려진 미완 동작**: 없으면 "없음"
