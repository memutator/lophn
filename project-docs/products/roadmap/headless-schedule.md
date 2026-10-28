# headless와 schedule: 남은 것

상태: 로드맵. 2026-10-20 사람이 방향을 내고 planner가 정리했다. headless run은 계획 `headless-run`으로(`project-docs/architecture/run.md`), job은 계획 `schedule-job`으로(`project-docs/architecture/job.md`), flow는 계획 `flow`로(`project-docs/architecture/workflow.md` "flow"), 앱 secret의 OAuth와 `netFetch` 본문은 계획 `app-oauth`로(`project-docs/architecture/app-call.md`) land했다. 이 문서에 남은 것은 gdrive 앱으로 끝남 기준을 돌려 보는 것이다.
2026-10-28: 계획 `remove-role`이 role을 없앴다. agent는 lophn과 사람이 만든 agent이고 session이 place(home, project, app)를 갖는다(`products/AGENT.md`, changelog `0.9.0`). 아래에서 Project Manager는 그 project place의 session, App Engineer는 그 앱 place의 session, Operator는 사람이 만든 agent로 읽는다.
배경 문서: `project-docs/architecture/job.md`, `project-docs/architecture/run.md`, `project-docs/architecture/workflow.md`, `project-docs/architecture/app-call.md`, `project-docs/products/AGENT.md`.

## 왜

- 정해진 때 저절로 도는 일(10일마다 gdrive 폴더의 파일을 옮긴다)은 job과 flow로 짤 수 있고, 앱은 OAuth secret으로 gdrive에 닿는다. 남은 것은 그 앱을 실제로 짓고 돌려 보는 것이다.

## 지금 코드

- 앱이 `secret.use`에 `oauth`를 선언하면 사람이 앱 Access 탭에서 client를 넣고 sign-in하고, core가 값을 보내기 직전에 refresh한다(`packages/sdk/cap-secret/guide.md` "OAuth secret"). `netFetch`가 본문(10 MiB)과 header를 보낸다(`packages/sdk/cap-net/guide.md`).
- gdrive 앱은 아직 없다.

## 무엇을 만드나

- **gdrive 앱.** App Engineer가 OAuth secret으로 Drive 앱을 짓고, 10일마다 파일을 옮기는 job을 건다. 사람은 Google Cloud에 OAuth client("Desktop app")를 만들어 앱 Access 탭에 넣는다. 계획이 아니라 앱을 짓는 일이다.

## 정한 것 (사람, 2026-10-20)

- 간단한 일은 원샷 run으로 job에 건다. 복잡한 일은 flow로 program처럼 짜서 job에 건다.
- 검증 체계와 다시 하기는 flow를 짜는 agent의 책임이다. program은 뜻을 이해하지 못한다.

## 끝남 기준

- 앱이 gdrive를 OAuth refresh로 쓴다. 10일마다 폴더의 파일을 옮기는 job이 그 앱 tool을 부른다.
- 사람이 진짜 Google로 sign-in, refresh, Drive 호출을 해 본다. 계획 `app-oauth`에서 미뤘다(가짜 발급자로는 sign-in을 해 볼 수 없다).

## 하지 않는 것

- **상주 daemon이나 OS service.** tray와 autostart로 충분하다.
- **push형 event source와 webhook.** 주기 polling으로 끌어 읽는다. webhook은 공개 endpoint가 필요해 개인 로컬 작업 공간(PRODUCT 5절)과 맞지 않는다.
- **자동 재시도.** 다시 하기는 flow가 한다.
- **LLM judge로 run 결과 검증.** 뜻 검증은 flow를 짠 agent의 일이다(`architecture/approval.md`가 LLM judge를 넣지 않은 이유와 같다).
- **cron 문법.** 간격과 하루 중 시각으로 시작하고, 모자라면 그때 더한다.
