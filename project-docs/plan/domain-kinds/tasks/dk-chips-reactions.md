# dk-chips-reactions

두 가지를 한다.

1. **context·위반 chip을 없앤다.** composer 위에 붙던 context chip과 위반 chip, 그것을 `SendMessage.attached`로 보내고 본문 part로 남기고 agent 입력에 `<lophn-attached>`로 싣던 길에서 `context`·`violation` 종류를 지운다. `file` 종류는 protocol에 그대로 둔다(아래 "정한 것").
2. **위반 반응을 새 event로 바꾼다.** shell의 toast, 설정 화면 줄, waiting 카드가 `ContextViolationFound` 대신 `KindViolationFound`(`dk-event`가 만들었다)를 다룬다. 옛 event 줄과 wording key는 지운다.

코드 이름은 아직 `project_manager`다.

- 단위: chips (wave 3)
- 선행: dk-shell-workspace
- 소유(이 task만 고친다):
  - `packages/protocol/lophn-agent/inputs.ts`
  - `packages/protocol/lophn-agent/input-tags.ts`
  - `packages/protocol/lophn-agent/message-content.ts`
  - `packages/protocol/lophn-agent/messages.ts`
  - `packages/protocol/lophn-agent/sessions.ts`
  - `packages/core/lophn-agent/run-loop/input-text.ts`
  - `packages/shell/renderer/conversation/attached-chips.ts`
  - `packages/shell/renderer/conversation/attached-chips_test.ts`
  - `packages/shell/renderer/conversation/composer/`
  - `packages/shell/renderer/conversation/agent-view.tsx`
  - `packages/shell/renderer/conversation/agent-tab-core-source-commands.ts`
  - `packages/shell/renderer/conversation/agent-tab-core-source-thread.ts`
  - `packages/shell/renderer/conversation/agent-tab-fake-source.ts`
  - `packages/shell/renderer/conversation/agent-tab-source.ts`
  - `packages/shell/renderer/conversation/delivery-state.ts`
  - `packages/shell/renderer/conversation/delivery-state_test.ts`
  - `packages/shell/renderer/conversation/message-list/message-body.tsx`
  - `packages/shell/renderer/desktop/connection/events/reactions.ts`
  - `packages/shell/renderer/desktop/connection/toasts/toast-text.ts`
  - `packages/shell/renderer/desktop/connection/waiting/model.ts`
  - `packages/shell/renderer/desktop/settings/reactions/`
  - `tools/wireframes/pages/screens/agent-chat.tsx`
  - `tools/wireframes/pages/screens/waiting/waiting-pages.tsx`
- 추가 소유(wording catalog는 key를 더하고 지우는 데 그친다. 다른 task도 같은 file을 고친다):
  - `packages/design/wording/catalog/data.ts`
  - `packages/design/wording/catalog/data.placeholders.ts`
  - `packages/design/wording/catalog/workspace-settings.ts`
  - `packages/design/wording/catalog/workspace-settings.placeholders.ts`
