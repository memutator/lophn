# ds-wireframe-drafts

project와 domain이 갈라진 뒤의 화면 모양을 Drafts(gallery 안에서만 그리는 실험)로 그려 사람이 고르게 한다. 고르는 것은 셋이다: project 창이 연결된 domain과 그 agent를 어떻게 보이는지, project가 없는 domain을 어디서 여는지, project와 domain을 잇는 화면. 이 task는 renderer를 고치지 않는다. 사람이 고른 뒤 `ds-shell-launcher`, `ds-shell-agents`, `ds-shell-window`가 Drafts의 고른 안을 renderer로 옮긴다.

- 단위: drafts (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `tools/wireframes/drafts/domain-project`
  - `tools/wireframes/drafts/index.tsx`
- 읽을 것:
  - skill: `.claude/skills/ui-design/SKILL.md`("모든 화면의 규칙", "새 화면(page) 만들기" 4~7, Drafts), `.claude/skills/wording/SKILL.md`
  - 계획: `project-docs/plan/domain-split/README.md`의 "정한 것"(나누는 선, 연결, 화면 말, 화면 모양)
  - roadmap: `project-docs/products/roadmap/domain.md`의 "project와 domain (2026-10-19 다시 정함)"
  - 지금 화면(바뀌는 부분만 그린다): `tools/wireframes/pages/screens/launcher/launcher-pages.tsx`(런처, project detail, 등록 dialog), `tools/wireframes/pages/screens/project-window.tsx`·`project-workspace.tsx`(project 창, sidebar의 Explorer / Agent / Artifacts 탭), `tools/wireframes/pages/screens/artifact/sidebar.tsx`(Artifacts 탭), `tools/wireframes/pages/screens/agent-tab/scenes.tsx`, `tools/wireframes/pages/screens/agents-tab.tsx`(Agents 탭 본문)
  - 본보기(Drafts 꼴): `tools/wireframes/drafts/index.tsx`(`draftsArea`, 지금 `pages: []`), `tools/wireframes/pages/types.ts`
  - 부품: `packages/design/components/*/mod.ts`(위 줄 주석이 목록), `packages/shell/renderer/desktop/launcher/project-card.tsx`·`launcher.module.css`, `packages/shell/renderer/workspace/sidebar/project-sidebar.tsx`
- 계약:
  - 쓰는 것: `@lophn/ui/*` component, renderer의 기존 component(읽기 import만. renderer를 고치지 않는다).
  - 내놓는 것: gallery Drafts 묶음의 page id와 아래 "고를 것" 표. page id는 `dp-`로 시작하고 한 번 정하면 바꾸지 않는다.

## 알아 둘 것(사람이 고를 근거)

- project는 가벼운 폴더 묶음이다: 이름, 폴더, 창(Explorer, terminal, editor), project 지침(`LOPHN.md`). domain은 책임 경계다: Domain Engineer, Operator, kind, 앱, skill, artifact, 권한.
- 둘은 N:M이다. project 하나에 domain 여럿, domain 하나에 project 여럿, domain에 project 0개(앱 data만 있는 domain)도 된다.
- 연결과 끊기는 사람만 한다. domain을 project에 이으면 그 domain의 agent가 그 폴더를 읽고 쓰게 되므로 권한 결정이다. 이 사실이 화면에 보여야 한다(잇기 전 확인).
- 화면 말은 "Project", "Domain", "Domain Engineer", "App"이다.
- project 창의 sidebar는 지금 Explorer / Agent / Artifacts 세 탭이다. Agent 탭은 PM과 Operator를 보이고, Artifacts 탭은 artifact 목록을 보인다. 연결 뒤에는 이 두 탭이 연결된 domain 여럿의 것을 보여야 한다.

## 할 일

1. mock data 한 벌을 `tools/wireframes/drafts/domain-project/data.ts`에 둔다(근거: `tools/wireframes/mock/`는 다른 task가 쓰므로 거기에 두지 않는다). 다 같은 data를 쓴다.
   - project 셋: `lophn`(폴더 둘), `tax-docs`(폴더 하나), `home`(폴더 하나). 하나는 보관됨.
   - domain 넷: `eval`(project `lophn`), `product`(`lophn`과 `home`), `tax`(`tax-docs`, 앱 있음), `grocery`(project 없음, 앱 data만).
   - domain마다 Domain Engineer 하나, Operator 0~2, artifact 0~3. 한 project(`lophn`)에 domain 둘이 이어진 경우와 domain 하나(`product`)에 project 둘이 이어진 경우가 반드시 들어가야 한다.
2. 아래 page를 그린다. 각 page의 `description`(한국어 한두 문장)에 어느 안인지와 안의 차이를 쓴다. title은 영어다. 문구는 영어 literal로 직접 써도 된다(`tools/wireframes`는 wording 검사 대상이 아니다. wording key는 renderer 단계에서 만든다).
3. `tools/wireframes/drafts/index.tsx`의 `draftsArea.pages`에 page를 올린다(영역은 그대로 쓴다. `pages/index.ts`의 `GROUPS`를 고치지 않는다). CSS는 `tools/wireframes/drafts/domain-project/` 안 `*.module.css`에만 둔다(`tools/check-kit.ts`가 그 밖의 CSS를 막는다).
4. `deno task wireframes`로 build하고 `python3 -m http.server`로 gallery를 열어 light·dark 둘 다 눈으로 본다. 좁은 폭(project 창 sidebar 폭 기준)에서 깨지지 않는지도 본다.
5. 보고에 "고를 것" 표를 채운다: 안마다 한 줄 장단(무엇이 싸고 무엇이 어색한지).

### 그릴 page

| 묶음 | page id | 안 | 내용 |
|---|---|---|---|
| 런처 | `dp-launcher-sections` | A | 한 화면에 Projects 카드 section, Domains 카드 section, Apps section을 차례로 쌓는다. 카드에 연결된 상대를 chip으로 보인다(project 카드 → domain chip, domain 카드 → project chip, project 없는 domain은 "No project" 표시). |
| | `dp-launcher-tabs` | B | 위쪽 segmented control `Projects \| Domains`로 한 번에 하나만 보인다. 카드 내용은 A와 같다. |
| 열기 | `dp-open-domain-card` | A | project 없는 domain 카드를 눌러 domain 창을 연다(아래 `dp-window-domain-*`). |
| | `dp-open-palette` | B | 런처 카드는 project만 있고, domain은 palette와 Settings에서만 연다. palette에 Domains 행이 있는 모양을 그린다. |
| 잇기 | `dp-link-from-project` | A | project detail dialog 안 "Domains" section: 모든 domain의 목록에 연결 toggle. |
| | `dp-link-from-domain` | B | domain detail dialog 안 "Projects" section: 모든 project의 목록에 연결 toggle. |
| | `dp-link-matrix` | C | Settings 안 "Links" page: 줄은 domain, 열은 project인 표에서 칸을 눌러 잇고 끊는다. |
| | `dp-link-confirm` | 공통 | 잇기 전 확인 dialog: "Linking lets {domain}'s agents read and write files in {project}'s folders." 끊기 확인 문구(끊으면 agent가 그 폴더를 못 본다). 고른 안과 상관없이 쓴다. |
| 창 | `dp-sidebar-agents-grouped` | A | project 창 sidebar Agent 탭: domain 이름 머리글 아래 그 domain의 Domain Engineer와 Operator를 묶어 보인다. 접을 수 있다. |
| | `dp-sidebar-agents-flat` | B | 한 줄 목록. 줄마다 domain 이름 badge를 단다. |
| | `dp-sidebar-agents-switch` | C | 탭 위쪽에 domain 고르는 select 하나. 고른 domain의 agent만 보인다. |
| | `dp-agents-tab-stacked` | A | Agents 탭(탭 본문, agent 목록과 editor 진입)을 domain마다 section으로 쌓는다. section마다 Domain Engineer와 Operator 목록, 그 domain의 skill·MCP·model 설정으로 들어가는 줄이 있다. |
| | `dp-agents-tab-select` | B | Agents 탭 위쪽에 domain 고르는 control 하나를 두고, 고른 domain 하나의 본문만 그린다(지금 Agents 탭 본문 그대로). |
| | `dp-sidebar-artifacts-grouped` | A | Artifacts 탭을 domain별로 묶는다. |
| | `dp-sidebar-artifacts-flat` | B | 한 줄 목록에 domain badge. |
| | `dp-window-domain-explorer` | A | project가 없는 domain 창: Explorer 탭이 있고 "No project linked. Link a project to browse files." 안내와 [Link project] 단추가 나온다. Agent / Artifacts 탭은 그대로다. |
| | `dp-window-domain-no-explorer` | B | project가 없는 domain 창: Explorer 탭이 없다. 탭은 Agent / Artifacts / App뿐이고, 머리에 연결 안내 한 줄이 있다. |
| 빈 상태 | `dp-empty-states` | 공통 | project에 domain이 없을 때의 Agent 탭(안내 + [Link domain]), domain에 project가 없을 때의 연결 section, 둘 다 없는 첫 실행 런처. |
| 등록 | `dp-register-project` | 공통 | Register project dialog: 이름과 폴더(하위 폴더 포함)만 받는다. 목적 칸이 없다. |
| | `dp-register-domain` | 공통 | Create domain dialog: 이름, 목적, 처음 이을 project를 고르는 선택(0개 가능). |

## 끝남

- `deno task check`가 통과한다(`tools`의 deno check, fmt, lint, style, kit 포함).
- `deno task wireframes`가 되고, gallery Drafts의 위 page가 모두 그려진다.
- 위험 test: 없음(화면이다).
- 남지 않음: `grep -rn "TODO\|FIXME" tools/wireframes/drafts/domain-project`가 0줄이다.
- (화면) renderer(`packages/shell/renderer`)와 `packages/design`을 고치지 않았다: `git diff --name-only`에 그 경로가 없다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: 없음(`drafts/index.tsx`는 이 task 소유다)
- 안 쓰게 된 export: 없음
- 정한 것: mock data의 모양, 안마다 무엇을 그렸는지, 문서에 답이 없어 정한 문구
- 넘길 줄: 없음
- 계약 바꾸기 요청: 없음
- **고를 것**: 위 표의 묶음마다 안 A/B/C의 한 줄 장단과 추천안(이유 한 줄)
- **무겁게 짠 것**: 없음이 정상(Drafts는 버려도 된다)
- **알려진 미완 동작**: 없음
