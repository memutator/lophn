# screens-conversation-composer

입력 쪽을 새로 옮긴다. composer(입력칸, model 단추, 보내기·Stop, project 표시, 권한 요약), 일하는 중 보낸 메시지가 쌓이는 "Next turn" 줄과 [Send now](steer), `/` 명령 창, model picker(안내 문구 없음), 위반 context chip이다. 보내기 방식을 고르는 menu는 없다. wireframe 코드(`agent-chat.tsx`의 `Composer`, `slash-menu.tsx`, `model-picker.tsx`, `agent-tab/queued.tsx`)를 renderer `conversation/`으로 옮긴다.

- 단위: screens-conversation (wave 3)
- 선행: screens-conversation-source (`Delivery`, `AgentTabSource.send`·`sendQueuedNow`·`removeQueued`·`stop`·`commands`·`model*`), screens-conversation-cards (권한 요약 popover가 `PermissionsView`를 쓴다)
- 소유(이 task만 고친다):
  - `packages/shell/renderer/conversation/composer/`
  - `packages/shell/renderer/conversation/slash-menu/`
  - `packages/shell/renderer/conversation/model-picker/`
  - `packages/shell/renderer/conversation/queued/` (새로)
  - `packages/shell/renderer/conversation/use-model-picker.ts`, `use-slash-menu.tsx`
  - `packages/design/wording/catalog/conversation.ts`와 생성물 `catalog/conversation.placeholders.ts` (wording-split이 만든 영역 file. ownership.md에 없어 추가 소유, lead 승인 2026-10-16)
- 읽을 것:
  - spec: S4 7장(commands: 전역 built-in, role built-in, skill. `recap` 추가) — `/home/pyosechang/projects/lophn/project-docs/tmp/specs/agent-definition.md`
  - spec: S1 6장(steer로 보낸 메시지는 도는 turn 안에서 `MessageReceived`), S8 4장(steer는 checkpoint가 아니다) — `/home/pyosechang/projects/lophn/project-docs/tmp/specs/event.md`, `/home/pyosechang/projects/lophn/project-docs/tmp/specs/place-session.md`
  - inventory: `U1.2#4`, `U2.2#5`, `U2.2#9`, `U2.2#10`, `U2.2#16`(composer의 context chip: 프로젝트 단위 줄이지만 composer 코드라 이 task가 맡는다), `U3.2#11`(위반 chip 쪽), `U6.5#1`, `U6.5#4`, `U6.5#5`(model picker 쪽), `I2.4#32`(전역 built-in 명령 표시 쪽), `U6.1#1`
  - 결정: `../README.md` 3장 #18·#23(steer), #41(tool 이름 철자는 화면과 무관), #57
  - 지금 코드(고칠 곳): `conversation/composer/agent-composer.tsx`(245줄: `SEND_MODES`, `permissionSummary`, `onOpenPermissions`), `slash-menu/slash-menu.tsx`(225줄: `choose_skill`, `skillOrigin`, `ORIGIN_LABEL`), `model-picker/model-picker.tsx`(252줄), `use-model-picker.ts`, `use-slash-menu.tsx`
  - 본보기(화면): `tools/wireframes/frames/compositions/agent-chat.tsx`(`Composer` 120줄~270줄), `slash-menu.tsx`(134줄), `model-picker.tsx`(304줄), `agent-tab/queued.tsx`(41줄), `agent-tab/agent-tab.module.css`, `compositions/agents.module.css`
