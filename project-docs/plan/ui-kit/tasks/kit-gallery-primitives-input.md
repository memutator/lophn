# kit-gallery-primitives-input

gallery의 `Kit · primitives`와 `Kit · input` page가 그 분류 `mod.ts`의 모든 component를 실제 component로, 상태별로 그리게 한다. 예제 css를 없앤다.

- 단위: kit-gallery (wave 2)
- 선행: kit-gallery-split
- 소유(이 task만 고친다):
  - `tools/wireframes/pages/kit/primitives`
  - `tools/wireframes/pages/kit/input`
- 읽을 것:
  - 계획: `project-docs/plan/ui-kit/README.md`의 `kit-gallery`, `kit-checks`(check 2: 분류 `mod.ts`의 PascalCase 값 export가 `pages/kit`에 나온다), `classification.md` 1절 "그 밖에 찾은 것"
  - 요구: `project-docs/products/roadmap/ui-kit-single-source.md`의 요구 1·5, check 1·2
  - 본보기: `packages/design/components/primitives/mod.ts`, `packages/design/components/input/mod.ts`가 이 task가 그릴 목록이다(`kit-layout-guide`가 export마다 "언제 쓰나"를 달아 두었다). 지금의 section과 예제는 `tools/wireframes/pages/kit/<분류>/page.tsx`와 같은 폴더의 예제 파일에 있다.
  - skill: `.claude/skills/ui-design/SKILL.md`("함정": gallery 안 modal)
- 계약:
  - 쓰는 것: `tools/wireframes/pages/kit/kit.tsx`의 `Page`, `Section`, `Row`, `Stage`, `FROZEN_TIMER`, `kit`(CSS class). 이 파일과 `kit.module.css`는 고치지 않는다
  - 내놓는 것: 분류 `mod.ts`의 PascalCase 값 export(소문자가 하나 이상 있는 이름. 상수 `READING_WIDTHS`, helper 함수 `sortRows`, type은 제외)마다, 그 이름이 `tools/wireframes/pages/kit/<분류>/` 안 ts·tsx에 코드로 나온다. 이 폴더에 `.css` 파일이 없다. `page.tsx`의 export 이름(`Kit<이름>`)은 그대로다.

## 할 일

근거: README `kit-gallery`("gallery는 실제 component를 import만 하고, 그것을 check 셋이 지킨다"), 요구 1. 이 task 다음 `kit-checks`의 check 2·check 1이 이 폴더를 본다.

1. `mod.ts`의 PascalCase 값 export 목록을 낸다(`mod.ts`가 정본). 참고: primitives: Button, IconButton, Icon, Kbd, CopyButton, FileIcon. input: Field, FieldContext, Input, Textarea, Select, Checkbox, Switch, FilterBar, SearchFilter, DateRangeFilter, MultiSelectFilter(+ filter helper는 예제 `orders-filters`가 쓴다).
2. gallery에 안 나오는 것을 찾아 더한다. 지금 빠진 것으로 알려진 것: `FileIcon`(gallery에 실제로는 없었다), `FieldContext`, 그리고 sdk에서 온 filter 4개는 `orders-filters` 예제로만 나온다(page가 그 예제 section을 가졌는지 본다). 빠진 이름은 아래 확인 명령으로 찾는다.
3. 상태별로 그린다. 한 component가 가진 의미 있는 상태(props로 건 것)를 `Section` 하나에 `Row`로 나열한다. 참고: Button은 variant·크기·아이콘·비활성, Field는 기본·도움말·오류·비활성, Select는 닫힘·값 있음, FileIcon은 확장자 몇 가지(폴더 포함), FieldContext는 Field 안에서 context를 읽는 작은 입력 하나. 새 component를 정의하지 않는다. 모양을 덮어쓰지 않는다. 필요한 변형이 component에 없으면 gallery에서 흉내 내지 말고 보고의 "알려진 미완 동작"에 적는다(design 변경은 이 task 소유가 아니다).
4. 예제와 section의 CSS를 없앤다: `pages/kit/input/control-sizes.module.css`. 대신 `kit.tsx`가 내보내는 `kit` class(`kit.row`, `kit.panel` 등)를 쓰거나 `style={{ gap: "var(--space-4)" }}`처럼 token 변수만 inline으로 쓴다. 새 class가 필요해 보이면 inline으로 쓰고, 그래도 안 되면 보고한다. `kit.module.css`에 규칙을 더하지 않는다(다른 task도 같이 쓴다).
5. 사용자가 보는 문구는 wireframe 코드 안 영어 글이어도 된다(gallery는 wording 검사 밖). 설명(`note`)은 한국어 한두 문장이다.
6. 특별히 더 정한 것은 없다.
7. 문서·skill은 lead가 고친다.

## 끝남

- `deno task check`가 통과한다.
- `deno task wireframes`가 되고, gallery의 해당 `Kit · …` page가 열려 모든 section이 그려진다(`tools/wireframes/dist/index.html#/kit-primitives` 등).
- 위험 test: 없음
- 남지 않음:
  - 빠진 이름 확인(commit하지 않는다. 출력이 없어야 한다):

    ```
    for n in $(grep -v '^\s*//' packages/design/components/primitives/mod.ts | grep -ohP '(?<!type )\b[A-Z][a-z0-9][A-Za-z0-9]*\b' | sort -u); do grep -rqw "$n" tools/wireframes/pages/kit/primitives/ || echo "빠짐 primitives: $n"; done
    for n in $(grep -v '^\s*//' packages/design/components/input/mod.ts | grep -ohP '(?<!type )\b[A-Z][a-z0-9][A-Za-z0-9]*\b' | sort -u); do grep -rqw "$n" tools/wireframes/pages/kit/input/ || echo "빠짐 input: $n"; done
    ```
  - `find tools/wireframes/pages/kit/primitives -name "*.css"`가 0줄이다.
  - `grep -rn "\.module\.css" tools/wireframes/pages/kit/primitives`가 0줄이다(design·renderer의 css를 직접 import하는 줄도 없다).
  - `find tools/wireframes/pages/kit/input -name "*.css"`가 0줄이다.
  - `grep -rn "\.module\.css" tools/wireframes/pages/kit/input`가 0줄이다(design·renderer의 css를 직접 import하는 줄도 없다).

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: 없음 (`pages.ts`는 안 고친다)
- 안 쓰게 된 export: 없음
- 정한 것: 상태를 나열한 기준, 그 밖에 정한 것
- 넘길 줄: 없음
- 계약 바꾸기 요청: component에 없는 변형이 필요한 곳(design 변경 요청)
- 무겁게 짠 것: 없음이 기본
- 알려진 미완 동작: 그리지 못한 export나 상태와 이유
