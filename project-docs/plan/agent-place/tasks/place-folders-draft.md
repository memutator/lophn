# place-folders-draft

Project Manager가 `context.draft`로 초안 폴더를 연 같은 turn에 그 폴더에 `file.write`가 되게 한다. turn scope에 폴더를 더하는 길을 `PlaceScope`에 정식으로 두고(`open`), `openDraft`가 성공하면 부른다.

- 단위: place-folders (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/core/lophn-agent/tools/ports.ts`
  - `packages/core/lophn-agent/tools/file/scope.ts`
  - `packages/core/lophn-agent/run-loop/prepare.ts`
  - `packages/core/lophn-agent/run-loop/unwired.ts`
  - `packages/core/agent-roles/tools/context/draft.ts`
- 읽을 것:
  - architecture: `project-docs/architecture/place-session.md`("Project Manager는 그 project 폴더와 열어 둔 초안 폴더")
  - 이슈: `project-docs/issues/place-session.md`의 "PM이 초안 폴더를 연 같은 turn에 쓰면 forbidden이다"(고치려면 A)
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `run-loop`, `agent-tools`, `agent-roles`
  - 지금 코드: `prepare.ts`의 `const scope: { read: string[]; write: string[] } = ...`(405행 근처)와 `scope.read.push(...)`(placeData 뒤, 458행 근처), `tools/ports.ts`의 `PlaceScope`, `tools/file/scope.ts`의 `resolveInPlace(roots: PlaceScope, ...)`, `unwired.ts`의 `scope`
- 계약:
  - 쓰는 것: `ToolContext.scope`(`tools/tool-context.ts`), `bundleOpenDraftRoute`의 결과 `folder`(이미 `openDraft`가 받는다)
  - 내놓는 것: `PlaceScope`에 `open(folder: string): void` 칸. 부르면 그 폴더가 같은 turn의 남은 동안 read와 write에 들어간다(이미 있으면 다시 넣지 않는다). `read`·`write`는 계속 읽기 전용 배열로 보인다.

## 지켜야 할 것

- harness(`packages/core/lophn-agent`)는 `agent-roles`와 domain을 import하지 않는다. 필요한 값은 composition root(`core/main`)가 넘긴다.
- import를 지우려고 다른 module의 표를 SQL로 직접 읽지 않는다. 못 끊으면 `tools/check-deps.ts` 예외로 드러낸다.
- protocol을 바꾸면 쓰는 쪽을 같은 변경에서 고친다. `v2`나 옛 이름 읽기를 두지 않는다.
- 옮기기는 `tools/move-files.ts`로 하고 import를 기계적으로 고친다.

## 정한 것

- `ctx.scope`의 readonly 타입을 형 변환으로 풀지 않고 `open`을 정식 칸으로 둔다. 이유: harness는 role을 몰라 "누가 폴더를 열 수 있나"를 모르고, 열 수 있는 tool은 role 층의 `openDraft`(PM의 tool 목록) 하나다. 형 변환은 타입이 거짓말을 한다.
- 초안 폴더를 여는 규칙(PM만)은 `openDraft`가 PM의 tool이라는 사실로 이미 지켜진다. 여기서 role을 다시 검사하지 않는다.
- Deno 권한(초안 폴더는 data root 아래라 읽기는 열려 있고 쓰기는 `place-folders-wiring`이 연다)은 이 task의 일이 아니다.

## 할 일

1. `tools/ports.ts`의 `PlaceScope`에 `open(folder: string): void`를 더한다. 근거: 이슈 고치려면 A.
2. `tools/file/scope.ts`의 `resolveInPlace` 첫 인자를 `Pick<PlaceScope, "read" | "write">`로 좁힌다(`scope_test.ts`가 `{ read, write }` 값만 넘긴다. 그 test는 고치지 않는다).
3. `run-loop/prepare.ts`가 scope를 `read`·`write` 배열과 `open`(두 배열에 중복 없이 push)을 가진 한 객체로 만든다. 지금 `placeData` 뒤에 `scope.read.push(...)`로 채우는 것은 그대로 둔다.
4. `run-loop/unwired.ts`의 `scope`에 아무것도 하지 않는 `open`을 더한다.
5. `agent-roles/tools/context/draft.ts`의 `openDraft`가 `bundleOpenDraftRoute`가 성공하면 `ctx.scope.open(folder)`를 부른다(결과를 돌려주기 전에).

## 끝남

- `deno task check`가 통과한다.
- 위험 test: 없음(`open`은 두 배열에 push하는 한 줄이다. 쓰기 권한 경계는 `resolveInPlace`가 지키고 `scope_test.ts`가 이미 본다).
- 남지 않음: `grep -rn "as { read: string\[\]; write: string\[\] }" packages`가 0줄이다(형 변환을 만들지 않았다는 뜻).

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: 없음
- 안 쓰게 된 export(남이 쓰던 것은 지우지 않는다)
- 정한 것
- 넘길 줄(`PlaceScope`를 만드는 다른 곳을 맞춘 줄이 있으면 file과 이유)
- 계약 바꾸기 요청
- **무겁게 짠 것**
- **알려진 미완 동작**
