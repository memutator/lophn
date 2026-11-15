# mobile-sdk-kit

폰 UI kit(`packages/design/native`, `@lophn/ui-native` 0.1.0)을 SDK part로 등록한다. 앱 agent가 그 판을 `package.json`에 `file:.lophn/sdk/ui-native/0.1.0`으로 고정해 type 검사와 desktop preview에 쓰고(폰에서는 폰 앱의 base bundle이 같은 kit을 내준다), `@lophn/ui` 사본에는 kit이 섞이지 않게 한다. 손으로 쓴 guide와 첫 판 메모를 낸다.

- 단위: phone-sdk (wave 5)
- 선행: mobile-build-phone, mobile-phone-contract. **`mobile-app` 계획이 main에 land된 뒤에 띄운다**(`packages/design/native`가 main에 있어야 한다)
- 소유(이 task만 고친다):
  - `packages/core/apps/packages/vendor.ts`
  - `packages/core/apps/packages/install_test.ts`
  - `packages/design/native/package.json`
  - `packages/design/native/guide.md`(새 file)
  - `packages/design/package.json`(필요하면)
  - `packages/core/agent-workspaces/skills/migrate-sdk/ui-native-0.1.0.md`(새 file)
- 읽을 것:
  - skill: `.claude/skills/sdk-note/SKILL.md`(판, 메모, `supported_from`, Instruction diff). 본보기 메모: 첫 판 메모(`Previous: none`)는 `cap-fs-1.0.0.md`나 `flow-1.0.0.md`
  - 설치 길: `packages/core/apps/packages/{install.ts,vendor.ts,builtin.ts}`(`SUPPORT_SOURCES`: `design`은 `@lophn/ui`로, `design/i18n`은 `@lophn/i18n`으로 깔린다. 사본은 `<data root>/sdk/<part>/<판>/`이고 `VENDOR_RULES`가 사본 밖 source를 `vendor/`로 담는다), `builtin.ts`의 `readBuiltinSdk`(`guide.md`가 있으면 그것을 내고 없으면 `components/<분류>/mod.ts`로 색인을 만든다. 이 kit은 그 폴더 배치가 아니라 손으로 쓴 guide가 필요하다), `tools/check-sdk-notes.ts`(`packages/sdk/*`와 `SUPPORT_SOURCES`마다 지금 판과 하한의 메모를 본다)
  - kit: `packages/design/native/mod.ts`(export마다 윗줄이 쓰임새. guide의 근거), `packages/design/native/package.json`(peer 목록), kit이 `packages/design/native/` 밖에서 가져오는 것(`../../tokens.ts`, `../../components/reading/markdown/*`. `grep -rn 'from "\.\./\.\./' packages/design/native`로 다시 센다)
  - `mobile-build-phone`의 보고(설치 비용 측정과 peer를 앱이 어떻게 선언하게 되었나. 이 task가 그 결과대로 `package.json`의 `peerDependencies`와 guide의 설치 절을 맞춘다), `packages/protocol/apps/phone-screen.ts`(`PHONE_HOST_MODULES`, 화면이 import할 수 있는 module)
  - 판정: `/home/pyosechang/projects/lophn/reports/mobile-program/app-screens-spike.md`의 "6. Desktop preview"(kit이 react-native-web에서 도는 조건)
- 계약:
  - 쓰는 것: 지금의 kit 소스(고치지 않는다. kit의 화면 조각을 바꾸는 일은 이 task가 아니다)
  - 내놓는 것: 설치 사본 `<data root>/sdk/ui-native/0.1.0/`(자기 완결: 사본 안 import가 사본 밖을 가리키지 않는다. kit 밖 source는 `vendor/`), `lophn.supported_from` 0.1.0, 메모 `ui-native-0.1.0.md`(`Previous: none`)

## 할 일

