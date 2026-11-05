# acp-screen

채팅 화면이 대화 밖 session 기능(model·effort, mode, slash 명령, rewind, fork, compact, 이름, 사용량)을 ACP 상태의 `session` meta로 그리고 `AgentTabSource.act`로 보낸다. 첫 판의 `external` 숨김(15곳)을 capability 검사로 바꾼다(README 정한 것 5). lophn agent 화면과 harness 화면이 같은 화면이다.

- 단위: acp (wave 2)
- 선행: acp-session
- 소유(이 task만 고친다):
  - `packages/shell/renderer/conversation/agent-tab-source.ts`
  - `packages/shell/renderer/conversation/agent-view.tsx`
  - `packages/shell/renderer/conversation/thread-layout.ts`(`info` notice를 turn 끝으로 읽지 않게)
  - `packages/shell/renderer/conversation/agent-view-model.ts`
  - `packages/shell/renderer/conversation/agent-thread.tsx`
  - `packages/shell/renderer/conversation/composer/`
  - `packages/shell/renderer/conversation/header/`
  - `packages/shell/renderer/conversation/approval-card/`
  - `packages/shell/renderer/conversation/model-picker/`
  - `packages/shell/renderer/conversation/slash-menu/`
  - `packages/shell/renderer/conversation/session-rewind/`
  - `packages/shell/renderer/conversation/status-view/`
  - `packages/shell/renderer/conversation/use-model-picker.ts`
  - `packages/shell/renderer/conversation/use-slash-menu.tsx`
  - `packages/shell/renderer/conversation/agent-tab-core-source.ts`
  - `packages/shell/renderer/conversation/agent-tab-core-source-{model,commands,sessions,rewind,status}.ts`
  - `packages/shell/renderer/conversation/agent-tab-fake-source.ts`
  - `packages/shell/renderer/conversation/agent-tab-fake-{commands,models}.ts`
  - `packages/design/i18n/catalog/conversation.ts`
  - `tools/wireframes/pages/screens/agent-tab/`
- 읽을 것:
  - architecture: `project-docs/architecture/agent-chat.md`, `acp.md`
  - skill: `.claude/skills/ui-design/SKILL.md`(화면을 바꾸면 gallery를 같이 고친다)
  - 계획: `project-docs/plan/harness-gui-tab/README.md` 정한 것 5, 12, `tasks/acp-session.md`(새 ACP 꼴과 `act`), `tasks/acp-core.md`(lophn이 무엇을 채우는가)
  - 조사: `/home/pyosechang/projects/lophn/.cache/harness-gui-research/code.md` §4(`external` 15곳과 source member)
  - 지금 화면: `packages/shell/renderer/conversation/agent-view.tsx`(`runSlash :445-509`, status `:256,:439`, permissions `:290`, fork `:423`, 승인 `:717`, skip `:802`), `use-model-picker.ts`, `use-slash-menu.tsx`, `composer/agent-composer.tsx`(`:230` slash, `:368` ModelPicker, `:408` 권한 요약, skip `:82-83`), `agent-thread.tsx`(`:226` Fork, `:339` 승인 결과, `:426` Rewind), `header/agent-header.tsx`(`:115` 이름, `:175`, `:272` session menu), `approval-card/approval-card.tsx`(`:163,253,295,316`), `approval-card/subject-text.ts`, `session-rewind/rewind-panel.tsx`, `status-view/`, `model-picker/types.ts`, `slash-menu/types.ts`
  - 본보기(화면): `tools/wireframes/pages/screens/agent-tab/`
- 계약:
  - 쓰는 것: acp-session의 `AcpState.session`, `AcpCapabilities`, 새 `AcpInput`, `AgentTabSource.act`, 승인 범위(`once`·`session`·`always`·`reject`)
  - 내놓는 것: capability가 있는 기능만 보이는 채팅 화면. `external`을 읽지 않는다(안 쓰게 된 칸으로 보고한다)

## 할 일

화면은 lophn agent와 harness를 가르지 않고 ACP 상태의 `session` meta와 `capabilities`만 본다. lophn 화면은 지금과 같아 보여야 한다(lophn이 채우는 값은 `acp-core`, harness가 채우는 값은 wave 3).

