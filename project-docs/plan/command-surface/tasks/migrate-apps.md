# migrate-apps

사람 data root의 앱 둘(Mahas, Masup)을 새 선언(operation과 command 두 층)으로 옮길 변경을 사본에서 준비한다. 사람 data root에는 쓰지 않는다(roadmap 16, 이번만의 예외).

- 단위: apps (wave 2)
- 선행: 없음
- 소유(이 task만 고친다):
  - `.dev-data/migrate-apps/**`
- 읽을 것:
  - roadmap: `project-docs/products/roadmap/command-surface.md`의 "왜"(사람의 말), "정한 것" 10~12, 16
  - architecture: `project-docs/architecture/app-call.md`(두 층, operation 막기, 큰 결과)
  - 새 SDK와 template: `packages/sdk/{cap-tool,app-ui,declaration}/guide.md`, `packages/core/apps/packages/template/app/`
  - 지침: `packages/core/agent-places/skills/design-app/SKILL.md`
- 계약:
  - 쓰는 것: 새 선언(`operations[]`, `commands[]`), `@lophn/cap-tool` 2.0.0 `handle`, `@lophn/app-ui` 2.0.0 `useOperation`·`OperationButton`, 화면 bridge `lophnApp.callOperation`

## 원본 (읽기만)

- Mahas: `~/.lophn/apps/app_01m68fnwzw5meqaej7txs4aev2/source`
- Masup: `~/.lophn/apps/app_01m68zc050efye67mjbehas1ed/source`
- `~/.lophn` 아래에는 아무것도 쓰지 않는다(file, git branch, git config, `npm install` 모두). `git clone`으로 읽어 오는 것만 한다. lophn.db와 다른 data는 읽지도 않는다.

## 할 일

1. 두 원본을 `.dev-data/migrate-apps/{mahas,masup}`로 `git clone`하고 각각 branch `command-surface`에서 일한다.
2. 선언을 두 층으로 나눈다.
   - 화면이 쓰는 것은 operation이다(`{name, title, effect}`).
   - 바깥 command는 agent·다른 앱·job이 물을 의미 단위만 둔다. 결과가 작다.
   - Mahas 초안: `session.usage`(harness와 session id로 그 세션의 token 소모량, 비용, cache hit rate·절감), `usage.sync`(지금 job이 이 이름으로 부를 수 있어 같은 이름으로 둔다).
   - Masup 초안: `quota.list`(계정마다 남은 한도), `quota.refresh`(job이 부를 수 있어 같은 이름). login·account 관리는 operation이다.
   - command handler는 앱 code의 같은 domain 함수를 감싼다. 다른 것이 더 맞으면 바꾸고 이유를 보고한다.
3. handler 등록(`handle`), 화면(`useOperation`·`OperationButton`·`callOperation`), SDK 고정 판(`package.json`과 선언의 `sdk_dependencies`, 2.0.0), template이 관리하는 file(`AGENTS.md`의 lophn-managed block, `tests/declaration_test.ts`, `src/handlers.ts`)을 새 template에 맞춘다.
4. Mahas 세션 목록의 200행 제한(앱 commit `7194b6c`, lophn의 옛 결과 상한을 피하려던 것)을 푼다. 화면 operation은 이제 8 MiB까지 받는다.
5. 각 사본에서 앱 test, type check, 화면 build를 통과시킨다. SDK 사본(`.lophn/sdk`)은 worktree의 `packages/sdk`에서 template install 규칙대로 채운다(`packages/core/apps/packages/template/install.ts`). 선언은 `packages/protocol/apps/declaration`의 `validateDeclaration`(앱의 domain 이름 `mahas`, `masup`를 주고)으로도 검사한다.
6. 사본의 branch에 commit한다(영어 명령형 한 줄과 본문).

## 끝남

- 두 사본에서 앱 test, type check, build, 선언 검사가 통과한다.
- `~/.lophn` 아래 file의 mtime과 두 원본 저장소의 `git status`·branch 목록이 시작 때와 같다(시작 때 기록해 두고 끝에 대조한다).

## 보고

- 앱마다: operation 목록, command 목록(이름, 한 줄 뜻, effect, public), 바꾼 file
- 통과한 check
- 정한 것
- 전환 때 할 일(사람 data root에서 할 명령 순서)
- **무겁게 짠 것**: 없으면 "없음"
- **알려진 미완 동작**: 없으면 "없음"
