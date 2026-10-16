# remove-app-extras-apps

앱 쪽에서 대체 없이 없어지는 것을 지운다: 앱 automation 전부, agent-context(앱 화면 상태·메모), 앱 data export 전부. 앱 automation과 화면 메모는 보류·삭제로 정해졌고 export는 모두 지운다. grant kind·blueprint 칸 같은 계약은 계약 단위가 지우니 건드리지 않는다.

- 단위: remove-app-extras (wave 1)
- 선행: `remove-documents-core`(`core/apps/register.ts`를 같이 고친다), core-wiring, remove-app-extras-tools, `remove-documents-sdk`(`permissions/broker/server.ts`를 같이 고친다)
- 소유(이 task만 고친다):
  - `packages/core/apps/automations/`
  - `packages/core/apps/agent-context/`
  - `packages/protocol/apps/agent-context.ts`
  - `packages/core/main/worker/export-entry.ts`
  - `packages/sdk/cap-schedule/`
- 추가 소유(lead 승인, 2026-10-16. 소유와 같이 고친다. 지운 것을 가리키는 줄만 고친다. core·shell 조립이 wiring file로 쪼개졌으면 그 줄이 옮겨 간 wiring file이 대신한다. "등록 file(lead)"도 지운 것을 가리키는 줄만 뺀다. 모두 지운 module을 쓰던 곳이다):
  - 지울 file: `packages/core/apps/runtime/entrypoint/automation.ts`, `packages/core/apps/runtime/entrypoint/clock-gate.ts`, `packages/core/apps/permissions/broker/automations.ts`, `packages/core/apps/data/export.ts`, `packages/core/apps/data/worker/export.ts`
  - 고칠 file(app-calls·approvals·releases-problems 몫): `packages/core/apps/{control.ts, register.ts}`, `packages/core/apps/runtime/entrypoint/{main.ts, state.ts, control.ts, invoke.ts, wire.ts, broker-client.ts, limits.ts, startup.ts}`, `packages/core/apps/permissions/{mod.ts, broker/server.ts, broker/access.ts}`, `packages/core/apps/data/reads.ts`(`createExportTarget`, `ExportJob`), `packages/core/main/app-supervisor/{assembly.ts, broker.ts}`
  - 조립: `packages/core/main/daemon/wiring/apps-export.ts`(file째 지운다)
  - shell main: `packages/shell/main/desktop/core/allowlist.ts`의 `worker:apps/export`
  - 등록 file(lead): `packages/core/main/daemon/assembly.ts`의 `WIRINGS`에서 apps-export 한 줄, `packages/protocol/apps/mod.ts`의 `agent-context` export
- 읽을 것:
  - spec: S5 9장 — `/home/pyosechang/projects/lophn/project-docs/tmp/specs/app-call.md`, S4 9장 — `/home/pyosechang/projects/lophn/project-docs/tmp/specs/agent-definition.md`
  - 삭제 목록: `/home/pyosechang/projects/lophn/project-docs/tmp/notes/removed.md` 1장(앱 화면 메모, export 전부), 2장(앱 automation, 앱 화면 상태)
  - inventory: `I1.5#11`, `I1.5#12`, `I1.7#6` (`../assignment.md`에서 이 task가 맡은 줄 전부). 표는 `/home/pyosechang/projects/lophn/project-docs/tmp/implementation-inventory.md` 1.5, 1.7장
  - 규칙: `/home/pyosechang/projects/lophn/project-docs/dev/code.md`, `code-map.md`
- 계약:
  - 쓰는 것: 없음
  - 내놓는 것: 없음(지우기만 한다)

## 할 일