1. `vendor.ts`: `design`의 `skip`에 `native`를 더한다(`@lophn/ui` 사본이 kit을 쓸어 담지 않는다. 같은 판 1.1.0의 bytes를 바꾸지 않으려는 것이다. mobile-app land 뒤 이 task 전까지 개발 data root의 `@lophn/ui` 1.1.0 사본에 `native/`가 섞여 있었을 수 있고, 이 줄이 들어가면 core가 시작할 때 `installCopy`가 사본을 다시 쓴다). `SUPPORT_SOURCES`에 `{source: "design/native", skip: []}`를 더하고 `VENDOR_RULES`에 `@lophn/ui-native` 규칙을 더한다: `files`로 kit이 쓰는 `design/tokens.ts`와 markdown 모델 file(`components/reading/markdown/{model,stream,parse,cache}.ts`와 그 file이 다시 가져오는 것을 따라가 닫힌 집합)을 `vendor/design/…`로, `rewrite`로 kit file의 `../../tokens.ts`와 `../../components/reading/markdown/*.ts` specifier를 사본 안 상대 경로로 바꾼다(본보기 `DECLARATION`·`AGENT`). 사본이 자기 완결인지 `install_test.ts`에 사본을 푼 뒤 모든 상대 import가 사본 안 file로 풀리는지 보는 test를 더한다.
2. `packages/design/native/package.json`: 판 0.1.0, `supported_from` 0.1.0 그대로. `peerDependencies`를 `mobile-build-phone`이 고른 설치 안에 맞춘다(안 A면 앱 `devDependencies`로 깔 것이라 peer 그대로, 다른 안이면 그 보고의 지시). `dependencies`의 `@lophn/i18n`은 정확한 판 그대로.
3. `packages/design/native/guide.md`: 앱 agent가 이 저장소를 모른 채 읽고 폰 화면을 쓸 수 있게 한국어로 쓴다(다른 SDK guide의 절 구성을 따른다: 목적, 공개 API, 요구 permission(없다), peer 의존 표, version 정책, 사용). 담을 것:
   - 이 kit은 폰 화면(`src/screens/<key>/phone.tsx`, `places: ["phone"]`)의 조각이다. desktop 화면의 `@lophn/ui`와 섞지 않는다. 폰 앱이 같은 kit 판을 가지고 있어 화면 bundle에 kit이 들어가지 않는다(build가 external로 둔다). 새 kit 판으로 지은 화면은 옛 폰 앱에서 열리지 않을 수 있다(폰 앱을 올려야 한다).
   - 조각 목록은 `mod.ts`의 export와 윗줄을 그대로 옮긴다(이름, 한 줄 쓰임새). 손으로 다시 설명하지 않는다.
   - 폰 규칙: 누르는 곳 44 이상, hover가 없다, 등록한 기준 폰의 폭에 고정해 그린다(반응형을 만들지 않는다. 폭은 `lophn app phone-target`), `UiProvider`는 폰 앱의 root가 이미 둔다(화면이 다시 두지 않는다), 화면 root는 `Screen`.
   - 화면이 쓸 수 있는 module은 `PHONE_HOST_MODULES`뿐이다(react, react-native, kit, `@lophn/app-ui-native`, `lucide-react-native`, `react-native-svg`…). 그 밖의 native module, `fetch`, network는 없다. 화면은 데이터를 bridge(operation 호출과 event)로만 받는다. 이미지는 kit의 icon과 `data:` URI뿐이다.
   - desktop에서 `lophn tab open --preview <app> --screen <key>`로 확인하는 것은 react-native-web이라 실제 폰과 다를 수 있다(입력, 키보드, 스크롤, 글꼴). 마지막 확인은 사람이 폰에서 한다.
4. 메모 `ui-native-0.1.0.md`(영어, `Previous: none`, `Breaking: no`): 새 SDK part이고 폰 화면을 쓰려면 앱 `package.json`·`lophn.ts`의 `sdk_dependencies`에 이 판을 더하는 방법(peer 의존 포함), "Nothing is required of an existing app". 지침 file(`guide.md`)이 처음 생기는 판이라 Instruction diff는 이 part의 새 guide 전체가 아니라 "앱 agent가 폰 화면을 쓸 때 읽는 곳"을 가리키는 한 문단으로 둔다(앱 template의 `AGENTS.md.tmpl`은 `mobile-agent-guidance`가 고친다).
5. flows catalog: SDK export와 test file이 바뀐 줄은 이 task가 project-docs/flows 에서 고친다(자기 줄만. 꼴은 .claude/skills/flows/SKILL.md). `node tools/flows.ts check`가 통과해야 한다.

## 끝남

- `npm run check`(특히 `node tools/check-sdk-notes.ts`와 `install_test.ts`)가 통과한다. core를 `project-docs/plan/tools/lead/boot.sh`로 띄워 `<data root>/sdk/ui-native/0.1.0/`이 풀리고 `lophn package read @lophn/ui-native`(guide)가 읽히는지 본다(개발 data root만).
- 위험 test: "`@lophn/ui-native` 설치 사본은 자기 완결이고(사본 안 모든 상대 import가 사본 안에서 풀린다) `@lophn/ui` 사본에는 `native/`가 들지 않는다"(사본에 꼭 필요한 것이 빠지면 앱 build가 깨지고, `@lophn/ui` bytes가 바뀌면 이미 설치된 판과 어긋난다)
- 남지 않음: 없음(더하기뿐).
- `project-docs/flows/`가 check를 통과한다.

## 보고

`.claude/skills/orchestrate/brief-template.md`의 "보고" 꼴. 더해서: vendor 규칙이 담은 file 목록, 사본 크기, guide의 절 목록, `mobile-build-phone`의 설치 안을 따라 `package.json`에서 바꾼 것.
