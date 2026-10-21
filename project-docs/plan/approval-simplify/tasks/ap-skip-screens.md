# ap-skip-screens

skip을 켜고 끄는 자리를 대화 화면에 두고, Operator 편집 화면의 정의에 skip 기본값 칸을 둔다. `ui-design` skill로 wireframe부터 고치고 문구는 `wording` skill을 따른다.

- 단위: skip (wave 3)
- 선행: ap-skip-session
- 소유(이 task만 고친다):
  - `packages/shell/renderer/conversation/agent-tab-core-source.ts`
  - `tools/wireframes/pages/screens/agent-chat.tsx`
  - `packages/shell/renderer/conversation/composer/`
  - `packages/shell/renderer/conversation/header/`
  - `packages/shell/renderer/conversation/{agent-tab-source.ts,agent-tab-core-source-sessions.ts,agent-tab-core-source-commands.ts,agent-tab-fake-source.ts,agent-tab-fake-commands.ts,agent-view.tsx}`
  - `packages/shell/renderer/workspace/agents/editor/{definition-form.tsx,agent-editor.tsx}`
  - `packages/shell/renderer/workspace/agents/{core-source.ts,source.ts,fake-source.ts,fake-data.ts,views.ts}`
  - `tools/wireframes/pages/screens/agent-tab/scenes.tsx`
  - `tools/wireframes/pages/screens/{agent-pages.tsx,agent.tsx,agent-settings.tsx}`
  - `tools/wireframes/pages/screens/agent-setup/agent-setup-pages.tsx`
  - `packages/design/wording/catalog/`
- 읽을 것:
  - 계획: `project-docs/plan/approval-simplify/README.md`의 "정한 것"(skip은 session 표시와 Operator 정의의 기본값 칸이다, 정의 칸은 사람만 쓴다)과 "뼈대 검토에서 정한 것"(turn mode는 turn을 시작할 때 정하고 바뀌지 않는다, fork는 skip을 가져가지 않는다, CLI의 `--dangerously-skip-permissions`는 두지 않는다)
  - roadmap: `project-docs/products/roadmap/approval.md`의 "turn mode"(skip은 묻지 않고 실행한다, `deny`는 어느 mode에서나 막는다, skip은 call을 따라 가지 않는다)
  - architecture: `project-docs/architecture/place-session.md`("fork는 있는 그대로 복사하되 묶인 것은 놓고 간다"), `project-docs/architecture/agent-definition.md`("Operator 정의를 만들고 고치는 tool은 grant를 주지 못한다"), `project-docs/architecture/ui-kit.md`의 "gallery가 정본이다"
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `shell`, `lophn-agent`, `design-api`; `project-docs/module-catalog.yaml`의 `packages/shell/renderer`, `packages/design`
  - skill: `.claude/skills/ui-design/SKILL.md`("모든 화면의 규칙": 토글은 줄 오른쪽 끝 고정 열), `.claude/skills/wording/SKILL.md`, `.claude/skills/write-test/SKILL.md`
  - 계약(ap-skip-session이 만든 것. 이름은 그 file과 보고에서 확인한다):
    - `packages/protocol/lophn-agent/sessions.ts`의 `ChangeSessionSkip` route 정의(resource `sessions`, method `change-skip`, 입력 `{ session, skip }`, compare `{ state_seq }`, actors `user`)
    - `packages/protocol/lophn-agent/agent-sessions.ts`의 session record `skip: boolean`(`ReadSession`·`ListSessions` 출력)
    - `packages/protocol/lophn-agent/agent-values.ts`, `packages/protocol/lophn-agent/operators.ts`의 Operator 정의 `skip?: boolean`
  - 본보기(화면): `tools/wireframes/pages/screens/agent.tsx`(대화 영역 file), `tools/wireframes/pages/screens/agent-tab/scenes.tsx`, `tools/wireframes/pages/screens/agent-pages.tsx`, `tools/wireframes/pages/screens/conversation.tsx`(장면 adapter. 소유 밖. `AGENT_TAB_SCENES`에 든 이름은 그대로 장면이 된다), `tools/wireframes/pages/screens/agent-settings.tsx`(agent 설정 영역 file), `tools/wireframes/pages/screens/agent-setup/agent-setup-pages.tsx`(`OperatorEditorPage`)
  - renderer
    - 대화: `packages/shell/renderer/conversation/composer/agent-composer.tsx`(입력칸 밖 아래 줄 `data-composer-scope`: 자리 이름과 권한 요약), `packages/shell/renderer/conversation/agent-view.tsx`(`entry`, `refresh`, `perform`), `packages/shell/renderer/conversation/agent-tab-source.ts`(`SessionEntry`, `AgentTabSource`), `packages/shell/renderer/conversation/header/agent-header.tsx`(Fork)
    - 정의: `packages/shell/renderer/workspace/agents/editor/definition-form.tsx`(`Group`, Domains의 `Checkbox`), `packages/shell/renderer/workspace/agents/source.ts`(`AgentDraft`), `packages/shell/renderer/workspace/agents/core-source.ts`(`builtInDefinition`, `operatorCreate`·`operatorChange`에 `draft`를 그대로 보낸다)
  - source: core `packages/shell/renderer/conversation/agent-tab-core-source-sessions.ts`(`readSessions`, `renameSessionTo`의 state_seq 읽기 꼴), 조립 `packages/shell/renderer/conversation/agent-tab-core-source.ts`; fake `packages/shell/renderer/conversation/agent-tab-fake-source.ts`(`AGENT_TAB_SCENES`, `sessions`, `patchSession`), `packages/shell/renderer/workspace/agents/{fake-source.ts,fake-data.ts}`
  - `SessionEntry`를 손으로 만드는 wireframe: `tools/wireframes/pages/screens/agent-chat.tsx`(두 곳)