- 읽을 것:
  - plan: `project-docs/plan/domain-kinds/README.md`("정한 것"의 위반, 화면: 위반 chip을 지운다), AGENT-ROLE E5(`project-docs/products/AGENT-ROLE.md` 6절)
  - architecture: `project-docs/architecture/event.md`, `project-docs/architecture/agent-definition.md`(입력 태그 `<lophn-attached>`)
  - 규칙: `.claude/skills/wording/SKILL.md`(key 규칙, 생성물은 `deno task wording`으로 만든다. placeholders를 손으로 고치지 않는다)
  - 지금 코드(고칠 곳):
    - chip: `packages/protocol/lophn-agent/inputs.ts`(`attachedChipSchema`의 `context`·`violation` 가지 ≈:21~33), `input-tags.ts`(`ATTACHED_KINDS` ≈:36, 태그 속성), `message-content.ts`(`attachedFields`의 `rule`·`context`·`line` 등 위반·context 전용 칸. 칸마다 쓰는 곳을 `rg`로 보고 `file`에 필요한 `name`·`path`만 남긴다), `messages.ts:30`(message link `kind: "context"`), `sessions.ts:57`(`openingTargetSchema`의 `idSchema("ctx")`), `core/lophn-agent/run-loop/input-text.ts:70~`(`attachedText`의 `context`·`violation` 분기). shell: `conversation/attached-chips.ts`(전체가 context·위반 chip을 `AttachedChip`/본문 part로 바꾸는 것이다), `composer/types.ts`(`ContextChipView`), `composer/agent-composer.tsx`(chip 줄 ≈:63~64,103,121,179~210과 css `.chips`·`.chip`), `agent-view.tsx`(`contextChips`·`onContextChips`·`chips`), `agent-tab-source.ts`(≈:71~72 part 모양, ≈:459~460 `chips`, ≈:541), `agent-tab-core-source-commands.ts`(`attachedPartsOf`·`attachedOf`·`attachedOfParts` 사용), `agent-tab-core-source-thread.ts:84`, `agent-tab-fake-source.ts`(`sender-chips` 시나리오 ≈:63,424, `attachedPartsOf`), `delivery-state.ts:18`(`chips`)과 test, `message-list/message-body.tsx:65`(attached part 그림)
    - reaction: `desktop/connection/events/reactions.ts`(`REACTION_EVENT_TYPES`, `ReactionAction`의 `project-manager` 가지, `case "ContextViolationFound"` ≈:87), `toasts/toast-text.ts:56`(`waiting.toast-violation.*`), `waiting/model.ts`(`EVENT_LABELS`의 옛 줄 ≈:108, PM 판정 ≈:334), `settings/reactions/model.ts`(`REACTION_ROWS`의 옛 줄 ≈:43, `DEFAULT_MODES` ≈:77), `settings/reactions/source.ts:13`(`REACTION_EVENTS`), `settings/reactions/testdata/fake-source.ts:15`(`SAMPLE_MODES`). wording: `data.ts`의 `waiting.label.event-context-violation`(:66), `waiting.toast-violation.*`(:152~155), `workspace-settings.ts`의 `settings.label.reaction-context-violation`(:122), `settings.reaction.context-violation-when`(:179). wireframes: `waiting/waiting-pages.tsx:77`(sample event), `agent-chat.tsx:226`(chip sample)
  - 계약: `packages/protocol/events/domain.ts`의 `kindViolationFound`(subject `prj`, payload `{ project, count }`)
- 계약:
  - 쓰는 것: event `KindViolationFound`
  - 내놓는 것: toast 문구 key `waiting.toast-kind-violation.{title,body,button}`, 설정 줄, 라벨

## 할 일

