# 계획, 작업, 끝남, git

## 계획

- 리팩터링과 구현 계획은 `../plan/`에 둔다. 단계, 작업 단위, 순서, 끝난 기준을 담는다.
- **재료**
  - 무엇을 할지: `../tmp/implementation-inventory.md`(UI 밖), `../tmp/ui-inventory.md`(UI)
  - 어떻게 동작할지: spec S1~S9(`../tmp/specs/`)
  - 순서 제약: implementation-inventory 6장
  - test 기준: [testing.md](testing.md)
- **단위**
  - spec 하나와 그 화면이 한 단위다. 단위 이름은 하는 일로 짓고 번호나 단계 이름을 쓰지 않는다.
  - worker 하나가 한 session에 끝낼 크기로 작업을 나눈다.
- **순서**
  - 기반(check 파이프라인, 저장과 event, Gate)을 먼저 하고, agent와 앱 단위, UI 순서로 간다.
  - 의존이 없는 단위는 동시에 한다.

## 작업 하나의 모양

작업 하나는 task brief 하나다. 꼴은 [../plan/tasks/README.md](../plan/tasks/README.md)에 있다. 오케스트레이터가 brief를 worker에게 넘기는 절차는 [../plan/orchestrator.md](../plan/orchestrator.md)에 있다.

## 끝남

작업은 이것이 모두 맞을 때 끝난다.
1. 빠른 check(`deno task check`)가 통과한다.
2. 그 작업의 위험 test가 있다([testing.md](testing.md)). 위험이 없는 작업은 test가 없어도 된다.
3. 동작이 requirements나 spec과 다르면 같은 변경에서 고쳤거나 lead에게 질문으로 보고했다.
4. 죽은 코드, TODO, 옛 이름이 남지 않았다.

## lead와 worker

- **lead**(주 session)가 하는 일: 작업을 고르고 worker에게 맡긴다. 결과를 합치고 review하며, 사람에게 묻는다.
- **worker**는 작업 하나를 맡는다. model은 AGENTS.md를 따른다.
  - 보통은 `sonnet-high`다.
  - `mimo-v2.6-flash`는 쓰지 않는다(사람, 2026-10-16).
  - worker는 자기 sub agent를 띄우지 않는다.
- **동시에 돌 때는 파일 소유를 나눈다.**
  - 두 worker가 같은 파일을 동시에 고치지 않는다.
  - 여럿이 같이 쓰는 등록 파일(목록, registry, 설정)은 lead가 합친다. worker는 등록할 것을 보고에 적는다.
  - 남이 쓰는 export는 더하기만 하고, 지우거나 뜻을 바꾸지 않는다. 안 쓰게 된 것은 보고하고, lead가 합친 뒤 지운다.
- **worker의 보고**
  - 바꾼 파일, 통과한 check, 등록할 것, 안 쓰게 된 것
  - 정한 것: 문서에 답이 없어 worker가 정한 것
- **정할 수 없는 것**은 lead에게 보고하고 추천안으로 진행한다. lead는 그것을 `../tmp/docs-review.md`에 적는다. 사람에게 올릴 것은 lead가 고른다(제품 방향, 비용, 되돌리기 비싼 것).
- **agent 관련 주제**(prompt 조립, tool, session 등)를 새로 정할 때는 다른 harness를 코드로 먼저 조사한다. 이미 한 조사(`../tmp/research/`)를 먼저 본다.

## git

- main은 늘 빠른 check가 통과한다.
- worker는 작업마다 worktree와 branch 하나에서 일한다. worktree는 `.claude/worktrees/<task id>`, branch는 `<단위>/<task id>`다(`../plan/orchestrator.md` 4.2).
- commit 메시지는 영어 명령형 한 줄과 본문이다. 요구 ID나 작업 번호는 넣지 않는다.
- 합치기: lead가 branch를 main에 merge하기 전에 빠른 check를 다시 돈다. 같은 파일을 고친 작업은 lead가 순서를 정한다.
- 사람에게 묻는 것: push, 되돌릴 수 없는 git 작업(force push, 기록 지우기, 병합 안 된 branch 삭제). commit과 merge는 계획이 확인된 뒤 lead가 한다.
