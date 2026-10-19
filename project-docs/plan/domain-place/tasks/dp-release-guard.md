# dp-release-guard

다른 project가 쓰는 공개 tool을 지운 release의 activation을 막고, 막힌 사실과 tool이 바뀐 사실을 PM에게 알린다. 막기는 activation 판정(`judge`)과 시작(`activationStart`) 두 곳에 같은 검사를 둔다. 알리기는 `dp-public-event`의 `PublicToolsChanged`를 쓴다: release가 active가 되어 tool이 바뀌었으면 그 앱 project의 PM과, 바뀐(또는 지워진) 공개 tool을 쓰는 다른 project들의 PM에게, 막혔으면 그 앱 project의 PM에게만 낸다.

- 단위: public-tools (wave 3)
- 선행: dp-public-event, dp-usage-read. 이벤트 정의와 "누가 쓰나" 조회가 먼저다. 계획 `domain-tools`의 계약 task(blueprint `public` 칸)가 main에 land한 뒤에 연다. planner(`lophn-7e`)가 알려 준 뒤 띄운다.
- 소유(이 task만 고친다):
  - `packages/core/apps/releases/commands.ts`
  - `packages/core/apps/releases/activation/`
  - `packages/core/apps/releases/public-tools.ts` (새 file)
  - `packages/protocol/apps/activation/activation.ts`
- 읽을 것:
  - architecture: `project-docs/architecture/activation.md`, `project-docs/architecture/event.md`, `project-docs/architecture/app-call.md`
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `app-releases`, `project-docs/module-catalog.yaml`의 `packages/core/apps`
  - 제품 결정: `project-docs/plan/domain-place/README.md`의 "정한 것 > 공개 tool을 바꾸는 release", `project-docs/products/roadmap/domain.md`의 "skill"과 "MCP server와 경계, 여러 domain을 쓰는 agent > 유지보수"
  - 쓰기 전: `.claude/skills/write-test/SKILL.md`
- 계약:
  - 쓰는 것: `PublicToolsChanged`(`dp-public-event`), `app.usage`의 조회 함수(`dp-usage-read`가 `packages/core/apps/usage/`에 내놓는 `appToolUsers`), `domain-tools` 계약의 tool 선언 목록(이름, input·output schema, effect, `public`. 이름과 위치는 그 계약을 따른다)
  - 내놓는 것:
    - `packages/core/apps/releases/public-tools.ts`: `diffTools(previous, next)`(순수 함수. 추가·삭제·바뀜 — input schema, output schema, effect, `public` 중 하나라도 다르면 바뀜 — 을 이름별로 돌려준다)와 `blockedBy(removedPublic, users)`.
    - activation의 막힘: 새 release가 지운 공개 tool을 다른 project가 쓰면(grant가 열려 있거나 invocation 기록이 있다) activation이 시작되지 않는다. release는 `prepared`로 남는다.

## 할 일

1. `public-tools.ts`를 만든다: 이전 active release와 새 release의 tool 선언 목록을 비교한다(`diffTools`). 이전 release가 없으면(첫 activation) 비교하지 않는다. 비교 재료는 release에 고정된 blueprint다(`packages/core/apps/releases/commands.ts`의 `releaseAndApp`, 같은 file의 `loadActiveRelease`, `packages/core/apps/blueprint`의 `Blueprint`).
2. 막기. `activation/handler.ts`의 `judge`가 `deps.enqueue` 또는 보류 request를 만들기 전에 검사한다: 지워진 공개 tool 중 `appToolUsers`가 다른 project의 사용을 돌려주는 것이 하나라도 있으면 enqueue하지 않는다. 막힌 사실을 event로 남기려면 tx가 필요하다(domain event는 command의 tx가 쓴다). 그래서 machine 자격 command `activation.block`을 하나 둔다(`packages/protocol/apps/activation/activation.ts`에 route, `packages/core/apps/releases/commands.ts`에 handler, 등록은 lead). 이 command가 같은 tx에서 `PublicToolsChanged { change: "blocked" }`를 그 앱 project에 낸다. 같은 release·같은 tool 집합의 반복 막힘은 event를 한 번만 낸다(멱등 key를 release id와 tool 집합 hash로 둔다). `activationStart`(207째 줄)에도 같은 검사를 두어 정말로 막는다(`conflict`, "release removes public tools used by another project"). 판정 handler만 믿지 않는다.
3. 알리기. `completeActivation`(259째 줄)이 새 active 참조를 확정하는 같은 tx에서 `diffTools` 결과가 비어 있지 않으면 `PublicToolsChanged { change: "changed" }`를 낸다. 받는 project: (a) 그 앱의 project(어떤 tool이 바뀌었든), (b) 바뀌거나 지워진 공개 tool을 쓰는 다른 project마다 하나(`appToolUsers`). 한 project에 한 event이고 `tools`에 그 project가 쓰는 바뀐 tool 이름만 싣는다.
4. 이전 release의 선언은 있고 새 release에서 사라진 비공개 tool은 막지 않는다(자기 project의 일이다). 공개였다가 비공개가 된 tool은 "공개 tool을 지움"으로 본다.
5. 위험 test를 쓴다(아래). `diffTools`·`blockedBy`는 순수 함수라 fake로 부르고, `activationStart` 막힘은 기존 release test의 sqlite fixture에 두 project 사용 기록을 더해 한 번 확인한다.
6. App Engineer 문구가 `packages/core/apps/releases/` 아래에 남아 있으면 PM으로 고친다(`dp-storage-apps`가 대부분 처리했다).

## 끝남

- `deno task check`가 통과한다.
- 위험 test: "다른 project가 쓰는 공개 tool을 지운 release는 activation이 시작되지 않고(`prepared`로 남는다), 아무도 안 쓰는 공개 tool이나 자기 project만 쓰는 tool을 지운 release는 막히지 않는다." 한 file에 둘 이하.
- 남지 않음: `grep -rn "App Engineer\|app_engineer" packages/core/apps/releases`가 0줄이다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: `activation.block` route(`packages/protocol/apps/registry.ts`의 `ROUTES`와 `activation/mod.ts`의 `ACTIVATION_ROUTES`), 그 command의 machine 허락(`packages/core/main/daemon/wiring/apps.ts`의 operation policy)
- 안 쓰게 된 export
- 정한 것: 공개였다가 비공개가 된 tool은 지운 것으로 본다 / "쓴다"의 기준은 `app.usage`(grant 또는 invocation 기록)이다 / 막힌 release는 사람이 풀지 않는다(새 release를 만들면 다시 판정한다)
- 넘길 줄: tool 선언 목록의 정확한 field 이름은 `domain-tools` 계약을 따랐다
- 계약 바꾸기 요청
- **무겁게 짠 것**
- **알려진 미완 동작**: 막힌 사실을 사람 toast로 알리지 않는다(PM session이 사람에게 올린다)
