# eval-base: eval의 기초와 책임에 따른 call 판단 case

- 목표: 진짜 model로 lophn agent의 일을 재는 eval 층의 기초를 세우고, 작은 판단 case 17개를 돌린다.
  - 기초에 드는 것: runner(`deno task eval`), 공통 수치 collector, 재료(담기, 되살리기, 버전, 조립), 진짜 provider 연결 helper, scorecard, 돈을 쓰기 전의 `wrong` 확인.
- 재료:
  - `project-docs/products/roadmap/eval.md`: 이 계획의 정본이다. 기초 모양, 공통 수치, 재료, 시나리오 꼴, "책임에 따른 call: 작은 판단 case" 표, 지켜야 할 것, case 고르는 규칙, 정할 것을 담고 있다.
  - `research/`: `roles-and-outcomes.md`(role 지침과 결과를 읽는 route), `infra.md`(core 띄우기, provider, 수치, check), `sources.md`(다른 harness의 만드는 법), `reuse-and-materials.md` Part 2·3(재료의 되살리기와 버전), `coding-agent-eval.md` 4·5절(role agent 수치와 ledger 시각)
  - `project-docs/architecture/testing.md`, `project-docs/products/AGENT-ROLE.md`
- 범위 밖:
  - 진짜 coding agent harness, 캘린더 사슬(S1~S4), 재사용·observation·진단 확인. roadmap의 다음 계획이다.
  - 첫 판에서는 LLM judge, CI, cron.
- 돌리는 방식: worker를 쓴다. orchestrate skill대로 한다.
- 단위: `tasks/*.md`의 "단위"가 정한다. task id는 `ev-`로 시작한다.
- 순서: brief의 wave가 정한다. 계약이 먼저다: case 꼴, record 꼴, 재료 manifest.
- 시작 조건: 없음.
  - 진짜 provider로 처음 돌리는 것은 계획 `prompt-text`가 main에 land한 뒤에 한다. 판단 case가 재는 지침을 그 계획이 고치기 때문이다.

## 정한 것

roadmap의 "정할 것" 1~8을 근거대로 정했다(agent). 사람에게 다시 묻지 않았다.

1. 자리는 `tests/eval/`다. `tools/check.ts`의 `NOT_IN_CHECK`에 더한다.
2. 채점은 program 판정만 한다.
3. 판단 case는 3번 돌려 통과 수/3을 남긴다.
4. 재료를 되살릴 때는 fake 대본을 쓴다. 진짜 model은 시나리오의 `real`에만 붙인다. `real`이 아닌 agent는 model이 없어 turn이 시작되지 않는다(`model_required`).
5. 재료 버전은 정수 `n`과 content hash다. hash는 `sha256Hex(bundleBytes(files))`이고, package의 `bundle_hash`와 같은 꼴이다.
6. 비용 장치는 settings의 `lophn-agent.run.model_attempts`와 runner의 실행 상한이다. 실행 상한은 `modelCallList` cost를 더해 넘으면 멈춘다.
7. provider는 API key만 쓴다. key는 runner가 `.env`에서 읽어 `secrets/put`으로 넣는다. core env에는 넣지 않는다.

roadmap에서 추천으로 두고 사람이 답하지 않은 것도 추천대로 간다(agent).

- tool 정확도의 넷: 형식, 성공, 막힘, 되풀이(roadmap "공통 수치").
- 재료를 commit하는 방식: runner가 새 `n`으로 쓰고, 사람이 보고 commit한다.

## 사람이 정할 것

1. **진짜 provider 호출의 승인과 상한.**
   - worker는 진짜 provider를 부르지 않는다. grader는 `wrong` record로, runner는 fake provider로만 확인한다.
   - lead는 첫 진짜 호출 전에 사람에게 key와 상한을 받는다.
   - 추천:
     - smoke: `claude-haiku-5-5`로 case 몇 개, $1 이하.
     - 전체: `claude-sonnet-5-5`로 17 case × 3번, $10 상한.
   - AGENTS.md "사람에게 묻는 것"이다.
2. **runner가 core를 띄우는 것.** eval runner는 E2E처럼 core를 subprocess로 띄운다. 사람이 이 계획을 열어 roadmap의 모양을 승인한 것으로 보고 진행한다. 다른 subprocess나 server를 새로 띄우는 것(loopback web server 등)은 따로 묻는다.

## lead가 할 일

- merge 때마다 등록 file을 고친다: `deno.json`의 `eval` task(`--env-file=.env`), `tools/check.ts`의 `NOT_IN_CHECK`.
- 끝나면 다음을 한다.
  - `project-docs/architecture/testing.md`에 eval 층 줄과 "돌리는 때"를 더한다.
  - `project-docs/context-component-registry.yaml`에 `tool-eval`을 더한다.
  - `project-docs/module-catalog.yaml`의 `tests` notes와 `.claude/skills/write-test/SKILL.md`의 층 목록을 맞춘다.
  - 첫 scorecard를 commit한다.
  - `project-docs/products/change-log/0.3.0.md`에 항목을 덧붙인다.
  - `project-docs/products/roadmap/eval.md`의 "단계"에서 이 계획 몫을 지운다.
