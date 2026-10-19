# ds-shell-launcher

런처를 project와 domain 둘을 다루는 화면으로 바꾼다. Project 카드(폴더, 이은 domain), Domain 카드(목적, 앱, 이은 project, project 없는 domain), 등록 dialog 둘(Project는 폴더만, Domain은 이름과 목적), 이은 쪽을 보고 잇고 끊는 화면(연결 확인 포함), 보관과 복원을 만든다. `ds-project-registry`가 임시로 둔 "project를 등록하면 같은 이름의 domain을 만들어 잇는" 흐름은 없앤다.

**화면 모양은 사람이 Drafts에서 고른다(`ds-wireframe-drafts`).** lead가 이 task를 띄우기 전에 아래 "고른 안" 칸에 고른 page id를 적는다. 칸이 비어 있으면 시작하지 말고 lead에게 알린다. 고르지 않은 안은 만들지 않는다.

- 단위: shell (wave 3)
- 선행: ds-project-registry
- 소유(이 task만 고친다):
  - `packages/shell/renderer/desktop/launcher`
  - `tools/wireframes/pages/screens/launcher.tsx`
  - `tools/wireframes/pages/screens/launcher`
  - `tools/wireframes/mock/launcher`
- 읽을 것:
  - skill: `.claude/skills/ui-design/SKILL.md`("모든 화면의 규칙", "새 화면 만들기"), `.claude/skills/wording/SKILL.md`
  - 계획: `project-docs/plan/domain-split/README.md`("정한 것"의 연결, 화면 말, 화면 모양), `tasks/ds-project-registry.md`(`project.*`·`domain.*` route, `domain.link_project`)
  - roadmap: `project-docs/products/roadmap/domain.md`의 "project와 domain"(연결은 권한 결정이라 사람만)
  - 본보기(화면): Drafts의 `dp-launcher-*`, `dp-open-*`, `dp-link-*`, `dp-register-*`, `dp-empty-states`(`tools/wireframes/drafts/domain-project/`). 지금 화면은 `tools/wireframes/pages/screens/launcher/launcher-pages.tsx`
  - 코드: `packages/shell/renderer/desktop/launcher/{launcher.tsx,project-card.tsx,register-dialog.tsx,apps-section.tsx,archived-section.tsx,card-menu.tsx,source.ts,model.ts}`, `…/launcher/projects/{source,core-source,model,project-detail,subfolder-picker}.ts(x)`, `…/launcher/projects/testdata/fake-projects.ts`
  - 호스트(이 task가 고치지 않는다): `packages/shell/renderer/desktop/{main.tsx,entry.tsx}`는 `ds-shell-window`가 `Launcher`의 새 props를 잇는다.
- 계약:
  - 쓰는 것: `projectApi`(`packages/protocol/projects/project-api.ts`), `domainApi`(`packages/protocol/domains/domain-api.ts`)의 route와 record 모양, `commandCall`(`packages/shell/renderer/command-call.ts`).
  - 내놓는 것(`ds-shell-window`가 host에서 잇는다): `Launcher`의 새 props `domains?: DomainsSource`, `onDomain?: (domain: string) => void`. `DomainsSource`와 `domainsCoreSource(core, …)`를 `desktop/launcher/domains/`에 둔다. `ProjectsSource`는 그대로 쓰되 `ProjectItem`에 `domains`가 생기고 `purpose`가 없어진다.

## 고른 안

(lead가 띄우기 전에 채운다: 런처 모양 `dp-launcher-…`, 열기 `dp-open-…`, 잇기 `dp-link-…`)

## 할 일

