# kit-layout-guide

분류 `mod.ts`마다 값 export에 "언제 쓰나" 한 줄을 단다. 이 줄이 kit의 목록이고(요구 6), `kit-checks`의 check 3이 본다.

- 단위: kit-layout (wave 1)
- 선행: kit-layout-chart
- 소유(이 task만 고친다):
  - `packages/design/components/primitives/mod.ts`
  - `packages/design/components/input/mod.ts`
  - `packages/design/components/layout/mod.ts`
  - `packages/design/components/navigation/mod.ts`
  - `packages/design/components/data/mod.ts`
  - `packages/design/components/feedback/mod.ts`
  - `packages/design/components/overlay/mod.ts`
  - `packages/design/components/reading/mod.ts`
  - `packages/design/components/_shared/mod.ts`
- 읽을 것:
  - 계획: `project-docs/plan/ui-kit/README.md`의 `kit-layout`, `kit-checks`(check 3의 모양)
  - 요구: `project-docs/products/roadmap/ui-kit-single-source.md`의 요구 6, "check 셋" 3
  - 말: `.claude/skills/wording/SKILL.md`는 화면 문구용이다. 이 줄은 개발자가 읽는 주석이라 AGENTS.md "말"(개발자 영어 단어 그대로)을 따른다.
- 계약:
  - 쓰는 것: `kit-layout-move`와 `kit-layout-chart`가 만든 분류 `mod.ts`의 export 문
  - 내놓는 것: 모양이 `kit-checks`와 맞아야 한다. `mod.ts`의 `export { ... } from "..."` 문 하나마다, 그 문이 값(type이 아닌 이름)을 하나라도 내보내면, 바로 윗줄이 `//`로 시작하는 한 줄 주석이다. 한 문에 값 여럿(helper 묶음)을 두면 그 한 줄이 묶음 전체의 "언제 쓰나"다.

## 할 일

근거: README `kit-layout`("분류마다 `mod.ts`에 export마다 '언제 쓰나' 한 줄"), 요구 6.

1. 각 `mod.ts`를 연다. 값 export 하나(와 그 Props·타입)가 한 `export { ... } from` 문이 되도록 문을 나눈다(지금 한 문에 component 여럿이 묶여 있으면 component마다 문 하나로). helper 함수·상수는 같이 쓰이는 것끼리 한 문으로 묶어도 된다.
2. 문마다 바로 윗줄에 한 줄 주석을 쓴다.
   - 형식: `// <언제 쓰나>`. "무엇이다"가 아니라 "언제 이걸 고르나"를 쓴다. 한국어 한 문장, 80자 안팎, 마침표로 끝낸다. 예: `// 화면에서 가장 기본인 조작. 주 행동은 primary 하나만 둔다.`
   - 비슷한 것과 갈리는 지점을 적는다(예: Popover와 Menu, Dialog와 Sheet, Toast와 StatusMark, Loading과 Skeleton).
   - 코드를 읽어 쓴다. 이름만 보고 추측하지 않는다. component 파일 머리 주석과 props를 본다.
3. 파일 맨 위에 분류가 무엇인지 한 줄(`// <분류>: ...`)을 단다. 이 줄은 check 대상이 아니다.
4. `_shared/mod.ts`는 지원 export(componentMark, Clock, Timer, Clipboard, ResizeSource…)다. 같은 형식으로 쓰되 "언제 쓰나" 대신 "누가 쓰나" 한 줄이어도 된다.
5. 모양은 바꾸지 않는다: export 이름, 파일 경로, 순서의 의미를 건드리지 않는다. 주석과 문 나누기만 한다.
6. 문서(architecture, skill)는 lead가 고친다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test: 없음 (주석뿐이다)
- 남지 않음: 위 9개 `mod.ts`마다 값 export 문 바로 윗줄이 `//` 주석이다. 확인용(commit하지 않는다): 각 파일에서 `export {`로 시작하는 줄 앞 줄이 `//`인지 한 번 훑는다.
- (화면) 해당 없음

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: 없음
- 안 쓰게 된 export: 없음
- 정한 것: 문을 나눈 기준, 그 밖에 정한 것
- 넘길 줄: 없음
- 계약 바꾸기 요청: 없음
- 무겁게 짠 것: 없음
- 알려진 미완 동작: 없음
