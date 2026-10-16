# screens-conversation-sessions

agent header와 session 쪽을 옮긴다. 탭 안 맨 위의 agent header(view bar), session switcher(검색, Today·Earlier, 줄 hover의 Rename·Archive·Delete, Archived 줄, + New session, 삭제 확인), fork, archive된 session의 읽기 전용 표시, 기다리는 coding 맡기기 표시, 그리고 session rewind panel(대화 화면 안에서 확인하고 앱을 고른다)이다. wireframe 코드(`session-switcher.tsx`, `agent-tab/rewind-panel.tsx`, `agent-chat.tsx`의 header 부분)를 renderer `conversation/`으로 옮긴다. 옛 확인 창 rewind는 없다.

- 단위: screens-conversation (wave 3)
- 선행: screens-conversation-source (`SessionEntry`, `AgentFace`, `RewindPreviewView`, `AgentTabSource.renameSession`·`archiveSession`·`deleteSession`·`forkSession`·`rewind*`)
- 소유(이 task만 고친다):
  - `packages/shell/renderer/conversation/header/`
  - `packages/shell/renderer/conversation/rewind/`
  - `packages/shell/renderer/conversation/session-rewind/` (새로: rewind panel)
  - `packages/design/wording/catalog/conversation.ts`와 생성물 `catalog/conversation.placeholders.ts` (wording-split이 만든 영역 file. ownership.md에 없어 추가 소유, lead 승인 2026-10-16)
- 읽을 것:
  - spec: S8 3장(session 수명: 열림·archive·지움, archive나 지움이 받은 call과 대기 요청에 주는 영향)·4장(session rewind와 앱 rewind 잇기)·5장(fork) — `/home/pyosechang/projects/lophn/project-docs/tmp/specs/place-session.md`
  - spec: S5 7장(앱 rewind 확인에서 보일 것: 함께 되돌아갈 다른 변경, external 효과, 되돌릴 수 없는 write) — `/home/pyosechang/projects/lophn/project-docs/tmp/specs/app-call.md`
  - spec: S6 2장 2(기다리는 coding 맡기기가 session 목록에 보인다) — `/home/pyosechang/projects/lophn/project-docs/tmp/specs/coding-agent.md`
  - inventory: `U1.2#5`(session 목록의 Restore 지우기), `U2.2#7`, `U2.2#12`, `U2.2#13`, `U2.2#14`, `U3.2#9`(archive된 session 읽기 전용: 표시 쪽), `U3.2#10`, `U3.2#11`(기다리는 coding 맡기기 표시), `U6.5#3`(agent header 위에 여백), `U2.2#11`(옛 확인 창의 rewind 내용을 대화 안 panel로 옮겨 오는 쪽), `U6.1#1`
  - 결정: `../README.md` 3장 #57(`project_manager`)
  - 지금 코드(고칠 곳): `conversation/header/{agent-header.tsx, session-popover.tsx, types.ts}`(Restore·`onUnarchive`), `conversation/rewind/{rewind-menu.tsx, hidden-range.tsx, text.ts}`, `renderer/confirmation/kinds/rewind/rewind.tsx`(내용을 옮겨 올 곳. `screens-data-secret-input`이 이 폴더를 지운다. 먼저 읽고 옮겨 둔다)
  - 본보기(화면): `tools/wireframes/frames/compositions/session-switcher.tsx`(305줄), `agent-tab/rewind-panel.tsx`(166줄), `agent-chat.tsx`(`ChatShell` header 부분 270줄~), `agents-data.ts`의 `SessionRow`·`sessionsOf`, `agent-tab.module.css`, `agents.module.css`
- 계약:
  - 쓰는 것:
    - `AgentTabSource`의 `sessions`, `renameSession`, `archiveSession`, `deleteSession`, `forkSession`, `rewindPoints`, `rewindPreview`, `rewind` (screens-conversation-source). archive 풀기(Restore)는 없다.
    - session 상태(`waiting`·`working`·`idle`) 점은 `useSessions` (screens-data-events)
    - `@lophn/design/components`의 `Avatar`, `Menu`, `Popover`, `Button`, `IconButton`, `Checkbox`, `Dialog`
  - 내놓는 것:
    - `header/agent-header.tsx`: `AgentHeader`(avatar·이름·session 제목, switcher, "Archived" 표시, 보기 상세 menu 위치, 더보기 menu: Rename·Archive, archive된 session은 Fork뿐)
    - `header/session-popover.tsx`: `SessionSwitcher`
    - `session-rewind/rewind-panel.tsx`: `RewindPanel({ session, message, onClose })`. 대화 화면 안 panel이다(확인 창 아님).

## 할 일

0. 공통 규칙. 옛 `agent-view.tsx`·`agent-thread.tsx`(view task가 바꾼다)가 이 폴더의 옛 export를 아직 쓴다. 옛 export의 이름이나 props가 깨지면 새 file을 옆에 만들고 옛 file은 그대로 둔다(view task가 지운다). 어느 경우에도 main의 `deno task check`가 통과해야 한다.
1. `header/`를 wireframe 모양으로 고친다.
   - header 위에 여백을 둔다(`U6.5#3`). view bar에는 왼쪽 "{agent} · {session 제목}" 앞에 switcher 단추, 오른쪽에 "Archived" 표시, 진행 chip(`screens-conversation-thread`의 것을 끼울 곳), 보기 상세 menu(Messages·Compact·Everything), 더보기 menu.
   - `SessionSwitcher`: 맨 위 검색 input, 그 agent의 session만 Today / Earlier로 묶고(사용자 달력), 줄에 hover하면 Rename·Archive·Delete. Rename은 줄이 input으로 바뀐다(Enter·Save·Esc·Cancel). Delete는 줄 안 확인("이 session이 받은 call이 답을 기다리는 중이면 실패한다. 되돌릴 수 없다")을 거친다. Archived 줄은 접어 두었다 펼친다. 맨 아래 + New session. Restore(되살리기)와 `onUnarchive`는 지운다. 근거: `U1.2#5`, `U2.2#12`, S8 3장.
   - session 줄 상태 점은 사람을 기다림·일하는 중이다. 그 앱의 줄에서 기다리는 coding 맡기기가 있으면 session 목록에 표시한다(coding agent의 product 이름과 vendor 아이콘). 근거: `U3.2#11`.