- 계약:
  - 쓰는 것:
    - `AgentTabSource.send`, `sendQueuedNow`, `removeQueued`, `stop`, `commands`, `runCommand`, `model`·`chooseModel`·`setModelOption`·`toggleFavorite` (screens-conversation-source)
    - `PermissionsView` (screens-conversation-cards)
    - `@lophn/design/components`의 `Popover`, `Menu`, `IconButton`, `Button`, `Icon`, `VendorIcon`
  - 내놓는 것:
    - `composer/agent-composer.tsx`: `AgentComposer`. props에 `readOnly`(archive된 session은 입력칸 없이 안내만), `chip`(위반의 파일과 규칙을 실을 수 있는 context chip), `onCommand`.
    - `queued/queued-messages.tsx`: `QueuedMessages({ items, onSendNow, onRemove })`
    - `slash-menu/slash-menu.tsx`: `SlashMenu`, `slashQuery`
    - `model-picker/model-picker.tsx`: `ModelPicker`, `OptionAxes`, `ModelField`, `FavoritesContext`. 이 export들은 wireframe `model-picker.tsx`의 이름과 props를 그대로 둔다. screens-agents의 agent editor가 `ModelField`를 같이 쓴다.

## 할 일

0. 공통 규칙. 옛 `agent-view.tsx`·`agent-thread.tsx`(view task가 바꾼다)가 이 폴더의 옛 export를 아직 쓴다. 옛 export의 이름이나 props가 깨지면 새 file을 옆에 만들고 옛 file은 그대로 둔다(view task가 지운다). 어느 경우에도 main의 `deno task check`가 통과해야 한다.
1. `AgentComposer`를 새 모양으로 바꾼다.
   - 입력칸 안 아래 줄에 [+]와 model 단추와 [↑]. 입력칸 밖 아래 줄에 project 표시와 권한 요약 단추. agent를 고르는 칸은 없다(session 안에서 agent를 바꾸지 않는다).
   - 보내기 방식 menu(`SEND_MODES`, "Change this work / Next request")는 없앤다. 일하는 중에는 [↑] 옆에 [Stop]이 보이고, 입력칸 아래에 "{agent} is working. A message you send now waits for the next turn."이 보인다. 일하는 중 보낸 메시지는 `delivery: "next_turn"`으로 접수되고, 쉬는 중에는 늘 새 turn이다. 근거: `U2.2#5`, `U6.5#1`.
   - 권한 요약 단추는 agent grant 요약("Asks for external calls ▾" 꼴. 한 줄은 `AgentFace`의 요약)이고 누르면 `PermissionsView` popover가 열린다. 이전의 "Agents 화면의 Permissions로 감"은 `/permissions`와 같은 보기로 바뀐다. 근거: `U2.2#10`.
   - 위반 chip: 입력칸 위의 context chip이 context 하나(id와 label)뿐이던 것을 위반의 파일과 어긴 규칙도 실을 수 있게 한다(Project Manager 대화가 위반을 붙인 채 열리는 흐름의 chip). 사람이 글을 쓰지 않아도 열린다. 근거: `U2.2#16`, `U3.2#11`.
   - `readOnly`면 입력칸 대신 "This session is archived. You can read it, but it takes no new messages." 안내 한 줄만 둔다. 근거: `U3.2#9`의 composer 쪽.