1. **앱 automation** (I1.5#11)
   - `core/apps/automations/`(clock, permits, reads, mod)를 지운다.
   - 앱 process 입구: `runtime/entrypoint/automation.ts`, `clock-gate.ts`를 지우고 쓰던 곳을 걷는다: `main.ts`의 `installAutomations`·`automationTimers`, `state.ts`의 `automations`와 `gateClock`, `control.ts`의 `state.automations?.open()/close()`, `invoke.ts`의 `launchAutomation`·`timeoutAutomation`·`denyAutomation`·`AutomationLaunch`와 automation 회차 분기, `wire.ts`의 caller kind `automation`, `broker-client.ts`·`limits.ts`의 automation 쓰임.
   - 권한 쪽: `permissions/broker/automations.ts`를 지우고 `permissions/mod.ts`·`broker/server.ts`·`broker/access.ts`에서 걷는다. `core/main/app-supervisor/{assembly,broker}.ts`의 `permits`와 `core/apps/{control,register}.ts`의 automation read 등록도 걷는다.
   - 건드리지 않는 것(계약 단위가 지운다): grant kind `automation.run`(`protocol/apps/permissions.ts`, `grants.ts`의 `automationGrantRevoke`, `permissions/{commands,effective,schema}.ts`), `protocol/apps/broker.ts`의 `brokerAutomation*`, `channel-values.ts`의 `AUTOMATION_*`, blueprint `automatic_tasks`·`AutomationDeclaration`, `RecordedTrigger`의 automation 종류, `releases/compare.ts`의 automatic_tasks 비교. 이것들을 쓰던 core 쪽이 사라져서 안 쓰게 된 export는 보고에 적는다.
2. **agent-context** (I1.5#12)
   - `core/apps/agent-context/`(schema, redaction, host, mod)와 `protocol/apps/agent-context.ts`를 지운다. `protocol/apps/mod.ts`의 그 export는 등록 file이니 빼고 보고한다.
   - `runtime/entrypoint/startup.ts`의 `installScreenContextHost`를 걷는다.
   - `sdk/cap-schedule/screen-context.ts`(`registerScreenContext`, `registerAnnotationTarget`)를 지우고 `mod.ts`의 export(14~23줄 근처)와 `guide.md`의 해당 절을 지운다.
   - lophn-agent 쪽 tool(`app.screen_context`, `app.annotate`)은 `remove-app-extras-tools`가 이미 지웠다.
   - blueprint `agent_context`·`AnnotationTargetDeclaration` 칸과 `sdk/blueprint`의 선언 helper, template의 `agent_context: []`는 칸이 남아 있는 동안 둔다(contract-app-calls가 칸을 지울 때 같이 간다).
3. **앱 data export** (I1.7#6)
   - `core/apps/data/export.ts`, `core/apps/data/worker/export.ts`, `core/main/worker/export-entry.ts`를 지우고 `core/apps/data/reads.ts`에서 export 부분(`createExportTarget`, `ExportJob`)만 걷는다. export 전용으로 쓰던 SDK 사본·release 이력 읽기가 있으면 같이 지운다.
   - `wiring/apps-export.ts`(`appExportWorkers` 한 줄과 그 worker route)와 `shell/main/desktop/core/allowlist.ts`의 `worker:apps/export`.
   - **지우지 않는다**: `protocol/apps/data-job.ts`, `core/main/worker/data-job.ts`, `core/apps/data/worker/{backup,restore,migrate,run,job,...}.ts`. 이것들은 activation의 migration·복구본·restore 작업 입구다(`DATA_JOB_KINDS`: inspect, backup, migrate, restore, test). ownership.md가 `data-job.ts` 둘을 이 단위에 적었지만 export 전용이 아니다.
   - `/v1/apps/export` route 정의(`protocol/apps/runtime.ts`)는 contract-app-calls가 지운다.
4. 문자열로만 남은 것을 grep으로 찾는다(check가 못 잡는다): `new URL("../../main/worker/export-entry.ts", import.meta.url)`, route 이름 `apps/export`, process kind·worker route key `apps/export`, `automation`이라는 caller·trigger 문자열.
5. 개발 data: 지운 코드가 만들던 표가 있으면 schema step이 사라진다. 새로 만든 data root에서만 열린다(AGENTS.md 호환성). data를 지우거나 migration을 만들지 않는다.
6. `deno task check`를 돈다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test: 없음(지우기만 한다)
- 남지 않음: `grep -rn "core/apps/automations\|apps/agent-context\|installScreenContextHost\|registerScreenContext\|registerAnnotationTarget\|appExportWorkers\|prepareAppExport\|export-entry\|installAutomations\|launchAutomation" packages tools`가 0줄이다.

## 보고

- 바꾼 file
- 등록할 것: `protocol/apps/mod.ts`에서 뺀 `agent-context` export, 조립에서 뺀 `appExportWorkers`
- 안 쓰게 된 export: 위 "건드리지 않는 것"의 이름들(contract-approvals·contract-app-calls·approvals·app-calls가 지운다). `core/apps/runtime/entrypoint/schedule.ts`의 `SCHEDULE_PORT`는 command 등록 dispatch용이라 남긴다
- 정한 것: `data-job.ts` 둘을 지우지 않은 것, `sdk/cap-schedule`의 `withRevert`(`revert.ts`)와 `connectAppCommands`(`connect.ts`)를 지우지 않은 것(옛 rewind와 다른 앱 호출이 새 경로로 바뀔 때 app-calls가 지운다)
- 계약 바꾸기 요청: 없음
