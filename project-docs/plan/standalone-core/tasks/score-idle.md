# score-idle

core가 일과 붙은 client가 없을 때만 10분 뒤 끝나게 한다. 표를 가진 module이 일을 읽고 조립이 합치며, server는 실제 client 수명만 알려 준다.

- 단위: idle (wave 2)
- 선행: score-control
- 소유(이 task만 고친다):
  - `packages/core/jobs/`
  - `packages/core/runs/`
  - `packages/core/workflows/`
  - `packages/protocol/jobs/`
  - `packages/protocol/runs/`
  - `packages/protocol/workflows/`
  - `packages/core/server/{server,serve,socket}.ts`
  - `packages/core/main/daemon/idle.ts` (새 file)
  - `packages/core/main/daemon/idle_test.ts` (새 file)
  - `packages/core/main/daemon/wiring/idle.ts` (새 file)
  - `packages/core/main/daemon/wiring/jobs.ts`
  - `packages/core/main/daemon/core.ts`
- 읽을 것:
  - `project-docs/plan/standalone-core/README.md`, `project-docs/products/roadmap/standalone-core.md`의 무엇을 만드나 4
  - architecture: `project-docs/architecture/{job,run,event,layers,testing}.md`
  - boundary: `project-docs/boundary-catalog.yaml`의 `jobs`, `runs`, `workflows`, `server`, `core-api`, `event-stream`; module: `project-docs/module-catalog.yaml`의 같은 core module
  - `packages/core/jobs/{reads,store,scheduler}.ts`, `packages/core/runs/{reads,store,service}.ts`, `packages/core/workflows/{reads,store,service}.ts`
  - `packages/protocol/jobs/jobs.ts:164-173`, `packages/protocol/runs/runs.ts:181-196`, `packages/core/workflows/reads.ts:61`
  - `packages/core/main/daemon/wiring/{context,jobs,runs,workflows}.ts`, `packages/core/server/serve.ts:107-150`
- 계약:
  - 쓰는 것: score-control의 shutdown barrier와 starting/ready/stopping, 기존 Clock·timer port.
  - 내놓는 것: idle은 `enabled job || open job run || running run || running workflow instance || Gateway 구독 || 진행 중 API request`가 하나라도 있으면 아니다. job의 승인 여부로 enabled를 다시 거르지 않는다. 앱 process·짧은 control identify/connect는 일을 만들지 않는다.
  - 내놓는 것: module별 machine 전용 activity read와 server의 client activity를 wiring이 합친다. 다른 module의 표를 SQL로 직접 읽는 aggregate를 만들지 않는다. 새 read를 더하면 schema·등록·권한 상한과 호출자를 이 task에서 같이 맞춘다.

## 할 일

1. `job.list`는 actor별로 거르고 `ListRuns`는 page가 있으며 workflow list는 project를 요구한다. 첫 page나 열린 project만 보고 idle로 판정하지 않는다. 각 module의 자기 store·read에 `EXISTS`에 해당하는 작은 activity 읽기를 넣고 조립에 노출한다. jobs는 enabled job과 열린 job run을, runs는 running을, workflows는 모든 project의 running instance를 본다. 기존 `jobRunOpen`과 같은 열린 줄 정의를 재사용한다.
2. `wiring/jobs.ts`는 scheduler 조립만 유지한다. jobs가 runs·workflows를 import하거나 그 표를 읽게 하지 않는다. module별 read를 모으는 wiring은 새 file에 두고 `assembly.ts`와 공용 context 칸 등록은 lead에게 넘긴다.
3. `serve.ts`의 요청 수는 shutdown을 위한 비공개 값이고 Gateway upgrade는 그 요청 경로 밖이다. HTTP 요청은 받은 때부터 응답 body stream close/완료까지, Gateway는 실제 구독 수명 동안 센다. 거절·abort·stream 오류도 수를 돌려주고 IPv4·IPv6 listener를 합친다. keep-alive socket이나 control probe가 10분 timer를 계속 새로 만들지 않게 한다.
4. ready가 된 뒤 idle을 세기 시작한다. 바쁨이 끊긴 때부터 600,000ms가 연속으로 지나야 shutdown을 시작한다. 일 읽기가 실패했으면 idle로 보지 않는다. timer가 울려도 최신 module 상태와 client 수를 다시 확인하고, 비동기 읽는 중 새 일이 들어온 경우 지난 결과로 종료하지 않는다. shutdown 입장 차단과 경합하는 request가 있으면 그 request와 일을 먼저 지킨다.
5. idle 종료는 지금 정상 shutdown 순서로 간다(`core.ts:252-311`). 앱 process가 떠 있다는 이유만으로 남기지 않고 기존 closeChildren 순서로 정리한다. manual stop·판 교체는 idle 여부와 무관하며 중복 종료는 같은 barrier를 기다린다. 전환 중 옛 parent launcher도 계속 동작하게 하고 parent 정의 삭제는 cleanup에 남긴다.

## 끝남

- `npm run check`가 통과한다.
- 위험 test: "enabled job·열린 job run·running run·running workflow·client 중 하나라도 있으면 idle-exit가 일을 끊지 않는다"를 수동 Clock·timer와 가짜 activity port를 쓰는 table 한 개로 본다. 마지막 client 종료 뒤 10분, deadline 직전 새 일, 읽기 실패, 비동기 읽기 중 새 request도 같은 규칙의 행이다. 실제 10분을 기다리지 않는다.
- module read의 위험이 기존 test로 안 잡히면 SQLite 한 개에서 다른 project의 running instance와 꺼진 job 뒤 열린 run이 idle로 빠지지 않는 경우만 보충한다. UI·timer 내부 호출 횟수·schema 모양 test는 쓰지 않는다.
- 사람에게 물을 것: enabled job을 남긴 채 shell을 Quit하고 실제 차례 실행까지 보는 새 core E2E, 실제 HTTP stream·Gateway server를 띄우는 새 test. 허락 전에는 추가하지 않는다.
- 남지 않음: 첫 page·현재 project만으로 바쁨 판정, 읽기 오류를 idle로 바꾸는 길, module 경계를 숨기는 cross-module SQL.

## 보고

`.claude/skills/orchestrate/brief-template.md`의 보고 꼴을 따른다. activity read·client 집계 export, lead가 등록할 목록, 종료 경합을 어떻게 막았는지를 적는다.
