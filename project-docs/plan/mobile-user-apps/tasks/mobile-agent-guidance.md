# mobile-agent-guidance

앱 agent가 읽는 지침에 폰 화면을 더한다: 언제 폰 화면을 쓰나, 등록한 기준 폰 읽기, 폰 화면의 source와 선언과 의존, 폰 규칙(44 이상, hover 없음, 반응형 없음, network 없음), desktop preview로 확인하는 길과 그 한계. 이미 있는 앱의 agent에게는 `migrate-sdk` 메모의 Instruction diff로 전한다. 이 task는 지침과 template만 고치고, 도구와 build는 앞선 task들이 끝냈다.

- 단위: app-guidance (wave 7)
- 선행: mobile-preview-phone, mobile-sdk-kit, mobile-sdk-phone-hooks, mobile-build-phone, mobile-place-decl, mobile-phone-target
- 소유(이 task만 고친다):
  - `packages/core/agent-workspaces/skills/design-app/SKILL.md`
  - `packages/core/agent-workspaces/prompts/app.md`
  - `packages/core/agent-workspaces/skills/migrate-sdk/declaration-4.6.0.md`(이 판은 계획이 land되기 전이라 아직 어느 앱에도 가지 않았다. 새 지침 diff로 다시 쓴다)
  - `packages/sdk/declaration/guide.md`
  - `packages/design/native/guide.md`(`mobile-sdk-kit`이 쓴 글을 지침 전체와 맞추는 만큼만)
  - `packages/sdk/app-ui-native/guide.md`(`mobile-sdk-phone-hooks`가 쓴 글을 맞추는 만큼만)
  - `packages/core/apps/packages/template/app/AGENTS.md.tmpl`
  - `packages/core/apps/packages/template/app/tests/declaration_test.ts.tmpl`
  - `packages/core/apps/packages/template/app/scripts/build-ui.ts.tmpl`
  - `packages/core/apps/packages/template/app/lophn.ts.tmpl`(주석만)
- 읽을 것:
  - skill: `.claude/skills/sdk-note/SKILL.md`(지침이 바뀌면 판의 메모에 Instruction diff. 이 task의 지침 diff는 `declaration-4.6.0.md`로 간다. 메모는 앱 agent가 이 저장소를 모른 채 읽는다)
  - 지금 지침: `design-app/SKILL.md`("Screens without clutter", "Where screens open" — 자리 목록), template `AGENTS.md.tmpl`(lophn 관리 부분의 화면 `places` 줄), `prompts/app.md`(preview 확인 절차 5번), `tests/declaration_test.ts.tmpl`(각 화면은 `index.html`과 `main.tsx`가 있어야 한다는 test), `scripts/build-ui.ts.tmpl`(모든 `src/screens/<key>/`를 `main.tsx`로 build한다), `packages/sdk/declaration/guide.md`(`places`의 `phone` 항목은 `mobile-place-decl`이 최소한으로 썼다)
  - 근거: 이 계획 `README.md`의 "정한 것", `/home/pyosechang/projects/lophn/reports/mobile-program/app-screens-spike.md`, `mobile-build-phone`의 보고(설치 비용 안: 앱이 폰 의존을 어떻게 선언하나, `npm run check`가 폰 화면을 type 검사하는 법), `mobile-preview-phone`의 보고(`--screen`, 기준 폰이 없을 때의 `conflict`, react-native-web이 어긋나는 곳), `mobile-phone-guest`와 `mobile-phone-apps`의 보고(폰에서 보이는 상태와 제한), `packages/design/native/guide.md`와 `packages/sdk/app-ui-native/guide.md`, 도구 설명: `lophn app phone-target --help`, `lophn tab open --help`
  - 사람의 결정(roadmap `mobile.md`의 "사용자 앱을 폰에 띄우기"): 폰 화면은 등록한 기준 폰의 크기와 DPR에 맞춰 그리고 반응형을 만들지 않는다. 기준 폰이 바뀌면 옛 크기로 그린 화면은 다시 그려야 한다(사람에게는 notice가 간다). desktop 화면과 폰 화면은 다른 source file이고 operation과 data는 하나다
