# use-grant

터미널 입력 허락을 받는 컴퓨터의 것으로 옮긴다. 지금은 명단 항목의 칸(`terminal_input`)이라 명단의 컴퓨터가 자기 허락을 스스로 켤 수 있고 다른 컴퓨터가 그것을 받아들인다(이슈 `roster-computer-self-grants-terminal-input`). 이 task 뒤에는 각 컴퓨터가 "여기서 허락한 기기"를 자기 ledger에 두고 그것만 읽는다. 명단은 누가 내 기기인지만 말하고, 무엇을 해도 되는지는 받는 컴퓨터가 정한다.

- 단위: use (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/core/remote/grants.ts`(새 file), `packages/core/remote/grants_test.ts`(새 file)
  - `packages/core/remote/roster.ts`, `packages/core/remote/devices.ts`, `packages/core/remote/host_test.ts`(허락을 채우는 자리만)
  - `packages/protocol/remote/roster.ts`, `packages/protocol/remote/roster_test.ts`, `packages/remote-client/join.ts`
  - `packages/core/folder/import/follow.ts`, `packages/core/folder/folder_test.ts`(따라가기 표만)
  - `packages/shell/renderer/desktop/settings/remote/`(`my-devices.tsx`, `add-device.tsx`, `source.ts`, `core-source.ts`, `testdata/fake-source.ts`)
  - `packages/cli/commands/remote.ts`
  - `packages/mobile/src`에서 `terminal_input`을 읽는 자리(`grep -rn terminal_input packages/mobile/src`로 찾은 것만)
  - `packages/design/i18n/catalog/`의 remote 설정 문구 file
  - `tools/wireframes/pages/screens/settings-pages.tsx`(My devices page만), `tools/wireframes/pages/screens/settings-frame.tsx`(`fakeRemote`만)
  - `project-docs/architecture/remote.md`, `project-docs/architecture/approval.md`(기기 자격 절), `project-docs/architecture/terminal-agent.md`(허락을 말하는 문장만)
  - `project-docs/flows/areas/core-platform.yaml`(명단과 허락 flow), `project-docs/flows/tests/core-rest.yaml`
- 읽을 것:
  - 이슈 `project-docs/issues/roster-computer-self-grants-terminal-input.yaml`, review `reports/multi-device/review-carry-folder.md`의 "Round 2" N1(재현 입력과 `settle`이 왜 구별을 지우는지)
  - 계획 README "정한 것"의 "허락은 받는 컴퓨터가 정한다", "받는 기계는 자기 규칙을 본다"
  - architecture: `remote.md`("내 기기 명단", "터미널 보기"), `approval.md`("폰(기기) 자격", 사람 route 목록), `folder-sync.md`("따라가기")
  - code: `packages/core/main/daemon/wiring/remote.ts`의 `terminalInputGrant`·`setTerminalInput`·초대장을 받아들이는 자리, `packages/core/remote/call.ts`(사람 route를 거르는 자리), `packages/core/remote/roster.ts`의 `settle`·`setTerminalInput`
  - skill: `.claude/skills/write-test/SKILL.md`, `.claude/skills/ui-design/SKILL.md`, `.claude/skills/flows/SKILL.md`
- 계약:
  - 쓰는 것: `ctx.terminalInputGrant(principal)`(읽는 쪽은 그대로 이 칸을 부른다), route `roster/set_terminal_input`·`roster/invite`·`roster/list`, 표 `devices`
  - 내놓는 것:
    - ledger 표 하나(이 컴퓨터가 허락한 기기. key는 기기의 key이고 id가 아니다: id는 접힐 수 있다)와 그 schema step. step은 lead가 `schemaStepsAfterTeams` 끝과 `schema-steps.lock.json`에 등록한다.
    - `ctx.terminalInputGrant(principal)`의 뜻: "이 컴퓨터에서 허락한 기기인가". 명단 항목의 값을 읽지 않는다.
    - `roster/set_terminal_input {id, on}`: 이 컴퓨터의 표만 고친다. 명단 statement를 내지 않는다.
    - `roster/list`의 기기마다 `terminal_input`: 이 컴퓨터의 표에서 읽은 값(화면과 폰이 그대로 쓴다).

## 할 일

1. 표와 `grants.ts`: 허락을 읽고 켜고 끄는 작은 module. 명단에서 정해진 빼기로 빠진 기기의 행은 지운다(다시 들면 새 key다).
2. `terminalInputGrant`를 그 표로 바꾼다. 이 값을 읽는 자리(`terminals/input|restart|close`, `page_view/input|control|open`, 사람 route 목록, `terminal_view/snapshot`의 `input`)는 고치지 않아도 따라온다. 따라오는지 grep으로 확인한다.
3. 초대장: `roster/invite {terminal_input}`의 값은 초대장을 낸 컴퓨터가 그 초대장으로 든 기기를 받아들일 때 자기 표에 적는다. 다른 컴퓨터는 그 기기를 명단으로 알게 되지만 허락은 꺼져 있다.
4. 명단 항목의 `terminal_input` 칸을 없앤다. 이미 서명된 옛 statement가 계속 검증되어야 한다(서명한 bytes에 그 칸이 들어 있다). 호환 장치를 남기지 않는 가장 단순한 길을 고르고 보고에 적는다(예: body schema가 그 칸을 뜻 없는 칸으로 받아 서명 검증에만 쓰고, 새 statement는 싣지 않는다). remote protocol 판을 올려야 하면 그때 판에서 하나 올린다.
5. 옮기기(같은 schema step 또는 data step): 옮기는 때의 view에서 `terminal_input: true`인 기기를 이 컴퓨터의 표로 옮긴다. 이미 쓰던 사람의 허락이 끊기지 않게 한다. 그 뒤로는 명단의 값을 읽지 않는다.
6. 따라가기: `followAsksPerson`(`import/follow.ts`)이 "내 컴퓨터들"로 온 release 가운데 여기서 허락한 컴퓨터가 낸 것은 묻지 않고 따라가게 한다. 그 밖은 지금처럼 묻는다. 허락을 읽는 길은 `carry-paths`가 지운 port 자리(`wiring/context.ts`의 Late)를 다시 두되 뜻은 2의 표다.
7. 화면(wireframe 먼저): My devices의 스위치가 "이 컴퓨터에서"임을 말한다(문구 한 줄. 새 화면 없음). 초대장 화면의 문구도 같다. `one-screen`이 다른 컴퓨터의 Settings를 보이면 그 컴퓨터의 스위치는 읽기만 된다(`roster/set_terminal_input`은 기기 route 목록에 없다). 폰의 `View only`는 컴퓨터마다 이미 따로다(`terminal_view/snapshot`의 `input`).
8. CLI `lophn remote`의 허락 관련 출력과 도움말, flows, architecture 문서.

정한 것:
- 허락은 명단으로 퍼지지 않고 서명하지 않는다: 서명한 값은 명단의 컴퓨터 누구나 다시 서명할 수 있어 경계가 되지 못한다.
- 허락은 기기의 key에 건다: 같은 기기가 다시 들면(새 key) 다시 켠다.
- 초대장의 기본값(켬)은 그대로다. 달라지는 것은 그 값이 초대장을 낸 컴퓨터에만 선다는 것이다.

## 끝남

- `npm run check`가 통과한다. core 기동(`lead/boot.sh`).
- 위험 test:
  - "명단의 컴퓨터가 자기 항목이나 다른 기기의 항목을 어떻게 서명해도 이 컴퓨터의 터미널 입력 허락은 켜지지 않는다" (스스로 서명한 높은 `rev`, 꼭두각시 컴퓨터를 거친 서명, 다른 컴퓨터가 보낸 명단 frame)
  - "초대장의 허락은 초대장을 낸 컴퓨터에만 선다"
  - "옮기기는 켜져 있던 허락을 이 컴퓨터의 표로 옮기고 꺼져 있던 것은 켜지 않는다"
  - "여기서 허락하지 않은 컴퓨터의 release는 묻고, 허락한 컴퓨터의 것은 묻지 않고 따라간다" (따라가기 표의 줄)
- 남지 않음: `grep -rn "terminal_input === true\|\.terminal_input" packages --include=*.ts --include=*.tsx`가 명단 항목에서 허락을 읽는 줄을 내지 않는다(이 컴퓨터의 표와 `roster/list` 출력만 남는다). `tests/`도 본다.
- subprocess·서버 test와 E2E는 만들지 않는다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: schema step(id와 sha256), lead가 고칠 목록 file
- 안 쓰게 된 export
- 정한 것: 문서에 답이 없어 worker가 정한 것(특히 4의 길)
- 넘길 줄: 남의 file을 최소로 맞춘 곳
- 계약 바꾸기 요청
- **무겁게 짠 것**: `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 없으면 "없음"

## 시작 전에 다시 볼 것

- `one-screen`과 `carry-paths`가 올린 뒤의 `wiring/remote.ts`, `roster.ts`, 기기 route 목록, `followAsksPerson`의 모양(지금은 "내 컴퓨터들"로만 온 release를 모두 묻는다).
- `one-screen`의 `screen-terminals`가 `terminals/restart|close`를 같은 허락에 걸었다. `screen-inbox`가 Settings에 기계 고르기를 넣었으면 다른 컴퓨터의 My devices에서 스위치가 읽기만 되는지.
- 이 task는 `use-contract`와 `wiring/remote.ts`를 같이 고친다(`use-contract`는 `createRemoteCall`의 인자 한 줄). 같은 wave에서 돌리려면 그 한 줄은 lead가 merge 때 맞춘다.
- 권한 경계를 바꾼다. merge 전에 다른 worker에게 review를 맡긴다.
