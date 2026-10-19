# de-drafts

domain이 새로 만드는 화면을 gallery의 Drafts에 먼저 그린다. 사람이 고를 모양마다 두 가지씩 그려 놓고, 사람이 고르면 그 모양이 renderer task(`de-shell-domain-list`, `de-shell-operator-domains`, `de-shell-artifact-domain`)의 본보기가 된다. renderer 코드는 이 task가 만들지 않는다(고르기 전에는 renderer에 올리지 않는다).

- 단위: drafts (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `tools/wireframes/drafts/`
  - `tools/wireframes/mock/domain/`(새 폴더)
  - `packages/design/wording/catalog/domain.ts`(새 file)
  - `packages/design/wording/catalog/domain.placeholders.ts`(새 file, `deno task wording`이 만든다)
  - `packages/design/wording/en.ts`
  - `packages/design/wording/placeholders.ts`
- 읽을 것:
  - skill: `.claude/skills/ui-design/SKILL.md`("모든 화면의 규칙", "새 화면(page) 만들기"), `.claude/skills/wording/SKILL.md`
  - architecture: `project-docs/architecture/ui-kit.md`
  - 제품 결정: `project-docs/plan/domain-entity/README.md`의 "화면", `project-docs/products/roadmap/domain.md`의 "그릇과 domain", "domain이 가진 것"
  - 본보기(화면): `tools/wireframes/pages/screens/project-workspace.tsx`와 `project-pages.tsx`(project 창과 sidebar), `tools/wireframes/pages/screens/app-space.tsx`와 `app-space/`(앱 공간), `tools/wireframes/pages/screens/agent-settings.tsx`와 `agent-setup/`(Operator 편집), `tools/wireframes/pages/screens/artifact.tsx`와 `artifact/`(sidebar Artifacts 목록). 이 위치의 renderer component는 `packages/shell/renderer/workspace/sidebar/project-sidebar.tsx`, `artifact-panel.tsx`, `packages/shell/renderer/app-frame/side-panel.tsx`, `packages/shell/renderer/workspace/agents/editor/definition-form.tsx`다.
  - 옛 Drafts 본보기(git): 사람이 고른 뒤 Screens로 옮긴 `e75335eef`(artifact Drafts 여섯 쪽)
- 계약:
  - 쓰는 것: `packages/design/components/`의 component(`@lophn/ui/<분류>`), renderer의 `parts/`, `icons/`. 새 component가 필요하면 만들지 말고 가까운 것으로 그리고 "정한 것"에 적는다.
  - 내놓는 것: Drafts page id(주소라 정하면 바꾸지 않는다)와 각 page가 renderer의 어디로 갈지를 보고의 표에 적는다.

## 할 일

사람이 골라야 하는 질문마다 두 모양(A·B)을 그린다. 모든 page는 fake data(`tools/wireframes/mock/domain/`)로 그리고 상태는 fake 설정과 `mock/drive.ts`의 drive로 건다. 화면 문구는 새 wording 영역 `domain`의 key로 쓴다(`deno task wording`으로 생성물을 맞춘다).

1. project 창에서 domain 보기·만들기 (`domain-project-a`, `domain-project-b`)
   - A: sidebar의 네 번째 탭 "Domains". 줄마다 이름·한 줄 목적·kind 수·skill 수·artifact 수. 위쪽에 [New domain]. 줄 menu에 Open DOMAIN.md, Archive.
   - B: Agent 탭 위쪽에 domain 칩 줄(칩 하나가 domain 하나, 끝에 + 칩). 칩 menu에 같은 항목.
   - 둘 다 domain이 0개인 project의 빈 상태와 [New domain] dialog(name은 slug, title, 목적 한 줄) 상태 page를 하나씩 더한다(`domain-project-empty`, `domain-create-dialog`).
2. 앱 공간에서 domain 보기·만들기 (`domain-app-a`, `domain-app-b`)
   - A: 앱 공간 위쪽 바의 agent select 옆에 domain 칩 줄.
   - B: 앱 상세 패널에 "Domains" 절(줄마다 tool 수, public tool 수).
   - 앱의 마지막 domain 줄은 Archive가 꺼져 있고 이유를 tooltip으로 보이는 상태를 하나 그린다(`domain-app-last`).
3. Operator 편집에서 domain 고르기 (`domain-operator-a`, `domain-operator-b`)
   - A: "Domains" 칸(다중 선택. 비어 있으면 "All domains of this project" 안내). Skills 칸은 고른 domain의 skill만 목록에 나온다.
   - B: Skills 칸 위에 domain 체크 목록, 체크한 domain별로 skill 묶음.
   - 앱 그릇의 Operator(지침 층 안내가 다르다)는 A로만 한 page 더 그린다(`domain-operator-app`).
4. Artifacts 목록이 domain 단위가 되는 것 (`domain-artifacts-a`, `domain-artifacts-b`)
   - A: domain 제목 아래 artifact 줄을 묶어서(접기 가능).
   - B: 한 목록에 domain 배지와 위쪽 domain 선택(select).
   - domain이 하나뿐일 때의 모양도 그린다(`domain-artifacts-single`): 배지·묶음 제목을 없애는지 보인다.
5. 각 page는 `tools/wireframes/drafts/domain/pages.tsx`(새 file) 한 곳에서 `draftsArea.pages`(`tools/wireframes/drafts/index.tsx`)에 올린다. title은 영어, description은 한국어 한두 문장이다(어느 질문의 A·B인지 적는다).
6. 위 질문을 사람이 한 번에 보고 고르도록 gallery에서 질문 순서로 놓는다.

## 끝남

- `deno task check`가 통과한다.
- `deno task wireframes`가 되고 gallery의 Drafts에 위 page가 모두 그려진다. 밝은 테마와 어두운 테마를 한 번씩 본다.
- 위험 test: 없음(화면이다)
- 남지 않음: 없음(새 file이다)

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: wording 생성물(`deno task wording`)
- 안 쓰게 된 export
- 정한 것: 새 component 대신 쓴 가까운 component, fake data가 가정한 domain 이름과 개수
- 넘길 줄
- 계약 바꾸기 요청
- **page 표**: page id / 어느 질문의 A·B / 고르면 갈 renderer 위치(위 "읽을 것"의 file) / 필요한 fake source 칸
- **무겁게 짠 것**
- **알려진 미완 동작**