2. `QueuedMessages`를 만든다. 일하는 중 보낸 메시지가 composer 바로 위에 "Next turn" 줄로 쌓이고, 줄 오른쪽 끝의 [Send now]가 도는 turn에 steer로 올리며(대화에 steer 표시가 붙는다), × 단추가 줄을 뺀다. 근거: `U6.5#1`.
3. `/` 명령 창을 바꾼다. 아이콘·이름·설명이 한 줄인 얇은 행이고 묶음(전역 built-in, agent별 built-in, Skills)은 얇은 선으로 나눈다. 글자를 더 치면 이름이나 설명에 맞는 것만 남기고 맞는 글자를 굵게 보이며, 맞는 게 없는 묶음은 숨긴다. 전역 built-in은 `new, rename, archive, compact, fork, mcp, skills, permissions`에 `recap`을 더한 아홉이다. `permissions`는 agent grant와 이 session의 session 허락을 보이는 대화 안 panel을 연다(Agents 화면으로 가지 않는다). 지운다: "같은 이름 skill 고르기"(`choose_skill`)와 출처 라벨(`skillOrigin`, `ORIGIN_LABEL`)은 같은 이름이면 마지막 층이 덮으므로 없다. 도는 중의 "Not while … is working" 표시는 "다음 turn에 들어간다"로 바꾼다. 근거: `U1.2#4`, `U2.2#9`, `U6.5#4`, `I2.4#32`.
4. model picker를 바꾼다. Favorites 묶음 → provider 묶음(vendor 아이콘) → 고른 model의 option 축(variant) 순서다. 안내 문구는 없다. 고른 model의 variant만 보이고, model을 바꾸면 새 model의 기본 variant로 조용히 맞춘다(바뀐 값 안내 `PickerNoticeView`는 없앤다). 목록과 option은 `AgentTabSource.model`이 준 catalog 값이고 model 이름으로 갈라지지 않는다. 근거: `U6.5#5`. provider 요청 오류와 [Retry]는 `screens-conversation-thread`가 대화 안 메시지로 맡는다.
5. 문구를 wording key로 바꾼다(영역 `conversation`). 옛 key 가운데 `conversation.label.send-correction`·`send-request`, 보내기 방식 menu 문구, `skillOrigin` 라벨은 쓰는 곳이 없어지므로 지운다. key는 `catalog/conversation.ts`에 더하고 지우고, `deno run --allow-read --allow-write packages/design/wording/generate.ts`로 `catalog/conversation.placeholders.ts`를 갱신한다. 둘 이상의 단위가 쓰는 key는 `catalog/common.ts`(lead 소유)로 가야 하므로 보고에 적는다.
6. wireframe의 `agent-chat.tsx`·`slash-menu.tsx`·`model-picker.tsx`·`agent-tab/queued.tsx`와 `agents.module.css`·`agent-tab.module.css` 규칙은 이 task가 고치지 않는다(gallery는 `screens-conversation-view`가 한꺼번에 바꾼다). 이 task의 component가 쓰는 CSS 규칙은 renderer module.css로 복사한다.

- (lead가 더함, screens-conversation-sessions가 넘긴 것) `/fork`는 `header/fork.ts`의 `forkAndOpen(source, session, openForked)`를 부른다. header menu와 같은 길이다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test: 없음 (화면 모양과 입력 상태)
- 남지 않음: 새로 만들거나 고친 file에 옛 이름이 없다. 옛 file이 옆에 남으면 그 목록을 보고에 적는다(`screens-conversation-view`가 지운다). 확인은 `grep -rn "SEND_MODES\|choose_skill\|skillOrigin\|ORIGIN_LABEL" packages/shell/renderer/conversation`에서 새 file만 본다.
- (화면) gallery는 `screens-conversation-view`가 한꺼번에 바꾼다. 이 task의 component는 그때 `new-agent-queued-message`, `new-agent-commands`, `new-agent-commands-filtered`, `new-agent-model-picker`로 그려진다(위반 chip이 붙은 Project Manager 대화 `new-violation-session-open`은 screens-contexts의 gallery page다).

## 보고

- 바꾼 file
- 등록할 것: 영역 `conversation`의 새 key와 지운 key. screens-agents가 `ModelField`를 renderer `conversation/model-picker/`에서 가져다 쓴다는 것(그쪽 brief에 선행으로 적혔는지 lead가 확인).
- 안 쓰게 된 export: 옛 `agent-composer.tsx`의 `SendMode` 관련, `slash-menu/types.ts`의 출처 칸
- 정한 것: 권한 요약 한 줄의 문구 꼴, `/recap`을 고르면 composer가 `onCommand("recap")`로 알리고 보기를 여는 것은 view task가 하는 것
- 계약 바꾸기 요청(wave 3): 명령 목록 route에 role built-in의 아이콘이나 설명이 없으면 여기 적는다