- 계약:
  - 쓰는 것: `ChangeSessionSkip`, session record `skip`, Operator 정의 `skip`(ap-skip-session)
  - 내놓는 것: 없음(화면)

## 할 일

근거: README "정한 것"(skip은 session 표시와 Operator 정의의 기본값 칸, 정의 칸은 사람만 쓴다), roadmap "turn mode"(skip은 묻지 않는다, deny는 skip에서도 막는다), README "뼈대 검토에서 정한 것"(fork는 skip을 가져가지 않는다, turn mode는 turn 시작 때 정한다, CLI flag는 없다). session의 skip은 사람 자격만 바꾸고(`ChangeSessionSkip` actors `user`) 새 session의 값은 core가 정의 기본값으로 정한다(ap-skip-session). 화면은 record를 보이고 사람의 켜고 끄기를 보낼 뿐이다. gallery는 renderer component를 그대로 그리므로(`ui-kit.md` "gallery가 정본이다") 1과 2~6을 같이 바꿔야 그려진다.

1. gallery부터 고친다(ui-design skill "새 화면 만들기" 4~7).
   - `tools/wireframes/pages/screens/agent-tab/scenes.tsx`: `SkipScene = () => <Scene sub="skip" />`를 더한다(주석: skip을 켠 session. composer 아래 줄 오른쪽 끝 Skip permissions가 켜져 있다).
   - `tools/wireframes/pages/screens/agent-pages.tsx`: `AgentSkip = SkipScene`.
   - `tools/wireframes/pages/screens/agent.tsx`: page `new-agent-skip`(title "Agent · skip permissions")를 더한다. 설명: 입력칸 밖 아래 줄 오른쪽 끝의 스위치로 이 session의 skip을 켜고 끈다. 켜면 shell 명령을 묻지 않지만 deny 규칙은 막는다. 바꾼 값은 다음 turn부터다.
   - `tools/wireframes/pages/screens/agent-settings.tsx`: `new-operator-editor` 설명에 skip 기본값 칸(새 session을 skip으로 시작)을 더한다. 새 page는 두지 않는다.
   - `tools/wireframes/pages/screens/agent-setup/agent-setup-pages.tsx`: 고칠 것이 없으면 두지 않는다.
2. 대화 fake(`agent-tab-fake-source.ts`, `agent-tab-fake-commands.ts`).
   - `AGENT_TAB_SCENES`에 `"skip"`을 더한다. 대화 내용은 `report`와 같고 `SESSION_MAIN`의 `skip`만 `true`다. 다른 장면의 session은 `skip: false`다.
   - `changeSkip(session, skip)`은 `patchSession`으로 바꾸고 알린다.
   - `agent-tab-fake-commands.ts`: 고칠 것이 없으면 두지 않는다.
3. 대화 화면 값과 통로.
   - `agent-tab-source.ts`: `SessionEntry.skip: boolean`. `AgentTabSource.changeSkip(session: string, skip: boolean): Promise<SourceResult<void>>`. 주석에 "다음 turn부터, 사람만"을 적는다.
   - `agent-tab-core-source-sessions.ts`: `readSessions`가 record의 `skip`을 싣는다. `changeSkipOf(env, session, skip)`는 `renameSessionTo`처럼 record의 `state_seq`를 읽고 `ChangeSessionSkip`을 `{ input: { session, skip }, compare: { state_seq }, key: "sessions-skip-<session>-<state_seq>-<on|off>" }`로 보낸다.
   - `agent-tab-core-source-commands.ts`: 고칠 것이 없으면 두지 않는다.
4. 대화 화면(정한 것 1).
   - `composer/agent-composer.tsx`: prop `skip?: { readonly on: boolean; readonly onChange: (on: boolean) => void }`. 주면 `data-composer-scope` 줄의 오른쪽 끝 고정 열에 design `Switch`(label "Skip permissions", `data-composer-skip`)를 그린다. 주지 않으면 그리지 않는다(`agent-chat.tsx`의 composer가 그대로 선다). 머리 주석의 아래 줄 설명을 고친다.
   - `agent-view.tsx`: 열린 session(`entry`가 있고 archive하지 않음)이면 composer에 `skip`을 넘긴다. `on`은 `entry.skip`이고, 바꾸면 `perform`으로 `source.changeSkip(session, on)`을 보내고 성공하면 `refresh()`로 session 목록을 다시 읽는다. 아직 만들지 않은 새 session과 archive한 session에는 넘기지 않는다(정한 것 2). 새 session 자리의 `SessionEntry`(`shown`)에는 `skip: false`를 넣는다.
   - `header/`: 고치지 않는다. Fork는 그대로이고 새 session의 skip은 core가 정한다.