1. source에서 ACP로 옮긴 기능은 화면이 `acp().session`을 읽고 `act`로 보낸다. 옛 member(`model`, `chooseModel`, `setModelOption`, `commands`, `runCommand`, `status`, `renameSession`, `changeSkip`, `forkSession`, `compactSession`, `rewind`)는 `agent-tab-source.ts`에서 optional로 바꿔 부르지 않는다. 지우지는 않는다(같은 wave의 `tab-gui`가 gui source에서 쓰고 있다. lead가 wave 뒤에 `external`과 같이 지운다). core·fake source에서는 구현을 지운다(`agent-tab-core-source-{model,commands,sessions,rewind,status}.ts`의 해당 함수와 그것만 쓰던 import). `rewindPoints`, `rewindPreview`(files·apps 목록), `permissions`(lophn의 할당 보기), session 목록·열기·archive·delete는 source read로 남는다(ACP가 다루지 않는다).
2. model picker(`use-model-picker.ts`, `composer/agent-composer.tsx`, `model-picker/`): `session.models`·`session.model`로 그린다. 고르면 `act({type: "set_model", model, options})`, 축 값을 바꾸면 같은 입력에 바뀐 `options`. 검색은 묶음 목록을 화면에서 거른다. 단추는 `capabilities.model`, 축 칸은 `capabilities.effort`일 때만.
3. mode(`composer/agent-composer.tsx`의 skip 단추): `session.modes`가 둘 이상이면 지금 mode 이름의 단추와 menu, 고르면 `act({type: "set_mode", mode})`. `capabilities.mode`일 때만. lophn은 `ask`·`skip` 둘이라 지금 단추 자리 그대로다.
4. slash(`use-slash-menu.tsx`, `slash-menu/`): 목록은 `session.commands`를 query로 거른 것이다(`capabilities.commands`일 때만). 실행(`agent-view.tsx` `runSlash`): `builtin`은 지금처럼 화면이 하되 ACP 기능으로 간다(`rename`, `compact`, `fork`는 `act`, `status`는 `session.usage`로 status 보기, `permissions`는 source가 있을 때, `mcp`·`skills`는 host, `new`·`archive`는 lophn session 관리). `skill`·`cli`는 `act({type: "run_command", name, argument})`.
5. status 보기(`status-view/`, `agent-view.tsx:256,439`): `session.usage`·`session.model`·`session.title`로 그린다. `capabilities.usage`일 때만 `/status`와 footer.
6. rewind·fork(`agent-thread.tsx`, `session-rewind/rewind-panel.tsx`, `agent-view.tsx:423`): 메시지의 Rewind는 `capabilities.rewind`, panel의 파일 복원 칸은 `capabilities.rewind_files`일 때. 적용은 `act({type: "rewind", message, files, apps})`. Fork는 `capabilities.fork`일 때 `act({type: "fork", message})`이고 결과에 `session`이 있으면 그 session으로 간다(lophn). 없으면 같은 탭의 상태가 바뀐다(harness).
7. header(`header/agent-header.tsx`): 이름 바꾸기는 `capabilities.rename`일 때 `act({type: "rename", title})`, session menu(바꾸기·새로·archive·delete)는 `capabilities.sessions`일 때. `session.title`이 있으면 제목이다.
8. 승인(`approval-card/`, `agent-thread.tsx:339`): 단추는 `approval.choices` 순서대로 그린다. `session`은 "Allow for this session", `always`는 "Always allow"와 패턴 목록(영구), 결정은 `act({type: "decide", request, choice})`. 결과 줄의 "This session"은 항목의 `choice === "session"`이다. `subject-text.ts`가 `file_change` subject를 path와 바꾸기 종류, 줄 수로 쓴다.
9. plan: `state.plan`이 있으면 composer 위에 항목 목록(글과 상태)을 그린다. 새 component는 `composer/` 안에 둔다. lophn은 null이라 보이지 않는다.
10. 이미지: 붙이기는 `capabilities.images`일 때만. `uploadImage`가 준 block을 그대로 메시지에 넣는다(`acp-session`이 결과를 `{block}`으로 바꿨다).
11. `external`: 이 task 소유 file에서 `external`을 읽는 곳을 모두 위 capability와 `choices` 검사로 바꾼다(`agent-view.tsx:201`에서 읽어 내려보내는 다섯 곳과 받는 쪽: composer 셋, thread 셋, header 둘, 승인 카드 넷). `AgentTabSource.external` 칸 자체는 지우지 않고 보고한다.
12. 화면 문구는 `packages/design/i18n/catalog/conversation.ts`에 둔다(mode menu, plan 목록, `file_change` subject). `/status`·승인 카드의 새 갈래는 gallery `tools/wireframes/pages/screens/agent-tab/`의 fake data에 넣어 보인다(fake source가 `session` meta와 `plan`을 낸다).

등록할 것(lead): 없으면 없음. 안 쓰게 된 `AgentTabSource.external`과 lophn 꼴 view type은 보고하고 lead가 tab-gui와 합친 뒤 지운다.

## 끝남

- `npm run check`가 통과한다. `npm run wireframes`가 되고 gallery의 Agent 탭 page들이 model picker, mode, slash, `/status`, 승인 카드(세 범위), plan 목록을 새 꼴로 그린다.
- 위험 test: 없음(화면이다).
- 남지 않음: 이 task 소유 file에서 `grep -n "external" packages/shell/renderer/conversation/{agent-view.tsx,agent-thread.tsx} packages/shell/renderer/conversation/{composer,header,approval-card}/`의 `AgentTabSource.external` 읽기가 0줄. `grep -rn "source\.\(model\|chooseModel\|setModelOption\|commands\|runCommand\|status\|renameSession\|changeSkip\|forkSession\|compactSession\)(" packages/shell/renderer/conversation`가 0줄.

## 보고

`.claude/skills/orchestrate/brief-template.md`의 "보고"대로. 안 쓰게 된 `AgentTabSource` member와 lophn 꼴 view type(`ModelView`, `StatusView`, `SlashGroupView` 등)을 "안 쓰게 된 export"에 적는다(lead가 `tab-gui`와 합친 뒤 지운다). 화면에서 그리지 못한 capability가 있으면 적는다.
