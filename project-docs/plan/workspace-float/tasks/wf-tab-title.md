# wf-tab-title

다시 띄운 plain terminal 탭과 app panel 탭의 제목이 비지 않게 한다. 두 kind가 `layout.json`에 제목을 남기고 되살린다. 이슈 `project-docs/issues/workspace-layout.md`의 "다시 띄운 plain terminal과 app panel 탭의 제목이 비어 있다"를 고친다(추천안).

- 단위: wf-tab-title (wave 3)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/shell/main/workspace/kinds/terminal.ts`
  - `packages/shell/main/workspace/kinds/app-panel.ts`
  - `packages/shell/renderer/workspace/kinds/terminal.tsx`
  - `packages/shell/renderer/workspace/kinds/app-panel.tsx`
- 읽을 것:
  - 이슈: `project-docs/issues/workspace-layout.md`
  - 지금 코드: main `kinds/terminal.ts`의 `layout` schema(`coding.title`은 이미 있다), `kinds/app-panel.ts`의 `layout` schema, renderer `kinds/terminal.tsx`의 `fromStored`(plain이면 `title: ""`)·`toStored`(plain이면 제목을 안 남긴다), `kinds/app-panel.tsx`의 `fromStored`(`title: ""`)·`toStored`, `workspace/app-panel-tab.tsx`(앱을 고를 때 `patchTab`으로 제목을 정한다), `main/workspace/schema.ts`(`LAYOUT_SCHEMA_VERSION`)
- 계약:
  - 쓰는 것: 없음.
  - 내놓는 것: 저장 꼴의 terminal 탭과 app_panel 탭에 선택 칸 `title`(string 1..200). layout 판은 2 그대로다.

## 할 일

1. main schema: `terminal`의 `layout`에 `title: z.string().min(1).max(200).optional()`을 탭 맨 위 칸으로 더한다(plain terminal용. coding terminal은 지금처럼 `coding.title`을 쓴다). `app_panel`의 `layout`에도 같은 칸을 더한다.
2. renderer `terminal.tsx`: plain terminal의 `toStored`가 `tab.title`이 비지 않았으면 `title`을 남기고(200자로 자른다), `fromStored`가 `stored.title`이 문자열이면 그것을, 아니면 `""`를 쓴다. coding terminal 길은 그대로다.
3. renderer `app-panel.tsx`: `toStored`가 `title`을 같은 규칙으로 남기고 `fromStored`가 읽는다.
4. 판을 올리지 않는다. 선택 칸이라 지금 판 2 파일도 그대로 읽힌다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test: 없음. 화면 문구다.
- `deno run -A packages/shell/renderer/build.ts`로 renderer bundle이 선다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: 없음
- 안 쓰게 된 export: 없음
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 넘길 줄: 없으면 "없음"
- 계약 바꾸기 요청: 없으면 "없음"
- **무겁게 짠 것**: 없으면 "없음"
- **알려진 미완 동작**: 없으면 "없음"
