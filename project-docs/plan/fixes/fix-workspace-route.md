# fix-workspace-route

screens-workspace-space(`233a7575`)가 desktop `Route`에 `session`, `projectManager: {context, check}`, `open: {path, line?}`를 두었지만 project 창의 `Workspace`가 이 값을 받지 않는다. 그래서 다른 project의 session toast, Project Manager toast, palette 파일 행이 project 창을 띄우는 데서 멈춘다. 받아서 연다.

- 단위: screens-project (wave 3 고침)
- 소유(이 task만 고친다):
  - `packages/shell/renderer/workspace/workspace.tsx`(props와 처음 열 때 한 번 여는 effect)
  - `packages/shell/renderer/desktop/router.ts`·`main.tsx`에서 `Workspace`에 넘기는 줄
  - `packages/shell/renderer/conversation/agent-view.tsx`의 `contextChips` 받는 줄(165행 근처)과 `conversation/composer/agent-composer.tsx`의 chip 표시·보내기
- 읽을 것: `/home/pyosechang/projects/lophn/project-docs/plan/fixes/README.md`, `git show 233a7575 -- packages/shell/renderer/desktop/router.ts`, `workspace.tsx`의 `openAgent`·`openSession`·파일 탭 열기
- 계약: 고치지 않는다(renderer 안 prop이다).

## 할 일

1. `Workspace`에 `session?: string`, `projectManager?: {context: string; check: string}`, `open?: {path: string; line?: number}`를 더한다. 값이 오면 한 번: session 탭을 열고, Project Manager 탭을 위반 chip과 함께 열고(`askProjectManager(chips)`가 있으면 그것), 파일 탭을 그 줄로 연다.
2. desktop이 `Route`의 값을 그대로 넘긴다.
3. (fix-context-pm이 넘긴 것) composer가 `contextChips?.[0]` 하나만 보여 준다. 위반 [Send all]과 위반 toast는 위반마다 chip을 만드니, composer가 chip 여러 개를 보이고 보낼 때 모두 싣게 한다. 하나씩 지울 수 있으면 좋다.
4. (fix-context-pm이 넘긴 것) Violations 단추의 `askProjectManager(chips)`는 늘 새 PM 탭을 연다. toast 경로처럼 그 project의 열린 PM session이 있으면 그것을 쓰고 chip을 붙인다(lead 결정).
5. 확인: `deno task check:full`, `deno run -A packages/shell/renderer/build.ts`.

## 끝남

- check:full과 renderer build 통과.