2. archive된 session 표시: header의 "Archived" 표시, 더보기 menu에는 Fork만, 입력칸은 없다(composer가 `readOnly`로 안내 한 줄을 그린다). 닫힌 session(지움이나 archive로 닫힘)의 읽기 전용 표시도 같은 규칙이다. 근거: `U2.2#13`, `U3.2#9`.
3. fork: 더보기 menu와 `/fork`가 `forkSession`을 부르고 만든 session을 host callback `openForked(session)`으로 같은 agent의 새 탭에 연다. 이력만 복사한다(S8 5장). 근거: `U2.2#14`.
4. `session-rewind/rewind-panel.tsx`를 만든다. 내 메시지 hover의 [Rewind to here]가 연다. 확인 창이 아니라 대화 화면 안에서 확인한다.
   - 왼쪽 열: 고른 메시지 인용, "Conversation: 이 메시지 뒤 메시지는 대화에서 빠진다", "file tool로 바꾼 파일도 함께 되돌린다"(기본 켜짐) 파일 목록, "shell로 바꾼 파일은 되돌리지 않는다", "도는 turn에 steer로 보낸 메시지는 rewind 시점이 아니다. 그 너머로 되돌리면 메시지만 빠진다"(안내 문구, `rewind/text.ts`를 이 문구로 바꾼다).
   - 오른쪽 열: 고른 시점 뒤 이 session이 write한 앱마다 체크 상자(Also rewind {app}), write 목록과 시각, 결과를 모르는 write("Result unknown", 되돌릴 수 없음), 켜면 함께 되돌아갈 다른 변경(사람의 화면 조작, 다른 session의 호출)과 되돌아가지 않는 external 효과를 보인다. 고르지 않은 앱의 data는 그대로다.
   - 아래: "Conversation and files only" 또는 "Conversation, files and {apps}" 요약, [Cancel], [Rewind].
   - 옛 `rewind-menu.tsx`의 선택지 셋 고르기와 옛 앱 단계는 없앤다. 파일 체크 상자가 켜져 있으면 contract의 `choice: "restore_all"`, 꺼져 있으면 `"messages_only"`이고 `summarize`(Summarize from here)는 화면이 내지 않는다. 숨긴 구간 접기(`hidden-range.tsx`)는 되돌린 뒤의 표시로 남기되 Redo(`redoRewind`)는 새 계약에 없으므로 단추를 없앤다. 근거: `U2.2#7`, `U2.2#11`, `U3.2#10`, S8 4장.
5. 문구를 wording key로 바꾼다(영역 `conversation`). Restore, rewind 선택지 셋, 옛 앱 단계 문구는 지운다. key는 `catalog/conversation.ts`에 더하고 지우고, `deno run --allow-read --allow-write packages/design/wording/generate.ts`로 `catalog/conversation.placeholders.ts`를 갱신한다. 둘 이상의 단위가 쓰는 key는 `catalog/common.ts`(lead 소유)로 가야 하므로 보고에 적는다.
6. wireframe의 `session-switcher.tsx`·`agent-tab/rewind-panel.tsx`·`agent-chat.tsx`·`agents-data.ts`·`agents.module.css`는 이 task가 고치지 않는다(gallery는 `screens-conversation-view`가 한꺼번에 바꾼다). 이 task의 component가 쓰는 CSS 규칙은 renderer module.css로 복사한다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test: 없음 (화면과 호출. 되돌림의 규칙은 core 쪽 test가 본다)
- 남지 않음: 새로 만들거나 고친 file에 옛 이름이 없다. 옛 file이 옆에 남으면 그 목록을 보고에 적는다(`screens-conversation-view`가 지운다). 확인은 `grep -rn "onUnarchive\|unarchiveSession\|restore_all\|messages_only" packages/shell/renderer/conversation/header packages/shell/renderer/conversation/rewind packages/shell/renderer/conversation/session-rewind`에서 새 file만 본다.
- (화면) gallery는 `screens-conversation-view`가 한꺼번에 바꾼다. 이 task의 component는 그때 `new-agent-rewind`, `new-agent-sessions`, `new-agent-sessions-edit`, `new-agent-session-archived`로 그려진다.

## 보고

- 바꾼 file
- 등록할 것: 영역 `conversation`의 새 key와 지운 key
- 안 쓰게 된 export: 옛 `header/types.ts`의 Restore 관련, `rewind/rewind-menu.tsx`(view task가 부르는 쪽을 바꾼 뒤 지운다)
- 정한 것: 숨긴 구간 접기와 Redo를 남기는지(S8·계약이 말하는 대로), session 목록의 coding 맡기기 표시 위치
- 계약 바꾸기 요청(wave 3): rewind 미리보기 응답에 "함께 되돌아갈 다른 변경"이나 "되돌릴 수 없는 write"가 없으면 여기 적는다
