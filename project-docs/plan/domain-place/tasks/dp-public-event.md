# dp-public-event

공개 tool이 바뀌었을 때 project의 PM을 깨우는 reaction event `PublicToolsChanged`를 더한다. 이 task는 event를 정의하고 PM session을 여는 길(reaction, 끄기 설정, 설정 화면, 대기 목록 표기)까지만 한다. event를 내는 곳은 `dp-release-guard`다.

- 단위: public-tools (wave 2)
- 선행: 없음. wave 3은 계획 `domain-tools`의 계약 task(blueprint `public` 칸)가 main에 land한 뒤에 연다. planner(`lophn-7e`)가 land를 알려 준 뒤 띄운다.
- 소유(이 task만 고친다):
  - `packages/protocol/events/domain.ts`
  - `packages/protocol/approvals/grants.ts`
  - `packages/core/events/reactor/session-opening.ts`
  - `packages/core/approvals/approvals_test.ts`
  - `packages/shell/renderer/desktop/settings/reactions/`
  - `packages/shell/renderer/desktop/connection/waiting/model.ts`
  - `packages/design/wording/catalog/workspace-settings.ts`
  - `packages/design/wording/catalog/data.ts`
- 읽을 것:
  - architecture: `project-docs/architecture/event.md`, `project-docs/architecture/approval.md`(reaction grant), `project-docs/architecture/agent-call.md`
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `events`, `approvals`, `router`, `project-docs/module-catalog.yaml`의 `packages/core/events`
  - 제품 결정: `project-docs/plan/domain-place/README.md`의 "정한 것 > 공개 tool을 바꾸는 release", `project-docs/products/roadmap/domain.md`의 "skill"
  - 쓰는 규칙: `.claude/skills/wording/SKILL.md`
- 계약:
  - 쓰는 것: `dp-app-project`의 `appProjectOf`는 쓰지 않는다(event payload가 대상 project를 싣는다)
  - 내놓는 것: domain event `PublicToolsChanged`
    - subject `idSchema("app")`
    - payload `{ release: Id<"rel">, project: Id<"prj">, change: "changed" | "blocked", tools: string[] }`. `project`는 깨울 PM의 project이고 `tools`는 바뀌거나 막힌 tool 이름이다. 한 사실에 project마다 event 하나를 낸다.
    - 종류는 `new_work`(reaction grant로 끌 수 있다). `REACTION_EVENT_TYPES`와 `reactionGrantSchema`에 `PublicToolsChanged`가 더해진다. 기본 mode는 `open`(묻지 않고 연다).
    - 받는 agent: `{ role: "project_manager", project: payload.project }`. 새 session 본문(program이 쓴 글): changed면 "A tool of an app you use or own changed (…). Re-check the skills that call it.", blocked면 "A release was blocked because it removes public tools that other projects use (…)."

## 할 일

1. `packages/protocol/events/domain.ts`: `publicToolsChanged`를 정의하고 `DOMAIN_EVENTS`, `domainEventSchema`, `DOMAIN_EVENT_KINDS`(`new_work`)에 더한다. `NewWorkTypes === ReactionEventType` 검사(169째 줄 아래)가 통과하게 `packages/protocol/approvals/grants.ts`의 `REACTION_EVENT_TYPES`(101째 줄)와 `reactionGrantSchema`(119째 줄)에 같은 이름을 더한다.
2. `packages/core/events/reactor/session-opening.ts`: `callOf`에 `PublicToolsChanged` 갈래를 더하고(`to`는 payload의 project의 PM, `refs`는 비운다) `registerNewWorkHandlers`에 handler를 등록한다. 이 file은 `dp-place-events`(앞 wave)와 `domain-kinds`도 고친다. 해당 갈래만 더한다. 근거: reaction grant가 새 일을 끄고 켜는 길이 이 handler 하나다(`handlerFor`).
3. `packages/core/approvals/approvals_test.ts`의 reaction grant 모양 단언(166~170째 줄)에 새 event를 맞춘다. 핵심 확인은 기존 test가 한다. 새 test를 쓰지 않는다.
4. 화면: `packages/shell/renderer/desktop/settings/reactions/{model,source}.ts`와 `testdata/fake-source.ts`의 event 목록에 한 줄을 더하고(`name`, `when`, `opens: settings.reaction.opens-project-manager`), `packages/shell/renderer/desktop/connection/waiting/model.ts`의 `EVENT_LABELS`(103째 줄)와 `opens` 판정(334째 줄)에 더한다. wording key는 `packages/design/wording/catalog/workspace-settings.ts`·`packages/design/wording/catalog/data.ts`에 더한다(PM이 연다는 기존 key를 재사용한다). `deno task wording`으로 생성물을 맞춘다. 새 화면을 그리지 않는다.
5. 위험 test는 두지 않는다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test: 없음(event 정의와 반응 등록이다. 판정은 `dp-release-guard`가 시험한다)
- 남지 않음: `grep -rn "PublicToolsChanged" packages`가 위 소유 file들에만 있다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: wording 생성물(`deno task wording`), `packages/protocol/events/mod.ts`의 export 목록(있으면)
- 안 쓰게 된 export
- 정한 것: event 이름과 payload / 기본 mode
- 넘길 줄: `domain-kinds`가 같은 목록에 `ContextViolationFound` 쪽을 고치면 두 쪽을 다 남긴다
- 계약 바꾸기 요청
- **무겁게 짠 것**
- **알려진 미완 동작**
