# chatgpt-subscription: 구독 계정의 model 목록과 OAuth live 확인

- 목표:
  - ChatGPT 구독으로 연결한 provider에서, 그 계정이 쓸 수 있는 model만 고르게 한다.
  - 구독 OAuth를 진짜로 확인하는 live 길을 만든다. 사람이 한 번 로그인해 저장하고, live가 그것으로 부르고 갱신한다.
- 재료:
  - `project-docs/issues/platform.md`: "ChatGPT로 로그인한 provider가 그 계정이 못 쓰는 model도 고르게 둔다"
  - `project-docs/architecture/testing.md`의 live 줄과 "돌리는 때"
  - `project-docs/plan/eval-base/research/infra.md` 4절(OAuth): token 저장 위치, 갱신, root를 복사하면 안 되는 이유
  - `tests/live/`, `tests/support/fake-oauth/`
- 범위 밖:
  - SuperGrok 계정의 model 목록. 같은 길이 필요해지면 그때 한다.
  - eval이 구독 model을 쓰는 것. eval은 API key만 쓴다(`project-docs/products/roadmap/eval.md` 정할 것 8).
- 돌리는 방식: **worker를 쓰지 않는다.** lead가 lead worktree에서 직접 고친다. 일이 둘이고, live 로그인은 사람과 lead가 같이 해야 하기 때문이다. orchestrate skill의 "lead는 기능 코드를 직접 짜지 않는다"는 이 계획에 적용하지 않는다.
- 단위: `tasks/*.md`의 "단위"가 정한다. task id는 `cs-`로 시작한다.
- 순서: model 목록 → OAuth live.
- 시작 조건: 계획 `settings-mcp`가 main에 land한 뒤.
  - 설정 화면이 provider를 붙일 수 있어야 model 목록을 화면에서 확인할 수 있다.
  - renderer의 설정 file 소유가 겹친다.

## 정한 것

- model 목록: 연결한 뒤와 token을 갱신할 때, runtime이 같은 Bearer로 `GET /v1/models`를 읽는다. `visibility == "list"`인 것만 그 provider에서 고를 수 있게 둔다(agent, 이슈 추천).
- OAuth live는 두 단계다(사람: 이 계획을 열며 정함).
  1. `deno task test:live:login`: live 전용 data root `.dev-data/live/home`에 core를 띄운다. 사람이 진짜 로그인을 한 번 하고 저장한다.
  2. `deno task test:live`: 그 root가 있고 credential이 available이면 구독 provider로 호출하고 갱신을 확인한다. 없으면 이유를 찍고 넘어간다.
- 그 root는 복사하지 않고 core 하나만 띄운다. refresh token이 갱신 때마다 바뀌기 때문이다. `bootCore`가 env를 비워도 token은 `secrets.json`에 있어 그대로 쓴다.

## 사람이 정할 것

- 진짜 provider 호출(로그인과 live 호출)은 사람이 돌린다. lead는 돌릴 명령과 확인할 것을 사람에게 주고, 결과를 받아 기록한다. AGENTS.md "사람에게 묻는 것"이다.

## lead가 할 일

- task마다 `deno task check`, 끝내기 전에 `deno task check:full`과 renderer build를 돌린다.
- 새 task 이름(`test:live:login`)과 live 전용 root의 규칙(복사 금지, core 하나)을 `project-docs/architecture/testing.md`의 live 줄에 적는다. `.env.example`(이 컴퓨터에만 있다)의 주석도 맞춘다.
- 끝나면 다음을 한다.
  - 닫은 이슈를 `project-docs/issues/archived/`로 옮긴다.
  - `project-docs/products/change-log/0.3.0.md`에 항목 하나를 덧붙인다.
  - `land.sh`로 main에 올린다.
