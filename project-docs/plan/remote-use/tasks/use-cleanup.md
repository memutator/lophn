# use-cleanup

계획을 닫는다. 요청한 쪽 없이 넘기던 옛 길과 그 말이 code와 test에 남지 않게 하고, flows와 catalog를 맞추고, architecture 문서 여섯을 새 모델로 쓴다.

- 단위: use (wave 4)
- 선행: use-events, use-screens, use-cli. 모든 구현 task가 plan branch에 merge된 뒤다.
- 소유(이 task만 고친다):
  - `project-docs/architecture/{app-call,agent-call,approval,event,job,remote}.md`
  - `project-docs/boundary-catalog.yaml`, `project-docs/module-catalog.yaml`(계획 README가 이 task에 "flows·catalog"를 주었다)
  - `project-docs/flows/`(areas, tests, journeys)
  - 옛 말이 남은 주석과 오류 문구가 있는 code file(아래 grep이 찾은 곳만. `packages/protocol/remote/allowlist.ts`는 lead의 file이라 고칠 문장을 보고에 적는다)
- 읽을 것:
  - 계획 README 전부와 `project-docs/plan/remote-use/tasks/*.md`의 "정한 것"과 각 worker 보고의 "정한 것"(lead가 준다)
  - roadmap `project-docs/products/roadmap/multi-device.md`("해도 되나", "사람이 정한 것")
  - skill: `.claude/skills/flows/SKILL.md`. 문서 규칙은 AGENTS.md "문서"(architecture에 code path를 적지 않는다)
  - boundary·module: `remote-protocol`, `core-api`, `event-stream`, `sdk-api`, `coding-agent-cli-interface`; module `remote`, `apps`, `approvals`, `jobs`, `events`
- 계약:
  - 쓰는 것: 이 계획이 고정하고 지은 모든 이름(`use-contract.md`의 "내놓는 것", `use-events.md`의 "내놓는 것")
  - 내놓는 것: 없음

## 할 일

1. 옛 길이 남지 않았는지 본다.
   - 컴퓨터의 core가 다른 기계에 보내는 call은 모두 `by`를 싣는다: `packages/core/remote/`에서 `connection.call(`의 모든 자리.
   - 받는 기계에는 `by` 없는 컴퓨터 call을 사람으로 보는 갈래가 없다.
   - `machines/call`의 주석이 "받는 기계는 `device:<이 컴퓨터의 id>`인 사람으로 보고"가 아니다(`packages/protocol/remote/routes.ts`).
   - `packages/shell/main/desktop/core/allowlist.ts`의 "`machines/*`는 shell main만 부른다"는 renderer 목록의 말이라 맞는지 보고 둔다.
   - 남은 것이 있으면 고친다. 구조를 바꿔야 하면 고치지 않고 보고한다.
2. architecture(`project-docs/architecture/`):
   - `remote.md`: 넘기는 call의 요청한 쪽과 그 표, 받은 call은 다시 넘기지 않는다, 이름 풀기, `--on`, 기계 사이 구독과 그 거르기. "desktop에서 다른 기계 보기"의 `machines/call` 설명.
   - `approval.md`: `use-contract` 초안을 지은 대로 맞춘다(할당의 기계, private 두 자리, 할당한 앱 command는 다른 기계의 것도 묻지 않고 돈다).
   - `app-call.md`: caller 일곱, `remote` target과 받는 기계 입구, 손 사본, `connectCommands`의 `on`. "여섯"이 남은 문장을 고친다.
   - `agent-call.md`: call 정책의 private이 기계 사이에도 서는 것(부르는 기계는 부른 쪽의 workspace, 받는 기계는 대상 앱의 workspace, 쌍 규칙은 기계 사이에 보지 않는다, 사람의 화면과 터미널은 예외).
   - `event.md`: 다른 기계의 앱 event(내주는 것, core의 구독자, 난 기계를 싣고 낸다, 늦은 길과 한 번만 내기).
   - `job.md`: trigger의 기계와 주인 기계의 차이.
   - 각 문서의 "결정"에 README "정한 것"과 task의 "정한 것"을 근거(사람·agent)와 함께 옮긴다. 열린 것(link의 call 자리와 기한, 꺼진 기계의 앱)을 "열린 것"에 둔다.
3. catalog: `boundary-catalog.yaml`의 `remote-protocol`(call frame의 `by`, 판), `core-api`(`apps/remote_call`, `machines/app_tools`, `machines/call`의 요청한 쪽), `sdk-api`(`connectCommands`의 `on`, 선언 구독의 `machine`), `event-stream`(컴퓨터에 내주는 `AppEventPublished`). `module-catalog.yaml`의 `packages/core/remote` notes(구독, 요청한 쪽).
4. flows(`flows` skill): `node tools/flows.ts report`로 이 계획이 더한 entry의 `unclear`와 덮이지 않은 risk outcome을 본다. 각 task가 쓴 flow가 지은 동작과 맞는지 맞추고, journey 하나를 더한다(`journeys/agent-automation.yaml`: 한 컴퓨터의 agent가 다른 컴퓨터의 앱 command를 부르고, 그 앱의 event로 job이 돈다).
5. 이슈: `remote-call-errors-drop-details`가 고쳐졌으면 닫을 근거를 보고에 적는다(닫기는 lead가 `issue` skill로 한다). 계획 중에 생긴 "무겁게 짠 것"과 "알려진 미완 동작"은 lead가 이슈로 올린다.

## 끝남

- `npm run check`가 통과한다(flows·docs 단계 포함). 문서만 고쳤어도 `npm run check:full`을 돈다(문서 fmt로 main이 깨진 일이 있다).
- 위험 test: 없음(새 동작이 없다).
- 남지 않음(모두 0줄. `tests/`까지 본다):
  - `grep -rn "인 사람으로 보고" packages tests`
  - `grep -n "여섯" project-docs/architecture/app-call.md`에 caller 종류를 말하는 줄이 없다
  - `grep -rn "call its routes directly, not through machines/call" packages tests`
  - `grep -rn "다른 기계로 넘긴 call은 그 기계에서 기기 route 목록과 허락으로" packages tests`

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: lead가 고칠 목록 file(`protocol/*/mod.ts`, core 조립 목록, gallery `pages/index.ts`, `package.json`). 이 task는: `allowlist.ts` 머리 주석에서 고칠 문장("허락은 그 기기를 사람으로 본다는 뜻이다"를 요청한 쪽 기준으로)
- 안 쓰게 된 export(남이 쓰던 것은 지우지 않는다)
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 넘길 줄: 남의 file을 최소로 맞춘 곳
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- **무겁게 짠 것**: 가장 단순한 구현(AGENTS.md "속도")보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것. 없으면 "없음"

## 시작 전에 다시 볼 것

- 이 계획의 worker 보고(lead가 모은 "정한 것", "넘길 줄", 계약 바꾸기 commit)와 그것이 바꾼 이름. `one-screen`·`carry-paths`가 같은 architecture 문서(`remote.md`, `event.md`)에 쓴 절(겹치지 않게 그 절 옆에 쓴다). 그때 `node tools/flows.ts report`의 모양.
