# headless와 schedule: 남은 것

상태: 로드맵. 2026-10-20 사람이 방향을 내고 planner가 정리했다. headless run은 계획 `headless-run`으로(`project-docs/architecture/run.md`), job은 계획 `schedule-job`으로(`project-docs/architecture/job.md`), flow는 계획 `flow`로(`project-docs/architecture/workflow.md` "flow") land했다. 이 문서에 남은 것은 gdrive OAuth다.
배경 문서: `project-docs/architecture/job.md`, `project-docs/architecture/run.md`, `project-docs/architecture/workflow.md`, `project-docs/architecture/app-call.md`, `project-docs/products/AGENT-ROLE.md`.

## 왜

- 정해진 때 저절로 도는 일(10일마다 gdrive 폴더의 파일을 옮긴다)은 job과 flow로 짤 수 있다. 남은 것은 앱이 gdrive에 닿는 길이다.

## 지금 코드

- 앱 secret은 Bearer만 붙는다(`packages/sdk/cap-secret`). OAuth refresh는 MCP에만 있다(`packages/core/lophn-agent/extensions/mcp-oauth.ts`).

## 무엇을 만드나

- **gdrive.** 앱이 gdrive를 쓰려면 OAuth refresh가 필요한데, 앱 secret은 Bearer만 된다. MCP 쪽 OAuth(`mcp-oauth.ts`)를 앱 secret에도 여는 일이다. gdrive 예를 돌리기 전에 한다.

## 정한 것 (사람, 2026-10-20)

- 간단한 일은 원샷 run으로 job에 건다. 복잡한 일은 flow로 program처럼 짜서 job에 건다.
- 검증 체계와 다시 하기는 flow를 짜는 agent의 책임이다. program은 뜻을 이해하지 못한다.

## 끝남 기준

- 앱이 gdrive를 OAuth refresh로 쓴다. 10일마다 폴더의 파일을 옮기는 job이 그 앱 tool을 부른다.

## 하지 않는 것

- **상주 daemon이나 OS service.** tray와 autostart로 충분하다.
- **push형 event source와 webhook.** 주기 polling으로 끌어 읽는다. webhook은 공개 endpoint가 필요해 개인 로컬 작업 공간(PRODUCT 5절)과 맞지 않는다.
- **자동 재시도.** 다시 하기는 flow가 한다.
- **LLM judge로 run 결과 검증.** 뜻 검증은 flow를 짠 agent의 일이다(`architecture/approval.md`가 LLM judge를 넣지 않은 이유와 같다).
- **cron 문법.** 간격과 하루 중 시각으로 시작하고, 모자라면 그때 더한다.
