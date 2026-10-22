# ws-schema

main의 layout 저장을 두 가지로 바꾼다. 파일을 앱 전체에 하나(`<data>/shell/layout.json`)가 아니라 project마다 하나(`<data>/shell/layouts/<prj_id>.json`)로 나누고, 파일 안 schema를 자리(desk) 층이 있는 판 4로 올린다. 자리마다 `WorkspaceView`에 해당하는 값 하나(panes, split_ratio, focused_pane, floats, detached)를 갖고, 옛 파일과 옛 판은 읽지 않는다. 저장 IPC의 입력과 읽기 전 걸러내기(등록되지 않은 kind 탭 건너뛰기)도 자리마다 돌게 한다.

- 단위: layout (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/shell/main/workspace/schema.ts`
  - `packages/shell/main/workspace/layout.ts`
  - `packages/shell/main/workspace/layout-store.ts`
  - `packages/shell/main/workspace/layout-store_test.ts`(새 file)
  - `packages/shell/main/desktop/core/layout-ipc.ts`
- 읽을 것:
  - 계획: `project-docs/plan/workflow-shell/README.md`의 "정한 것"(저장을 project마다 file 하나로 나눈다, desk key는 workflow 이름이다)
  - architecture: `project-docs/architecture/workspace-layout.md`의 "흐름"(`layout:save`, `layout.json`)과 "지키는 것"의 "project 창 renderer가 detached 항목까지 layout 전체를 갖고 저장한다"(창 bounds는 저장할 때 main이 살아 있는 detached 창 값으로 덮는다), "`transient` 탭은 저장하지 않는다"
  - 코드: `packages/shell/main/workspace/schema.ts`(`workspaceLayoutSchema`, `layoutPaneSchema`, `layoutFloatSchema`, `layoutDetachedSchema`), `layout.ts`(`parseLayoutFile`, `skipUnregisteredTabs`, `toLayoutFile`, `validateLayout`), `layout-store.ts`(`createLayoutStore`), `main/desktop/core/layout-ipc.ts`(`registerLayoutIpc`의 read·save), `main/desktop/wiring/layout.ts`(store를 만드는 곳. 이 task는 고치지 않는다), `main/workspace/atomic-file.ts`(`writeFileAtomic`이 폴더를 만든다), 본보기 test `main/browser/bookmarks_test.ts`(`node:test`와 임시 폴더)
  - skill: `.claude/skills/write-test/SKILL.md`
- 계약:
  - 쓰는 것: 같은 폴더의 `kinds/registry.ts`(`tabKindOf`, `LayoutTab`), `kinds/values.ts`(`tabKey`), `atomic-file.ts`, `main/desktop/ipc-guard.ts`, `packages/shell/ipc/workspace.ts`의 채널과 `LayoutReadResult`·`LayoutSaveResult`(바꾸지 않는다. 읽기 입력은 지금도 `{ project }`이고 `layout`은 `unknown`).
  - 내놓는 것
    - `LAYOUT_SCHEMA_VERSION = 4`. 판이 다르면 `parseLayoutFile`이 `unsupported_schema`를 내고 renderer는 새로 만든다(호환 장치 없음).
    - store: `createLayoutStore(dataRoot, deps?)`가 project를 인자로 받는다.
      ```ts
      interface LayoutStore {
        read(project: string): Promise<StoreResult<LayoutResult | null>>; // 그 project의 파일이 없으면 null
        write(project: string, content: string): Promise<StoreResult<null>>;
      }
      ```
      파일 경로는 `<dataRoot>/shell/layouts/<project>.json`이다. project 이름이 아니라 id(`prj_…`)를 쓴다. 이름은 `project.update`로 바뀔 수 있고 id는 안 바뀐다. 옛 `<dataRoot>/shell/layout.json`은 읽지도 지우지도 않는다.
    - 파일 `<data>/shell/layouts/<prj_id>.json`
      ```
      { schema_version: 4,
        layout: {
          schema_version: 4,
          project: "prj_…",
          window_bounds: { x, y, width, height },
          active_desk: string,            // desks의 key. 옛 last_space를 대신한다(last_space는 지운다)
          desks: { [desk key]: Desk }     // 1~200개. "_default"가 반드시 있다
        } }
      Desk = { panes(1~2), split_ratio, focused_pane, floats(≤20), detached(≤20) }
      ```
      `Desk`의 칸은 판 3의 최상위 칸과 같다(`layoutPaneSchema`, `layoutFloatSchema`, `layoutDetachedSchema`를 그대로 쓴다). desk key는 1~200자이고 제어 문자가 없다. default 자리의 key는 `"_default"`다(workflow 이름은 slug라 `_`로 시작할 수 없다. renderer의 `DEFAULT_DESK`와 같은 값을 이 file에 따로 적는다).
    - refine: `desks._default`가 있다. `active_desk`가 `desks`에 있다. 자리마다 `focused_pane < panes.length`. 자리를 건너 탭 key가 겹치는지는 검사하지 않는다(model의 불변 조건이고 겹친 파일은 만들어지지 않는다).
    - 타입: `WorkspaceLayout`은 위 `layout`, 새로 `WorkspaceDesk`(= `Desk`)를 내놓는다. `layout.ts`가 re-export한다.
    - 저장 IPC 입력(`shell:layout-save`, renderer → main)
      ```
      { project, active_desk, desks: { [desk key]: { panes, split_ratio, focused_pane, floats, detached } } }
      ```
      `window_bounds`와 schema 판은 main이 채운다. 살아 있는 detached 창의 bounds(`detachedBounds(event)`, 탭 key별)는 모든 자리의 `detached` 항목에 덮어쓴다(탭 key는 자리를 건너 하나라 어느 자리의 것이든 맞는다).
    - 읽기(`shell:layout-read`): 입력의 project 파일만 읽는다. 파일이 없으면 `absent`다.
    - `skipUnregisteredTabs`는 자리마다 돈다. 등록되지 않은 kind의 탭은 그 자리의 panes, floats, detached에서 건너뛰고 선택 탭을 옮기는 규칙은 지금과 같다.
  - 소비하는 쪽: ws-layout-map(renderer의 `desksFromStored`/`toStoredLayout`)이 이 모양을 그대로 읽고 보낸다. 판 4의 모양을 바꿔야 하면 고치지 말고 보고에 요청으로 적는다. 이 task와 ws-layout-map은 같은 wave에서 합쳐진다(한쪽만 합쳐지면 저장이 `invalid_input`으로 거절된다).

## 정한 것

1. **파일은 project마다 하나(`<data>/shell/layouts/<prj_id>.json`)다.** 근거: 지금은 앱 전체에 파일 하나이고 `layout.project`가 다르면 `absent`로 읽는다. 다른 project를 열어 저장하면 앞 project의 layout을 덮어쓴다. workflow 자리는 project마다 쌓이므로 그대로 두면 project를 오갈 때마다 모든 자리를 잃는다. project id로 두는 까닭은 이름이 바뀔 수 있어서다.
2. **자리 key 상한은 200개다.** 근거: 상한은 파일 크기를 막을 뿐이고, 넘으면 저장이 통째로 거절되어 layout을 잃는다. project 하나의 workflow 수보다 넉넉하게 잡는다.
3. **자리를 건너 탭 key가 겹치는지는 schema에서 거절하지 않는다.** 근거: 지금도 한 view 안의 겹침은 검사하지 않는다. 겹침을 막는 곳은 model(순수 함수)과 그 위험 test다. 파일 검증이 거절하면 읽기가 "corrupt"가 되어 layout 전체를 잃는다.
4. **옛 `layout.json`은 지우지 않고 읽지 않는다.** 근거: 호환 장치를 만들지 않는다(AGENTS.md "호환성"). 개발 데이터는 schema가 바뀌면 지우고 새로 만든다. 남은 파일은 해가 없다.
5. **`project`는 파일 안에도 둔다.** 근거: 계약의 `layout.project`와 read IPC의 `layout.project !== 입력 project`면 `absent`로 읽는 지금 검사를 그대로 둔다. 새 방어를 더하는 것이 아니다.

## 할 일

지금: `layout-store.ts`는 경로 하나(`shell/layout.json`)의 `read()`·`write(content)`, `layout-ipc.ts`의 `saveInput`은 view 하나를 받아 `validateLayout`에 `last_space`와 같이 넣는다.

1. `schema.ts`
   - `LAYOUT_SCHEMA_VERSION`을 4로 올리고, 머리 주석에 "판 4부터 자리(desk)"를 더한다.
   - `DEFAULT_DESK = "_default"`를 export한다(주석: slug가 될 수 없는 값. renderer `model.ts`의 같은 이름과 짝).
   - `deskSchema`(= `Desk`)를 `z.strictObject({ panes, split_ratio, focused_pane, floats, detached })`로 만들고 `refine`(`focused_pane < panes.length`)을 단다. 칸과 float·detached 항목 schema는 지금 것을 그대로 쓴다.
   - `workspaceLayoutSchema`에서 `last_space`와 최상위 칸을 지우고 `active_desk`(`z.string().min(1).max(200)`), `desks`(key는 1~200자·제어 문자 없음, 개수 1~200)를 넣는다. refine 둘: `desks`에 `DEFAULT_DESK`가 있다, `active_desk`가 `desks`에 있다. zod는 4.6.5(`deno.json`)이고 `z.record(키 schema, 값 schema)`는 `packages/core/apps/runtime/control-protocol.ts`의 `screens`가 본보기다. 개수(1~200)는 `refine`으로 본다.
   - `WorkspaceDesk` type을 내놓는다.
2. `layout.ts`
   - `skipUnregisteredTabs`가 `layout.desks`의 자리마다 panes·floats·detached를 걸러 바뀐 자리만 새 객체로 바꾸도록 고친다. 걸러내는 규칙 자체(선택 탭 옮기기, float·detached는 항목째)는 지금 그대로다.
   - `WorkspaceDesk`를 re-export 목록에 더한다.
3. `layout-store.ts`
   - `layoutPath(dataRoot, project)`는 `join(dataRoot, "shell", "layouts", `${project}.json`)`이다. 머리 주석의 경로도 고친다.
   - `read(project)`, `write(project, content)`가 그 경로를 쓴다. 나머지(ENOENT는 null, 손상은 `corrupt`, 원자 교체)는 그대로다. 폴더는 `writeFileAtomic`이 만든다.
4. `layout-ipc.ts`
   - `saveInput`을 `{ project, active_desk, desks }`로 바꾼다. 자리 값은 `{ panes, split_ratio, focused_pane, floats, detached }`를 지금 칸 상한(panes 1~2, floats 20, detached 20)으로 받고 자리 key는 1~200자, 개수 1~200이다.
   - save: 모든 자리의 `detached` 항목에 `live.get(tab.key)` bounds를 덮어쓴다(지금 `detached.map`을 자리마다 돈다). `validateLayout`에 `{ schema_version, project, window_bounds, active_desk, desks }`를 넣고 `deps.store.write(project, …)`를 부른다.
   - read: `deps.store.read(project)`를 부른다. 나머지(`absent`, `layout.project` 대조)는 그대로다.
5. `layout-store_test.ts`(새 file, `node:test`와 `mkdtemp`로 임시 폴더. `~/.lophn`을 쓰지 않는다). 위험 test 한 개를 쓴다(아래 "끝남").
6. 고친 뒤 `grep -rn "last_space" packages/shell/main`가 0줄이 되는지 본다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test: "project A의 layout을 저장한 뒤 project B를 저장해도 project A의 자리들이 그대로 읽히고, 저장한 적 없는 project는 null이다."
  - `layout-store_test.ts`에 `test` 한 개. 실제 store(임시 `dataRoot`)로 A(`default`와 `alpha` 둘), B(`default`만)를 `write`하고 `read`해 자리 key와 탭 key가 같은지 본다. 내용은 `toLayoutFile`로 만든 JSON이고 탭은 `document_editor` kind 하나로 충분하다.
  - 근거: 한 file을 앱 전체가 덮어써 workflow 자리를 잃던 일이 이 task가 막으려는 데이터 손실이다(`write-test` "사용자 데이터를 잃거나 망가뜨리는 규칙: 저장").
  - 쓰지 않는 test: 판 3 파일이 `unsupported_schema`인지(옛 설계를 지키는 test), 등록되지 않은 kind 건너뛰기(지금도 test가 없고 규칙은 그대로다), zod가 이미 보장하는 `default` 없음.
- 남지 않음: `grep -rn "last_space" packages/shell/main`이 0줄이다. (`packages/shell/renderer`의 같은 이름은 ws-layout-map이 지운다.)

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: 없음 예상
- 안 쓰게 된 export(남이 쓰던 것은 지우지 않는다): 없음 예상
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 넘길 줄: `main/desktop/wiring/layout.ts`는 `createLayoutStore(dataRoot)` 호출이 그대로 맞아 고치지 않았는지
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- **무겁게 짠 것**: 가장 단순한 구현(AGENTS.md "속도")보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것. 남은 옛 `shell/layout.json`은 읽지도 지우지도 않는다는 것을 적는다.