1. **chip 지우기(protocol → core → shell 순)**: 위 위치에서 `context`·`violation` 종류와 그것만 쓰던 칸·함수·UI를 지운다. `ATTACHED_KINDS`는 `["file"]`이 된다. `SendMessage.attached`·attached 본문 part·`<lophn-attached>` 태그는 `file` 종류로 남는다(shell은 만들지 않지만 protocol 모양은 둔다). `file` 쪽을 건드릴 일이 생기면 보고한다. `attached-chips_test.ts`는 지운다(지운 기능의 test). `delivery-state_test.ts`는 `chips: []` fixture 줄만 뺀다. 입력 type이 바뀌므로 `rg -n "attached:" tests packages --glob '*.ts'`로 호출 쪽(`tests/support/core/human.ts` 등)이 `attached: []`만 쓰는지 본다(그대로 통과해야 한다).
2. **toast**: `reactions.ts`의 `REACTION_EVENT_TYPES`에서 `"ContextViolationFound"`를 `"KindViolationFound"`로. `ReactionAction`의 project-manager 가지는 `{ kind: "project-manager"; project: string }`. 새 `case "KindViolationFound"`: `toast("kind-violation", event.seq, { project: event.payload.project, count: String(event.payload.count) }, { kind: "project-manager", project: event.payload.project })`(toast key는 `waiting.toast-${kind}.title/body`가 만든다). `toast-text.ts`: `waiting.toast-kind-violation.title/body/button` case(옛 case는 지운다). wording `data.ts`: 새 key 셋 — title `"Documents don't match the kinds"`, body `"A check found {count, plural, one {# new violation} other {# new violations}} in this project's documents."`, button `"Ask Project Manager"`. 옛 `waiting.toast-violation.*`·`waiting.label.event-context-violation` key는 지운다(`dk-event`가 더한 `waiting.label.event-kind-violation`은 남는다).
3. **waiting 카드**(`waiting/model.ts`): `EVENT_LABELS`에서 옛 줄을 지우고, "PM이 열린다" 판정(≈:334)에서 옛 event를 뺀다.
4. **설정 화면**(`settings/reactions/`): 옛 줄을 `KindViolationFound`로 바꾼다: `REACTION_ROWS`(name `settings.label.reaction-kind-violation`, when `settings.reaction.kind-violation-when`, opens `settings.reaction.opens-project-manager`), `DEFAULT_MODES`, `source.ts`의 `REACTION_EVENTS`, `testdata/fake-source.ts`의 `SAMPLE_MODES`. wording `workspace-settings.ts`: 새 key 둘 — name `"Kind violation"`, when `"A project gets kind violations it did not have at the last check."`. 옛 두 key는 지운다. 설정 key `reactions.kind_violation_found`는 `dk-event`의 grants가 이미 선언한다.
5. wireframes `waiting-pages.tsx`·`agent-chat.tsx`의 sample을 새 event와 chip 없는 모양으로 바꾼다.
6. wording 생성물은 `deno task wording`으로 다시 만든다(손으로 고치지 않는다).

## 정한 것

- `attached` 기구는 protocol에 `file` 종류만 남는다. shell에 `file` chip을 만드는 곳이 없어 사실상 쓰는 곳이 없다. 이 계획 범위(context·위반 chip)를 넘어 `attached` 전체를 걷어내면 `SendMessage` 입력과 본문 part가 바뀌어 e2e·router에 번지므로 하지 않는다. 보고에 "지울 만한 죽은 기구"로 적는다.
- toast의 "Ask Project Manager"는 chip 없이 PM 탭만 연다(`dk-shell-workspace`가 이미 바꿨다).

## 끝남

- `deno task check`가 통과한다.
- 위험 test: 없음(지운 기능의 test를 지웠다). 입력 schema의 `file` 종류가 그대로 받아들여지는지는 기존 test가 본다.
- 남지 않음: `rg -n "ContextViolationFound|toast-violation|event-context-violation|reaction-context-violation|context-violation-when|ContextChipView|contextChips|onContextChips" packages tools tests`가 `packages/protocol/events/domain.ts`·`packages/protocol/approvals/grants.ts`·`packages/core/events/reactor/session-opening.ts`·core approvals test 둘·옛 context core 코드(이미 지워졌어야 한다) 밖에서 0줄이다. 그 protocol·reactor 줄은 `dk-delete-protocol`이 지운다. `rg -n "attached: \"(context|violation)\"|kind: \"(context|violation)\"" packages --glob '*.ts*'`가 0줄이다.
- 화면: `deno task wireframes`가 되고, 설정 화면 Reactions에 Kind violation 줄이 있다.
- renderer build: `deno run -A packages/shell/renderer/build.ts`가 된다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: wording 생성물(`deno task wording`)
- 안 쓰게 된 export: 지운 wording key 이름
- 정한 것
- 넘길 줄: 없음
- 계약 바꾸기 요청: `attached` 기구 전체를 걷어낼지
- **무겁게 짠 것**
- **알려진 미완 동작**
