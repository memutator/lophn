# phone-runtime-spike

폰에서 사용자 앱의 backend와 data를 돌릴 수 있는지 조사하고 판정한다. 제품 코드를 고치지 않는다.

- 단위: spike (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `reports/phone-runtime-spike.md`(새 file)
- 읽을 것:
  - roadmap: `project-docs/products/roadmap/mobile.md`의 "폰에서 혼자 도는 앱"
  - `packages/sdk/cap-store/{store,connection}.ts`, `packages/sdk/cap-tool/handlers.ts`, `packages/base/changeset-invert.ts`
  - `tests/support/app/sample/`(본보기 앱)
- 계약:
  - 쓰는 것: 없음
  - 내놓는 것: 판정과 근거가 든 보고서

## 할 일

1. 답할 질문:
   - Expo(React Native)의 JavaScript engine에서 SDK만 쓰는 앱 backend를 한 file로 bundle해 돌릴 수 있나. `node:async_hooks`(호출 context) 없이 되는 길은 무엇인가.
   - iOS와 Android에서 SQLite session extension(`createSession`, `changeset`, `applyChangeset`)을 쓸 수 있는 SQLite binding이 있나. 없으면 무엇을 빌드해야 하나.
   - 폰용 Node(nodejs-mobile 등)를 싣는 길은 지금 판, `node:sqlite` 지원, iOS 제약이 어떤가.
   - changeset을 두 사본 사이에 주고받을 때 충돌을 "나중에 고친 것이 이긴다"로 풀 수 있나(SQLite의 conflict handler). 정수 자동 증가 id는 무엇으로 막나.
2. 문서 조사에 더해, 폰 도구 없이 되는 확인은 한다: 본보기 앱의 backend를 esbuild로 한 file로 bundle해 Node 내장 module 없이 도는지, `node:sqlite`로 두 사본 사이에 changeset을 주고받고 conflict handler로 푸는지.
3. 폰 개발 도구(Android SDK, emulator, Xcode)를 설치해야 하는 확인은 하지 않고 보고에 "남은 확인"으로 적는다.
4. 보고서: 질문마다 된다 / 조건부 / 안 된다와 근거(문서 link, 돌린 결과), 추천하는 길 하나와 버린 길, SDK와 release 검사가 바뀌어야 하는 곳.

## 끝남

- `reports/phone-runtime-spike.md`가 있고 질문 넷에 판정이 있다.
- 위험 test: 없음
- `packages/`를 고치지 않았다.

## 보고

보고서의 path와 판정 요약, 남은 확인.
