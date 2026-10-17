# kit-checks

check 셋을 `deno task check`에 건다: (1) `tools/wireframes`에서 `drafts/` 밖에 CSS가 없다, (2) design 분류 `mod.ts`의 모든 component가 `pages/kit`에 나온다, (3) design의 모든 component가 분류 폴더 안에 있고 `mod.ts`에 한 줄 문서가 있다.

- 단위: kit-checks (wave 3)
- 선행: 없음
- 소유(이 task만 고친다):
  - `tools/check-kit.ts`
  - `tools/check.ts`
- 읽을 것:
  - 계획: `project-docs/plan/ui-kit/README.md`의 `kit-checks`, `classification.md` 5절 7·10번
  - 요구: `project-docs/products/roadmap/ui-kit-single-source.md`의 "check 셋"
  - 본보기: `tools/check-source.ts`(source를 읽어 검사하는 check의 꼴), `tools/check-style.ts`, `tools/check.ts`의 `buildSteps`(step 등록)
  - 재료: `kit-layout-guide`가 정한 `mod.ts` 한 줄 문서의 모양(`export { … } from` 문 바로 윗줄이 `//`), `kit-gallery-split`이 만든 폴더(`tools/wireframes/{pages,mock,drafts}`)
- 계약:
  - 쓰는 것: `packages/design/components/<분류>/mod.ts` 8개와 `_shared/mod.ts`, `tools/wireframes/` 폴더 모양
  - 내놓는 것: `deno run --allow-read tools/check-kit.ts`가 위반마다 `<file>:<line> <이유>`를 stderr에 찍고 있으면 exit 1. `deno task check`의 step `kit`.

## 할 일

근거: 요구 5(동기화 검증)와 README `kit-checks`. 정한 것(애매한 것을 가장 단순하게 정한다).
- check 2의 "export"는 분류 `mod.ts`가 내보내는 **PascalCase 값 export**(`type` 없이 내보내는 이름이고 첫 글자가 대문자, 소문자가 하나 이상)다. component, Context, Provider가 여기 든다. 상수(`READING_WIDTHS`), helper 함수(`sortRows`), hook(`useCopy`), type은 "kit 부품"이 아니라서 뺀다. `_shared`는 지원 export라 뺀다. root token(`tokens`, `vars`)도 뺀다.
- check 2의 "나온다"는 그 이름이 `tools/wireframes/pages/kit/` 아래 `.ts`/`.tsx` 파일에 단어 경계로 한 번 이상 있는 것이다(import 구문이나 주석만 있는 것도 센다. 단순함을 고른다).
- check 3의 "한 줄 문서"는 `mod.ts`의 `export { ... } from` 문 가운데 값(type이 아닌 이름)을 하나라도 내보내는 문의 바로 윗줄이 비지 않은 `//` 주석인 것이다.
- check 1의 예외는 이름으로 박는다: `tools/wireframes/gallery.module.css`, `tools/wireframes/pages/kit/kit.module.css`(`classification.md` 5절 10번).

1. `tools/check-kit.ts`를 쓴다(`--allow-read`만). `check-source.ts`처럼 `export async function checkKit(root: string): Promise<Issue[]>`와 실행부(`import.meta.main`)로 나눈다. 시각·무작위는 쓰지 않는다. 파일 목록은 `Deno.readDir`로 재귀한다(`node_modules`, `dist` 제외). 규칙:
   - check 1: `tools/wireframes` 아래 `*.css`(`*.module.css` 포함)가 `tools/wireframes/drafts/` 밖에 있으면 위반. 위 예외 둘은 허용. 이유 문구: "drafts/ 밖의 CSS다. 실제 component를 import하거나 drafts/로 옮긴다".
   - check 2: 분류 8개(`primitives input layout navigation data feedback overlay reading`)마다 `mod.ts`에서 위 이름을 뽑아, `pages/kit/` 아래에서 찾지 못하면 위반 `<mod.ts>:<줄> <이름>이 pages/kit에 나오지 않는다`. 이름을 뽑을 때 주석 줄은 읽지 않고, `type`이 붙은 이름은 뺀다. `export { A, type B, C as D }` 꼴을 읽는다(`as` 뒤 이름이 내보내는 이름이다).
   - check 3: (a) `packages/design/components/` 바로 아래 항목은 분류 8개, `_shared`, `css-modules.d.ts`뿐이다. (b) 분류 8개와 `_shared`에 `mod.ts`가 있다. (c) `packages/design` 아래 `.tsx` 파일은 `components/<분류 8개 또는 _shared>/` 안에만 있다(`style-check`, `wording`, `generated`, `fonts` 폴더의 `.tsx`는 지금 없다. 생기면 위반으로 두고 이유를 적는다). (d) 분류 8개의 `mod.ts`마다 위 "한 줄 문서" 규칙.
2. `tools/check.ts`의 `buildSteps`에 step `kit`을 더한다: `has("design", "tools")`일 때 `["deno", "run", "--allow-read", "tools/check-kit.ts"]`, 아니면 `skip("kit", "design, tools가 안 돎")`. `check`/`check:full` 둘 다에서 돈다.
3. 이 check가 지금 main에서 통과해야 한다. 이 task 앞(wave 1·2)에서 모두 끝난 상태다. 위반이 나오면 이 task가 고치지 말고 보고한다. 위반이 `tools/wireframes/pages/kit/`의 빠진 export나 CSS면 `kit-gallery-*`가 덜 한 것이니 lead에게 돌려보낸다. check 코드의 잘못이면 고친다.
4. 이 check는 일부러 만든 위반에 실패해야 한다. 임시로 (commit하지 않는다) `drafts/` 밖에 빈 `.css` 파일 하나, `mod.ts`의 한 문에서 주석 한 줄을 지워 보고 실패하는지 본 뒤 되돌린다.
5. 문서(ui-design skill의 "확인" 절, architecture)는 lead가 고친다.

## 끝남

- `deno task check`가 통과하고 출력에 step `kit`이 있다.
- 위험 test: 없음 (check 자체가 검사다. check 코드에 test를 붙이지 않는다)
- 남지 않음: `tools/check.ts`의 step 목록에 `kit`이 한 번만 있다. `grep -n "check-kit" tools/*.ts`가 `tools/check.ts`의 한 줄만 보인다.
- (화면) 해당 없음

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: 없음
- 안 쓰게 된 export: 없음
- 정한 것: 위에서 정한 것 말고 더 정한 것
- 넘길 줄: 없음
- 계약 바꾸기 요청: 없음
- 무겁게 짠 것: 없음이 기본
- 알려진 미완 동작: check가 못 잡는 것(예: 이름이 주석에만 있는 경우)