- 계약:
  - 쓰는 것: 앞선 task들이 낸 도구(`lophn app phone-target`, `lophn tab open --preview <app> --screen <key>`)와 SDK part 둘. 지침에는 도구가 하는 일만 쓰고 계획·task 이름과 lophn 저장소 path를 쓰지 않는다
  - 내놓는 것: 아래 지침과 template 변경. 기본 template은 폰 의존을 갖지 않는다(앱이 폰 화면을 더할 때 지침이 가르친 대로 의존을 더한다)

## 할 일

1. `design-app/SKILL.md`에 "Phone screens" 절을 더하고 "Where screens open"의 자리 목록에 `phone`을 한 줄 더한다. 절의 내용(영어, 짧고 명령형):
   - 언제 쓰나: 사람이 폰에서 이 앱을 쓸 때. 사람이 요청하지 않았으면 만들지 않는다. 앱 하나가 desktop 화면과 폰 화면을 같이 갖는다. 둘은 서로 다른 file이고(`src/screens/<key>/phone.tsx` 대 `main.tsx`) operation과 data는 하나다. 한 화면을 반응형으로 두 곳에 쓰지 않는다.
   - 먼저 `lophn app phone-target`로 사람의 기준 폰(이름, OS, 폭·높이 CSS px, DPR)을 읽는다. `device`가 null이면 폰 화면을 그리기 전에 사람에게 폰을 pairing하라고 말한다. 폭에 맞춰 그린다(폰 화면 전체 높이 가운데 lophn의 위 한 줄 아래만 쓴다). 사람이 폰을 바꾸면 옛 크기로 그린 화면은 다시 그린다.
   - 선언과 source: `places: ["phone"]`(혼자만, `tray`를 두지 않는다), `path: "/screens/<key>/index.html"`, source `src/screens/<key>/phone.tsx`(default export가 component, 그 dir에 `main.tsx`를 두지 않는다). 의존: `@lophn/ui-native`와 `@lophn/app-ui-native`를 `package.json`(`file:.lophn/sdk/...`)과 `lophn.ts`의 `sdk_dependencies`에 같은 정확한 판으로 더하고, `mobile-build-phone`이 정한 대로 폰 화면이 type 검사와 preview build에 쓰는 peer 의존을 더한다. `@lophn/ui`·`@lophn/app-ui`·`react-dom`을 폰 화면에서 import하지 않는다(build가 거절하고 어느 native 짝을 쓰라고 말한다).
   - 규칙: 누르는 곳 44 이상(kit이 준다. 직접 그리면 지킨다), hover에 기대지 않는다, 화면이 쓸 수 있는 module은 build가 허락한 것뿐(react, react-native, kit, `@lophn/app-ui-native`, 아이콘, svg)이고 `fetch`와 network가 없다: 데이터는 operation(`useOperation`, `OperationButton`)과 event(`useEvent`)로만 받는다. 이미지는 kit의 icon과 `data:` URI뿐이다. 글꼴은 kit이 준다. 자기 chrome에 색 값을 직접 쓰지 않고 kit의 theme을 쓴다.
   - 확인: desktop에서 `lophn release prepare` → `lophn preview start` → `lophn tab open --preview <app> --screen <key>`(기준 폰 크기의 틀로 열린다) → `lophn browser snapshot|screenshot|act`로 보고 누르고 `lophn preview call`로 operation을 건다. 이것은 react-native-web이라 실제 폰과 다를 수 있다(입력, soft keyboard, scroll, 글꼴, safe area). 결과를 알릴 때 "desktop preview에서 본 것"과 "폰에서 보지 못한 것"을 구별해 적고 마지막 확인은 사람이 폰에서 한다고 말한다. 폰 앱이 화면보다 옛 kit이면 폰이 "update the lophn app"을 보인다는 것도 알려 준다.
   - 예: `phone.tsx` 하나(kit의 `Screen`, `List`, `OperationButton`, `usePlace`)를 20줄 안쪽으로 싣는다. 실제로 build되는 예여야 하므로 `mobile-preview-phone`의 end-to-end에서 쓴 화면을 쓴다.
