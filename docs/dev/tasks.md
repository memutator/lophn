---
type: guide
concerns: [platform, documents, apps, problems, lophn-agent, coding-agent, shell]
---
# 계획, 작업, 완료

구현 계획과 작업 단위의 모양, 완료의 뜻, 테스트, 추적, git 흐름이다.

## 계획 문서

- 계획은 `docs/plan/`에 둔다. `docs/plan/README.md`(guide)는 slice 목록과 순서, 첫 판에 넣을 intent 약속을 적는다.
- slice 하나는 `docs/plan/<slice 이름>.md`(type `plan`)다. 이름은 하는 일로 짓는다(예: `skeleton`, `documents-basic`, `coding-agent-connect`). 번호나 단계 이름(`milestone1`, `phase-2`)은 쓰지 않는다. 순서는 README의 목록이 정한다.
- slice는 사람이 처음부터 끝까지 해 볼 수 있는 한 줄기다. 끝나면 하나 이상의 flow가 E2E로 돈다.
- metadata의 `concerns`에는 slice가 손대는 concern을 모두 적는다.

## 작업 단위

slice 문서 안에 작업을 이 모양으로 쓴다.

```markdown
### T<n> 한 줄 제목

- 담당: 기본 | 상위 | frontend   (team.md의 worker 등급)
- concern: apps/registration, apps/blueprint
- 요구: apps/registration#R1–R4, apps/blueprint#R2
- 자리: packages/apps/registration/, packages/contracts/apps/   (code-map.md)
- 쓰는 contract: platform command, blob
- 내놓는 contract: apps registration API   (있으면 integrator 작업이 먼저)
- 선행: T2, skeleton#T5
- 완료: 아래 확인이 통과한다
  - registration_test.ts에 R1–R4 테스트
  - flow new-app 1~3단계 E2E
```

- 작업 하나는 기본 worker가 한 세션에 끝낼 크기다: 요구 15개 안팎, 새 파일 10개 안팎. 넘으면 나눈다.
- 범위가 분명하고 구체적이어야 기본 worker에게 준다. 판단이 큰 작업은 상위, 화면 작업은 frontend로 표시한다.
- contract를 새로 내놓거나 바꾸는 일은 따로 integrator 작업으로 떼어 먼저 둔다.

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

- main은 늘 `deno task check`가 통과한다.
- 작업마다 worktree와 branch 하나: `<concern 이름>/<짧은 설명>`(예: `apps-registration/register-command`).
- commit 메시지는 영어 명령형 한 줄과 본문. 본문 끝에 `Refs: apps/registration#R1-R4, plan skeleton#T6`.
- 병합 순서: contracts와 base → 선행이 없는 작업 → 나머지. 병합 전에 main으로 rebase하고 check를 다시 돈다.
- 병합은 lead가 한다([team.md](team.md)).
