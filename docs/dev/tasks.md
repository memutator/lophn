---
type: guide
concerns: [platform, documents, apps, problems, lophn-agent, coding-agent, shell]
---
# 계획, 작업, 완료

구현 계획과 작업 단위의 모양, 완료의 뜻, 테스트, 추적, git 흐름이다.

## 계획 문서

- 범위는 `docs/` 전부다. 첫 판에서 덜어 내는 것은 없다.
- `docs/plan/README.md`(guide, lead가 씀): slice 목록과 순서, 팀 사이의 선행 관계.
- `docs/plan/<팀>.md`(type `plan`, team member가 씀): 그 팀의 작업 전부. 작업마다 `slice:` 줄로 속한 slice를 적는다. 작업 id는 `<팀>#T<n>`이다.
- slice는 사람이 처음부터 끝까지 해 볼 수 있는 한 줄기다. 끝나면 그 slice의 flow가 E2E로 돈다. 이름은 하는 일로 짓는다(예: `skeleton`, `documents`). 번호나 단계 이름(`milestone1`, `phase-2`)은 쓰지 않는다.

## 작업 단위

slice 문서 안에 작업을 이 모양으로 쓴다.

```markdown
### T<n> 한 줄 제목

- 등급: 좁은 | 기본 | frontend | 최상위   (team.md의 worker 등급)
- concern: apps/registration, apps/blueprint
- 요구: apps/registration#R1–R4, apps/blueprint#R2
- 자리: packages/apps/registration/, packages/contracts/apps/   (code-map.md)
- 쓰는 contract: platform command, blob
- 내놓는 contract: apps registration API   (있으면 contracts 팀 작업이 먼저)
- slice: apps
- 조사: docs/research/<주제>.md   (agent 관련 작업은 필수, research.md)
- 선행: apps#T2, contracts#T5
- 완료: 아래 확인이 통과한다
  - registration_test.ts에 R1–R4 테스트
  - flow new-app 1~3단계 E2E
```

- 작업 하나는 기본 등급 worker가 한 세션에 끝낼 크기다: 요구 15개 안팎, 새 파일 10개 안팎. 넘으면 나눈다.
- 파일과 바꿈이 정해진 좁은 작업은 좁은 등급, 대부분은 기본, 화면 작업은 frontend로 표시한다. 최상위는 처음부터 가장 어려운 문제에만 표시한다.
- contract를 새로 내놓거나 바꾸는 일은 따로 contracts 팀 작업으로 떼어 먼저 둔다.
- lophn-agent와 coding-agent의 작업은 주제마다 조사 작업을 먼저 둔다. 오픈소스 3개 이상을 코드로 본다([research.md](research.md)).

## 완료

작업은 이것이 모두 맞을 때 끝난다.

1. `deno task check`가 통과한다([stack.md](stack.md)).
2. 작업의 "요구"마다 테스트가 있다(아래 추적).
3. slice의 마지막 작업은 그 slice의 flow E2E가 돈다.
4. 동작이 requirements와 다르면 같은 변경에서 requirements를 고쳤거나 open-issues에 질문을 올렸다.
5. TODO를 남기지 않는다. 남길 일은 작업으로 만든다.

## 테스트

- 단위: `model.ts`의 순수 규칙, `commands.ts`의 CAS와 거절. 대상 옆 `*_test.ts`.
- 통합: core를 메모리 SQLite와 임시 폴더로 띄우고 API로 부른다. contract의 입력·출력·오류를 확인한다.
- E2E: flow 문서 하나가 시나리오 하나다. Playwright로 shell을 띄우고 fake provider와 fixture를 쓴다.
- model이 끼는 부분은 fake provider의 script나 녹화 응답으로 테스트한다. 실제 model의 판단 품질은 lophn-agent/evaluation이 따로 잰다.
- 시각, id, 무작위 값은 주입해서 테스트가 매번 같게 돈다.

## 추적

spec 문서 대신 테스트가 요구를 가리킨다.

- 테스트 이름은 요구 번호로 시작한다: `Deno.test("apps/registration#R3: 같은 이름의 앱은 거절한다", ...)`.
- 요구 하나에 테스트가 여럿이어도 된다. 테스트 하나가 요구 여럿을 가리켜도 된다.
- 나중에 `tools/check-docs.ts --trace`가 첫 판 범위의 요구 중 테스트가 없는 것을 보여 준다.

## git

- main은 늘 `deno task check`가 통과한다. main은 GitHub(`origin`)의 main이 정본이다.
- 작업마다 worktree와 branch 하나: `<concern 이름>/<짧은 설명>`(예: `apps-registration/register-command`). worktree는 `.claude/worktrees/` 아래에 둔다.
- commit 메시지는 영어 명령형 한 줄과 본문. 본문 끝에 `Refs: apps/registration#R1-R4, apps#T6`.
- 끝난 작업은 branch를 push하고 PR을 연다(`gh pr create`). PR 본문에 작업 id, 통과한 check, 테스트가 가리키는 요구를 적는다.
- 병합: `git fetch origin && git rebase origin/main` 뒤 check를 다시 돌리고 통과하면 team member가 `gh pr merge --squash --delete-branch`로 합친다. contracts PR이 먼저다.
- 충돌이 다른 팀의 코드에 걸리면 직접 고치지 않고 그 팀에 알린다. 순서를 정할 수 없으면 lead에게 묻는다.
- 묻지 않고 한다: commit, push, PR, 병합, worktree 만들기와 지우기. 사람에게 묻는 것은 되돌릴 수 없는 git 작업(force push to main, 기록 지우기, 병합 안 된 branch 삭제)뿐이다.
- 계획 단계에서는 commit하지 않는다. 계획 문서는 lead가 모아 commit한다.