2. 템플릿: `AGENTS.md.tmpl`의 lophn 관리 부분에서 `places` 줄에 `phone`을 한 줄로 더하고 "폰 화면은 `design-app` skill의 Phone screens를 읽는다"를 쓴다. `tests/declaration_test.ts.tmpl`의 "every screen has a source" test를 폰 화면(`places`가 `["phone"]`)에서는 `src/screens/<key>/phone.tsx`가 있고 `main.tsx`가 없는지 보게 하고, 그 밖의 화면은 지금과 같다(`path`가 `/screens/<key>/index.html`인 것은 둘 다). `scripts/build-ui.ts.tmpl`은 `phone.tsx`가 있는 dir을 건너뛴다(폰 화면의 build는 release 준비가 한다는 주석 한 줄). `lophn.ts.tmpl`은 주석에 폰 화면의 `places` 예 한 줄만 더한다(기본 선언에 폰 화면을 넣지 않는다).
3. `prompts/app.md`: preview 확인 절차(5번)에 폰 화면이 있으면 `lophn tab open --preview <app> --screen <key>`로 연다는 것과 `lophn app phone-target`을 한 줄씩 더한다. `preview start`가 자동으로 여는 탭은 앱의 첫 `tab` 화면이라 폰 화면만 있는 앱은 `--screen`으로 연다는 것을 쓴다.
4. SDK guide: `packages/sdk/declaration/guide.md`의 `phone` 항목을 위 내용에 맞게 완성한다(자리의 뜻, 혼자 선다, source 규약, 지침은 `design-app`). `design/native/guide.md`와 `app-ui-native/guide.md`는 위 절과 어긋나는 말만 고친다(중복해서 다시 쓰지 않는다).
5. 메모 `declaration-4.6.0.md`의 `## Instruction diff`를 위 지침 변경의 git diff(declaration `guide.md`, `design-app/SKILL.md`, `AGENTS.md.tmpl`)로 다시 만든다(`sdk-note` skill: 바뀐 hunk만, 지침과 상관없는 hunk 제외, 위에 앱 agent가 할 일: 앱의 `AGENTS.md`의 lophn 관리 부분을 새 줄로 맞춘다, 폰 화면을 만들 때 위 순서를 따른다). 이 판은 아직 나가지 않았으므로 새 판 번호를 만들지 않는다. `app-ui-2.15.0.md`가 같이 움직이는 판으로 가리키는지 본다.
6. 확인: `lophn app create`로 새 앱을 만들어(개발 `npm run dev`, `.dev-data/` 안. 실제 model provider를 부르지 않는다) 새 template의 test(`npm test`)가 지금처럼 통과하는지, 폰 화면 하나를 손으로 더한 앱에서 템플릿 test의 폰 갈래가 통과하고 `main.tsx`를 같이 두면 실패하는지 본다. 지침을 읽은 agent가 따라 할 수 있는지 `design-app`의 절을 위에서 아래로 한 번 직접 따라 해 보고(`mobile-preview-phone`에서 쓴 화면으로) 막히는 곳을 고친다.
7. flows catalog: 내장 skill의 바뀐 줄은 이 task가 project-docs/flows 에서 고친다(자기 줄만. 꼴은 .claude/skills/flows/SKILL.md). `node tools/flows.ts check`가 통과해야 한다.

## 끝남

- `npm run check`가 통과한다(특히 `node tools/check-sdk-notes.ts`, `tools/check-skills.ts`).
- 위험 test: 없음(글과 template이다). template test의 폰 갈래는 위 6의 손 확인으로 본다.
- 남지 않음: `grep -rn "phone" packages/core/agent-workspaces/skills/design-app/SKILL.md`가 "Phone screens" 절과 자리 한 줄만 가리키는지 읽는다(다른 곳의 옛 "tab, panel, card, sidebar, tray" 다섯 자리 목록이 `phone`을 빼먹은 채 남지 않았는지 `grep -rn "sidebar.*tray" packages/core packages/sdk`로 찾는다).
- `project-docs/flows/`가 check를 통과한다.

## 보고

`.claude/skills/orchestrate/brief-template.md`의 "보고" 꼴. 더해서: 새 지침 절의 목차, 6번 손 확인(따라 하다 막힌 곳과 고친 곳), Instruction diff를 만든 명령, 알려진 한계(예: `preview start`의 자동 탭이 폰 화면 앱에서 여는 화면).