5. Operator 정의 칸(정한 것 3).
   - `workspace/agents/source.ts`: `AgentDraft.skip?: boolean`. 주석: Operator만 가진다, 사람만 쓴다.
   - `editor/definition-form.tsx`: Operator일 때만(`detail.kind === "operator"`) MCP 칸 뒤에 `Group name="skip"`을 두고 그 안에 `Checkbox`(새 session을 Skip permissions로 시작)와 안내 한 줄을 둔다. 끄면 칸을 지운다(`skip: undefined`). 파일에는 사람이 바꾼 칸만 든다는 지금 규칙을 따른다.
   - `workspace/agents/core-source.ts`: `builtInDefinition`이 이미 내장 role의 칸을 골라 보내니 고칠 것이 없는지 본다. Operator의 `draft`는 `skip`을 그대로 싣는다.
   - `editor/agent-editor.tsx`, `workspace/agents/{fake-source.ts,fake-data.ts,views.ts}`: 고칠 것이 없으면 두지 않는다. fake Operator는 `skip`이 없다(꺼진 칸).
6. 조립과 wireframe의 최소 맞춤.
   - `packages/shell/renderer/conversation/agent-tab-core-source.ts`: source 조립에 `changeSkip: (session, skip) => changeSkipOf(env, session, skip)` 한 줄과 import. 없으면 `AgentTabSource`를 채우지 못해 type check가 깨진다.
   - `tools/wireframes/pages/screens/agent-chat.tsx`: `SessionEntry`를 만드는 두 곳(`entryOf`, `current`)에 `skip: false`.
7. wording.
   - `packages/design/wording/catalog/conversation.ts`: `conversation.label.skip-permissions`("Skip permissions").
   - `packages/design/wording/catalog/agents.ts`: skip 칸의 제목, `Checkbox` 이름, 안내 한 줄(새 session은 shell 명령을 묻지 않는다, deny 규칙은 막는다).
   - `deno task wording`, `deno run --allow-read tools/check-wording.ts`

정한 것:
1. session의 skip 자리는 composer 아래 줄(`data-composer-scope`) 오른쪽 끝의 `Switch` 하나다. 이유: 켜진 것이 입력할 때마다 보인다. header 더보기 menu에 두면 켜져 있는지 보이지 않는다. 바로 바뀌는 설정이라 `Switch`다(design `input/mod.ts`).
2. 아직 만들지 않은 새 session에는 skip 자리가 없다. 이유: `ChangeSessionSkip`은 있는 session에만 보낸다. 첫 말을 보내 session이 열리면 정의 기본값대로 보인다. 바꾼 값은 다음 turn부터다(turn mode는 turn 시작 때 정한다).
3. 정의 칸은 `Checkbox`이고 Operator에만 있다. 이유: 정의 form은 [Save]로 제출하고(design: 제출하는 선택은 `Checkbox`), README가 "Operator 정의의 기본값 칸"으로 정했다. 내장 role은 그 칸이 없다.

## 끝남

- `deno task check`가 통과한다.
- `deno run -A packages/shell/renderer/build.ts`가 통과한다.
- `deno run --allow-read tools/check-wording.ts`에 오류가 없다.
- `deno task wireframes`가 되고 gallery에서 다음이 그려진다.
  - `new-agent-skip`: composer 아래 줄 오른쪽 끝에 Skip permissions 스위치가 켜져 있다.
  - `new-agent-conversation`(그 밖의 열린 session 장면): 같은 자리에 스위치가 꺼져 있다. `new-agent-session-archived`에는 없다.
  - `new-operator-editor`: Definition 탭의 MCP 칸 뒤에 skip 기본값 `Checkbox`가 꺼진 채 있다. `new-agent-editor-app-engineer`에는 없다.
- 위험 test: 없음. 화면이다. 정의 칸을 사람만 쓰는 경계와 fork가 skip을 가져가지 않는 규칙은 core(ap-skip-session)가 지킨다.
- 남지 않음: 지우는 이름이 없다. `grep -rn --exclude-dir=dist "dangerously" packages/shell/renderer tools/wireframes packages/design/wording`가 0줄이다(CLI flag를 화면 문구에 쓰지 않는다).

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: lead가 고칠 목록 file(`protocol/*/mod.ts`, core 조립 목록, wording 생성, gallery `pages/index.ts`, `deno.json`)
- 안 쓰게 된 export(남이 쓰던 것은 지우지 않는다)
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 넘길 줄: 남의 file을 최소로 맞춘 곳
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- **무겁게 짠 것**: 가장 단순한 구현(AGENTS.md "속도")보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것. 없으면 "없음". 적어도 확인해 적는다: 새 session의 첫 turn은 정의 기본값으로만 skip이다(정한 것 2), 도는 turn에서 바꾼 skip은 다음 turn부터다.
