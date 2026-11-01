# skill-share-docs

skill-share 계획이 바꾼 동작에 맞춰 architecture 문서, catalog, changelog, roadmap 상태를 고친다. 문서는 지금 코드만 적는다.

- 단위: docs (wave 3)
- 선행: harness-skill-copies. 모든 코드 task가 merge된 뒤에 쓴다.
- 소유(이 task만 고친다):
  - `project-docs/architecture/**`
  - `project-docs/boundary-catalog.yaml`
  - `project-docs/module-catalog.yaml`
  - `project-docs/context-component-registry.yaml`
  - `project-docs/products/change-log/0.15.0.md`
  - `project-docs/products/roadmap/harness-config.md`
- 읽을 것:
  - 계획: `project-docs/plan/skill-share/README.md`, `project-docs/plan/skill-share/status.md`, 각 task brief
  - 코드: `git log --oneline main..plan/skill-share`와 각 commit의 diff
  - 꼴: `project-docs/products/change-log/0.14.0.md`(항목 꼴: yaml block, 전·후, 왜, 결정), architecture 문서의 지금 꼴(흐름 그림, 지키는 것, 이유)

## 할 일

1. architecture: 바뀐 동작마다 그것을 설명하는 문서를 고친다. 적어도 이것들이다.
   - `agent-definition.md`: 지침 파일(`LOPHN.md`, 없으면 `CLAUDE.md`, 전역·project만), skill 층(내장, 공유, 전역, project·app `.lophn/skills`, domain), YAML frontmatter와 줄 단위 fallback, `skills` → `skills_off`, 사람만 쓰는 칸 `apps`·`permissions`, "할당은 agent id마다 한 줄"(지금은 정의 파일), 공유 skill이 목록·`skill.read`·`/` 메뉴·Agents 탭 개수에 같은 규칙으로 실리는 것.
   - `approval.md`: 할당 저장(정의 파일, `assignment.get/set`이 그대로인 것), 앱 공유 요청(남는 요청, 사람만 결정, 승인이 쓰는 것), data step 둘과 그 순서.
   - `app-call.md`, `domain.md`: 선언 `skills`, release 준비의 skill 검사, `removed_public_skills`, `app.skills` read, 공유 skill을 할당으로 받는 것.
   - `coding-agent.md`: `coding-agent.shared_apps`, `lophn harness sync-skills`, adapter `skill_dir`, 표시 file, shell main이 부르는 때.
   - `testing.md` 등 `agent_assignments`나 옛 `skills` 칸을 말하는 곳.
2. catalog: 새 module(예: `packages/core/approvals/share-requests`), 새 boundary(공유 요청 route, `app.skills` read, 설정 `coding-agent.shared_apps`, ledger 표 `share_requests`, transient event, CLI 명령 `app.share`·`harness sync-skills`)를 올리고, 지운 것(할당 ledger 표 store)을 내린다. 이름은 코드에서 확인한다.
3. changelog 0.15.0: 항목 하나("앱이 skill을 내놓고 할당으로 다른 agent에게 준다" 묶음)로 전·후, 왜, 결정을 쓴다. 결정은 roadmap "정한 것"과 계획 README "정한 것"에서 옮기고 `(사람)`·`(agent)`를 붙인다.
4. roadmap: `harness-config.md` 상태 줄에 단계 1, 2, 6, 8을 계획 `skill-share`로 구현했다고 적고, 남은 단계(3, 4, 5, 7)를 적는다.
5. `npm run check:full`의 docs 단계가 통과하게 path를 저장소 root부터 쓴다.

## 끝남

- `npm run check:full`이 통과한다.
- 위험 test: 없음
- 남지 않음: `grep -rn "agent_assignments" project-docs/architecture`가 data step을 설명하는 줄 밖에서 0줄이다.

## 보고

- 바꾼 file
- 통과한 check
- 코드와 문서가 어긋나 보이는 곳(문서는 코드대로 썼고, 코드가 틀려 보이면 적는다)
- **무겁게 짠 것**
- **알려진 미완 동작**
