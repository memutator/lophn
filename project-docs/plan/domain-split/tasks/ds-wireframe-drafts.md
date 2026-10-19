# ds-wireframe-drafts

domain이 project 하나에 속하게 된 뒤의 화면 모양을 Drafts(gallery 안에서만 그리는 실험)로 그려 사람이 고르게 한다. 고르는 것은 셋이다: 런처가 project와 그 안의 domain을 어떻게 보이는지, domain을 어디서 만드는지, project 창이 그 project의 domain들과 그 agent·artifact를 어떻게 보이는지. 이 task는 renderer를 고치지 않는다. 사람이 고른 뒤 `ds-shell-launcher`, `ds-shell-agents`, `ds-shell-window`가 Drafts의 고른 안을 renderer로 옮긴다.

- 단위: drafts (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `tools/wireframes/drafts/domain-project`
  - `tools/wireframes/drafts/index.tsx`
- 읽을 것:
  - skill: `.claude/skills/ui-design/SKILL.md`("모든 화면의 규칙", "새 화면(page) 만들기" 4~7, Drafts), `.claude/skills/wording/SKILL.md`
  - 계획: `project-docs/plan/domain-split/README.md`("정한 것"의 나누는 선, "domain의 project", 화면 말, 화면 모양)
  - roadmap: `project-docs/products/roadmap/domain.md`의 "project와 domain"
  - 지금 화면(바뀌는 부분만 그린다): `tools/wireframes/pages/screens/launcher/launcher-pages.tsx`(런처, project detail, 등록 dialog), `tools/wireframes/pages/screens/project-window.tsx`·`project-workspace.tsx`(project 창, sidebar의 Explorer / Agent / Artifacts 탭), `tools/wireframes/pages/screens/artifact/sidebar.tsx`(Artifacts 탭), `tools/wireframes/pages/screens/agent-tab/scenes.tsx`, `tools/wireframes/pages/screens/agents-tab.tsx`(Agents 탭 본문)
  - 본보기(Drafts 꼴): `tools/wireframes/drafts/index.tsx`(`draftsArea`, 지금 `pages: []`), `tools/wireframes/pages/types.ts`
  - 부품: `packages/design/components/*/mod.ts`(위 줄 주석이 목록), `packages/shell/renderer/desktop/launcher/project-card.tsx`·`launcher.module.css`, `packages/shell/renderer/workspace/sidebar/project-sidebar.tsx`
- 계약:
  - 쓰는 것: `@lophn/ui/*` component, renderer의 기존 component(읽기 import만. renderer를 고치지 않는다).
  - 내놓는 것: gallery Drafts 묶음의 page id와 아래 "고를 것" 표. page id는 `dp-`로 시작하고 한 번 정하면 바꾸지 않는다.

## 알아 둘 것(사람이 고를 근거)

- project는 가벼운 폴더 묶음이다: 이름, 폴더(0개도 된다), 창(Explorer, terminal, editor), project 지침(`LOPHN.md`). domain은 책임 경계다: Domain Engineer, Operator, kind, 앱, skill, artifact, 권한.
- domain은 project 하나에 속한다(1:N). 만들 때 사람이 project를 고르고 나중에 다른 project로 옮기지 못한다. 연결·끊기 화면은 없다. project 없는 domain도 없다(앱 data만 있는 domain도 폴더 0개 project에 속한다).
- 다른 project가 그 domain을 쓰려면 지금 있는 길(공개 tool과 grant)을 쓴다. 새 화면은 없다.
- domain을 만드는 것은 권한 결정이다(그 project의 폴더를 그 domain의 agent가 읽고 쓰게 된다). 만들기 전에 이 사실이 화면에 보여야 한다.
- 화면 말은 "Project", "Domain", "Domain Engineer", "App"이다.
- project 창의 sidebar는 지금 Explorer / Agent / Artifacts 세 탭이다. Agent 탭은 PM과 Operator를 보이고, Artifacts 탭은 artifact 목록을 보인다. 이제 이 두 탭이 그 project의 domain 여럿의 것을 보여야 한다.

## 할 일

1. mock data 한 벌을 `tools/wireframes/drafts/domain-project/data.ts`에 둔다(근거: `tools/wireframes/mock/`는 다른 task가 쓰므로 거기에 두지 않는다). 다 같은 data를 쓴다.
   - project 셋: `lophn`(폴더 둘), `tax-docs`(폴더 하나), `home`(폴더 0개, 하나는 보관됨).
   - domain 넷: `eval`과 `product`(둘 다 project `lophn`), `tax`(`tax-docs`, 앱 있음), `grocery`(project `home`, 폴더 없이 앱 data만).
   - domain마다 Domain Engineer 하나, Operator 0~2, artifact 0~3. 한 project에 domain이 둘(`lophn`)인 경우와 domain이 없는 project 하나가 반드시 들어가야 한다.
2. 아래 page를 그린다. 각 page의 `description`(한국어 한두 문장)에 어느 안인지와 안의 차이를 쓴다. title은 영어다. 문구는 영어 literal로 직접 써도 된다(`tools/wireframes`는 wording 검사 대상이 아니다. wording key는 renderer 단계에서 만든다).
3. `tools/wireframes/drafts/index.tsx`의 `draftsArea.pages`에 page를 올린다(영역은 그대로 쓴다. `pages/index.ts`의 `GROUPS`를 고치지 않는다). CSS는 `tools/wireframes/drafts/domain-project/` 안 `*.module.css`에만 둔다(`tools/check-kit.ts`가 그 밖의 CSS를 막는다).
4. `deno task wireframes`로 build하고 `python3 -m http.server`로 gallery를 열어 light·dark 둘 다 눈으로 본다. 좁은 폭(project 창 sidebar 폭 기준)에서 깨지지 않는지도 본다.
5. 보고에 "고를 것" 표를 채운다: 안마다 한 줄 장단(무엇이 싸고 무엇이 어색한지).

### 그릴 page

| 묶음 | page id | 안 | 내용 |
|---|---|---|---|
| 런처 | `dp-launcher-chips` | A | Project 카드 section 하나(+ Apps section). 카드에 그 project의 domain 이름을 chip으로 보인다(domain이 없으면 "No domain"). domain은 카드 안에서만 보인다. |
| | `dp-launcher-rows` | B | Project 카드를 펼치면 그 안에 domain 줄(이름, 목적, 앱 유무)이 나온다. 접으면 개수만 보인다. |
| 만들기 | `dp-create-in-detail` | A | 런처의 project detail dialog 안 "Domains" section에 [Add domain] 단추. |
| | `dp-create-in-window` | B | project 창 sidebar Agent 탭 머리의 [+ Domain] 단추. 런처에는 domain 만들기가 없다. |
| | `dp-create-dialog` | 공통 | Create domain dialog: 이름, 목적. project는 이미 정해져 고르는 칸이 없고 머리에 "in {project}"로 보인다. 확인 문구: "{domain}'s agents will be able to read and write files in {project}'s folders." |
| | `dp-register-project` | 공통 | Register project dialog: 이름과 폴더(하위 폴더 포함, 0개 허용)만 받는다. 목적 칸이 없다. |
| 창 | `dp-sidebar-agents-grouped` | A | project 창 sidebar Agent 탭: domain 이름 머리글 아래 그 domain의 Domain Engineer와 Operator를 묶어 보인다. 접을 수 있다. |
| | `dp-sidebar-agents-flat` | B | 한 줄 목록. 줄마다 domain 이름 badge를 단다. |
| | `dp-sidebar-agents-switch` | C | 탭 위쪽에 domain 고르는 select 하나. 고른 domain의 agent만 보인다. |
| | `dp-agents-tab-stacked` | A | Agents 탭(탭 본문, agent 목록과 editor 진입)을 domain마다 section으로 쌓는다. section마다 Domain Engineer와 Operator 목록, 그 domain의 skill·MCP·model 설정으로 들어가는 줄이 있다. |
| | `dp-agents-tab-select` | B | Agents 탭 위쪽에 domain 고르는 control 하나를 두고, 고른 domain 하나의 본문만 그린다(지금 Agents 탭 본문 그대로). |
| | `dp-sidebar-artifacts-grouped` | A | Artifacts 탭을 domain별로 묶는다. |
| | `dp-sidebar-artifacts-flat` | B | 한 줄 목록에 domain badge. |
| 빈 상태 | `dp-empty-states` | 공통 | domain이 없는 project 창의 Agent 탭(안내와 만들기 단추), 처음 실행해 project가 없는 런처. |

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
