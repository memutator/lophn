# skill-share

- 목표: 앱이 다른 agent에게 쓸모 있는 기능을 skill로 내놓고, 사람이 승인한 할당 하나로 그 agent가 알고 부르게 한다. 그 바탕으로 지침 파일 fallback, skill 자리(`.lophn/skills`)와 YAML frontmatter, `skills_off`, 할당을 agent 정의 파일로 옮기는 일을 같이 한다.
- 재료: `project-docs/products/roadmap/harness-config.md`의 단계 1, 2, 6, 8과 "정한 것", 이 폴더의 `facts.md`(코드 위치 조사), `project-docs/architecture/{agent-definition,approval,app-call,domain,coding-agent}.md`
- 범위 밖: harness-config 단계 3(MCP 칸 꼴), 4(project 층을 repo `.lophn/settings.json`으로), 5(권한 규칙 일반화), 7(가져오기). project `skills_off`는 지금 자리(`extensions.json`)에 둔다.

## 정한 것

roadmap "정한 것"에 더해 lead가 정한 것이다.

1. 앱 지침 층은 만들지 않는다. 지침 fallback(`LOPHN.md`가 없으면 `CLAUDE.md`)은 전역과 project 층에만 있다. 앱 agent는 지금처럼 지침이 시켜 `AGENTS.md`를 file tool로 읽는다.
2. agent 정의 `apps`는 앱 slug 목록이다. slug는 앱을 만들 때 정해지고 바뀌지 않는다(`AppCreated`에만 있다).
3. 할당에서 뺀 command는 `permissions.deny`에 `lophn(<domain> <command>)`로 적는다(`<command>`는 `wordsOf`의 낱말: `session usage`). 다른 규칙은 이 계획에서 쓰지 않는다.
4. 할당 route(`assignment.get`, `assignment.set`)는 남기고 저장을 agent 정의 파일로 옮긴다. Grants 탭과 `assignmentGet`을 부르는 곳(`product-driver.ts`, `app-toolkit.ts`)은 그대로 둔다. ledger를 바로 읽던 동기 reader(`apps/calls/gate.ts`, `apps/usage/users.ts`, `wiring/approvals.ts`)는 `AgentDirectory`로 옮긴다.
5. `agent_assignments`를 옮기는 migration은 data step 하나다. data step은 ledger schema step 뒤에 돌기 때문에(`main/daemon/core.ts`) 그 step이 `lophn.db`를 직접 열어 표를 읽고, agent 파일을 쓰고, 표를 지운다. 새 data root에는 data step이 돌지 않아 빈 표가 남는다. 쓰는 곳이 없어 둔다.
6. `skills`(받을 이름) → `skills_off`(끈 이름) migration도 data step이다. 그때 발견되는 후보(내장, 전역, 맡은 domain) 가운데 `skills`에 없던 것을 `skills_off`에 적어 받는 skill이 같게 한다.
7. 공유 skill은 release bundle에 이미 들어 있는 commit 파일(`.lophn/skills/**`)을 읽는다. 선언 `skills[].public`이 true인 것만 다른 agent에게 준다. 비공개 skill은 그 앱 place의 `app` source로만 보인다.
8. 앱 공유 명령은 `lophn app share`다. 앱 place에서만 부르고, 받을 agent 이름과 coding agent 여부를 받는다. 결과는 대기 목록의 요청 하나이고, 사람이 승인하면 core가 agent 정의 `apps`에 그 앱 slug를 넣고 coding agent를 골랐으면 설정 `coding-agent.shared_apps`에 slug를 넣는다. 요청은 turn이 끝나도 남는다(activation 동의, job 승인과 같은 꼴).
9. coding agent 사본은 core가 쓰지 않는다. core는 data root 밖을 쓰지 않는다. `lophn harness` 쪽 코드가 core에서 공유 skill을 읽어 adapter의 `skill_dir`(claude `.claude/skills`, codex·pi `.agents/skills`, opencode `.config/opencode/skills`)에 쓰고, shell main이 기동 때와 activation·설정 바뀜 때 부른다. lophn이 쓴 사본에는 표시 파일을 두고 그것만 덮고 지운다. session 시작 hook은 core를 부르지 않으므로 쓰지 않는다.
10. `@lophn/declaration`은 `skills` 칸이 생기므로 2.1.0으로 올린다. 이미 있는 앱은 2.0.0 그대로 돈다(`skills`는 없어도 되는 칸).

## 단위와 순서

- wave 0(lead, 끝남): agent 정의 칸 `skills_off`·`apps`·`permissions`와 frontmatter 순서, skill source `project`·`app`·`shared`(`8ed85007c`).
- wave 1: `instr-claude-fallback`, `skill-places`, `assign-file`, `app-skill-decl`. 서로 기대지 않는다.
- wave 2: `app-share-request`, `shared-skills`, `harness-skill-copies`(선행 `app-share-request`), `share-guidance`(선행 `app-share-request`).

## lead가 할 일

- merge마다: 보고의 "등록할 것"(`packages/cli/commands/mod.ts`의 `COMMANDS`, `main/daemon/assembly.ts`의 `WIRINGS`, `protocol/registry.ts`, `protocol/*/mod.ts`), `skill-places` 뒤에 `agent-values.ts`의 `skills` 칸 지우기.
- 다 끝나면: `project-docs/architecture/{agent-definition,approval,app-call,domain,coding-agent}.md`, `boundary-catalog.yaml`, `module-catalog.yaml`, roadmap 상태와 단계 8의 coding agent 폴더(adapter `skill_dir`대로), changelog 0.15.0.
- 사람에게 물을 것: 없음. 진짜 model로 공유 skill이 쓰이는지 보는 eval은 land 뒤 사람에게 묻는다.
