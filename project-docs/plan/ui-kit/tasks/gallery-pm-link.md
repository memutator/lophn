# gallery-pm-link

gallery Contexts 화면의 Project Manager 대화에서 눌러서 탭을 여는 글 링크(`drafts/link.tsx`)를 지운다. renderer에 없는 승인 전 조각이 Screens page에 섞이지 않게 한다.

- 단위: kit-fix (wave 4)
- 선행: 없음
- 소유(이 task만 고친다):
  - `tools/wireframes/pages/screens/contexts/pm-session.tsx`
  - `tools/wireframes/drafts/link.tsx`
  - `tools/wireframes/drafts/compose.module.css`
- 읽을 것:
  - architecture: `project-docs/architecture/ui-kit.md`의 "gallery가 정본이다"(Screens는 renderer를 import한 화면, Drafts는 실험)
  - skill: `.claude/skills/ui-design/SKILL.md`
  - 지금 코드: `pm-session.tsx`가 `Link`를 두 번 쓴다(위반 문서 두 개를 여는 링크). 이 대화를 그리는 page는 Screens `contexts` 영역의 `new-agent-toast-opened`, `new-violation-session-open`이다(`pages/screens/contexts.tsx`).
- 계약:
  - 쓰는 것: 없음
  - 내놓는 것: `pm-session.tsx`가 drafts를 import하지 않는다. `drafts/link.tsx`가 없다. `pmNewTab`, `pmWorkingTab` export는 그대로다(`context-body.tsx`, `context-pages.tsx`가 쓴다).

## 할 일

근거: 사람이 정했다. 링크를 renderer component로 만들지 않고 지운다.

1. `pm-session.tsx`에서 `Link` 두 곳을 지우고 그 자리의 글(문서 이름)은 그냥 글로 둔다. 문장이 어색해지지 않게 앞뒤 글만 다듬는다. `Link` import와, 그것 때문에만 쓰이던 `open`·`documentTab`·`VIOLATIONS` 같은 이름이 쓰이지 않게 되면 지운다(다른 곳이 쓰면 둔다).
2. `drafts/link.tsx`를 지운다. 이 file을 쓰는 곳이 `pm-session.tsx`뿐인지 먼저 `grep -rn "link.tsx" tools/wireframes`로 본다.
3. `drafts/compose.module.css`에서 `.link`와 그 hover·focus 규칙을 지운다. `.ways*`·`.way*`·`.searchTitle`은 `drafts/ways-page.tsx`가 쓰니 둔다.
4. 문서는 lead가 고친다.

## 끝남

- `deno task check`가 통과한다(step `kit` 포함).
- `deno task wireframes`가 된다.
- 위험 test: 없음
- 남지 않음:
  - `grep -rn "drafts/" tools/wireframes --include=*.ts --include=*.tsx | grep -v "^tools/wireframes/drafts/" | grep -v dist`가 `pages/index.ts`(drafts 영역 import), `mock/app-space/orders-view.tsx` 둘만 남는다.
  - `ls tools/wireframes/drafts/link.tsx`가 없다. `grep -n "\.link" tools/wireframes/drafts/compose.module.css`가 0줄이다.
- (화면) `new-agent-toast-opened`, `new-violation-session-open`의 대화가 링크 없이 그려진다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: 없음
- 안 쓰게 된 export: 없음
- 정한 것: 링크 자리 글을 어떻게 다듬었는지
- 넘길 줄: 없음
- 계약 바꾸기 요청: 없음
- 무겁게 짠 것: 없음
- 알려진 미완 동작: 없음이 기본