1. **source.** `launcher/projects/source.ts`: `ProjectItem`에서 `purpose`를 빼고 `domains: readonly {id, name, title, archived}[]`를 더한다. `launcher/projects/core-source.ts`와 `model.ts`, `project-detail.tsx`에서 목적 칸을 지운다. `register`는 `project.create`만 부르고 임시로 둔 domain 생성·연결 호출을 지운다. 새 `launcher/domains/{source,core-source,model}.ts`: `DomainItem {id, title, purpose, revision, archived, projects: [{id,title,archived}]}`, `DomainsSource {list, register, save, setArchived, link, unlink}`. core 호출은 `domainApi`의 `register/edit/archive/unarchive/linkProject/unlinkProject`와 `domain.list`(`commandCall`로 revision 비교)다. 오류는 `SourceResult`로 돌려주고 기존 projects source처럼 core route 이름은 `core-source.ts`만 안다.
2. **launcher.** `launcher.tsx`와 `project-card.tsx`, 새 `domain-card.tsx`: 고른 안대로 Project 카드와 Domain 카드를 그린다. 카드 chip은 이은 상대를 보이고(project 없는 domain은 "No project" 표시), `onDomain`으로 domain을 연다. `archived-section.tsx`가 domain도 보관·복원한다. `card-menu.tsx`는 domain 메뉴를 더한다.
3. **등록.** `register-dialog.tsx`(Project: 이름과 폴더, 하위 폴더, 목적 칸 없음)와 새 `domains/register-dialog.tsx`(Domain: 이름, 목적, 처음 이을 project 선택 0개 이상 — 고른 project마다 만든 뒤 `domain.link_project`를 차례로 부른다).
4. **잇기.** 고른 안대로 project detail 또는 domain detail(또는 둘, 또는 Settings 표 — 고른 안이 정한다)에 연결 section을 둔다. 잇기 전에는 확인 dialog를 거친다: "{domain}의 agent가 {project} 폴더를 읽고 쓰게 된다" 뜻을 쓰고, 끊을 때 확인에는 "agent가 이 폴더를 못 보게 된다"를 쓴다. 보관된 상대는 목록에서 뺀다. 연결은 사람의 click에서만 일어난다(화면 밖 호출 경로를 만들지 않는다).
5. **fake와 gallery.** `launcher/projects/testdata/fake-projects.ts`, 새 `launcher/domains/testdata/fake-domains.ts`의 data를 Drafts의 mock(project 셋, domain 넷, 한 project에 domain 둘, 한 domain에 project 둘, project 없는 domain)과 같은 모양으로 둔다. `tools/wireframes/pages/screens/launcher.tsx`·`launcher/launcher-pages.tsx`·`mock/launcher/`를 새 화면으로 고친다. `Desktop` 호스트가 아직 새 props를 안 넘기므로 gallery 페이지는 `Launcher`를 fake source로 직접 그린다(호스트 연결은 `ds-shell-window`가 한 뒤 `MockDesktop`으로 돌린다). 옛 모양(project에 목적 칸)의 gallery 페이지와 fake는 지운다.
6. **wording.** 새 문구는 key로 쓴다(`packages/design/wording/catalog/workspace.ts`의 `launcher.*`, `projects.*`, 새 `domains.*`). 표시 말은 "Project", "Domain", "Domain Engineer", "App"이다. `deno run --allow-read --allow-write packages/design/wording/generate.ts`로 생성물을 만든다(`*.placeholders.ts`는 손으로 고치지 않는다). 카탈로그에 key만 더하고 남의 key는 고치지 않는다.
7. **Drafts 정리.** 고른 안의 Drafts page는 지우지 않는다(`ds-leftover`가 지운다).

## 끝남

- `deno task check`가 통과한다. `deno run -A packages/shell/renderer/build.ts`로 renderer bundle이 서고 `deno task wireframes`가 된다.
- 위험 test: 없음(화면이다). 연결이 사람의 click에서만 일어나는 것은 core의 `user` 전용 command가 지킨다(`ds-project-registry`의 test).
- 남지 않음:
  - `grep -rn "purpose" packages/shell/renderer/desktop/launcher/projects`가 0줄이다.
  - `grep -rnE "domain.create|domainApi.register" packages/shell/renderer/desktop/launcher/projects`가 0줄이다(임시 흐름 삭제).
- (화면) `deno task wireframes`가 되고, gallery의 `launcher-*` page가 옮긴 component로 그려진다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: 호스트가 잇는 목록(`Launcher` props, `domainsCoreSource`, fake source), wording 생성 결과, gallery `pages/index.ts`는 바꾸지 않았음
- 안 쓰게 된 export
- 정한 것: 고른 안에 답이 없던 세부(확인 문구, 빈 상태 문구, 접힌 상태)
- 넘길 줄: 호스트(`main.tsx`, `entry.tsx`)에서 필요한 한 줄
- 계약 바꾸기 요청: route 모양 변경이 필요하면 적는다
- **무겁게 짠 것**: `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 런처가 domain을 열면(`onDomain`) 호스트가 domain 창을 아직 모른다(`ds-shell-window`가 한다). 그 밖에 안 되는 동작.
