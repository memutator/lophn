# screens-contexts-views

Context 탭의 하위 탭 셋과 gallery를 옮긴다. Search(선언된 검색의 입력 form과 결과 table·board, 목록과 saved view), Violations(읽기, 파일 열기, 근거를 붙여 Project Manager에게 넘기기), Glossary(머리 줄, 줄에서 바로 더하기·고치기, Delete는 modal)다. 선언된 검색 탭과 Search 하위 탭의 [Ask …] 단추, 위반 목록의 "… is on it" 표시는 지운다. 끝으로 context 쪽 gallery 전체(`context-body.tsx`, `declared-search.tsx`, `glossary.tsx`, `pm-session.tsx`, `tab-toast.tsx`, `violation-toast.tsx`)를 renderer component로 갈아탄다.

- 단위: screens-contexts (wave 3)
- 선행: screens-contexts-overview (`context-frame.tsx`, `context-tab-body.tsx`, `source.ts`, `core-source.ts`, `fake-source.ts`를 이 task가 이어서 고친다), screens-data-toast (`registerToastActionHandler`와 `waiting.toast-violation`이 있어야 gallery의 `ViolationToastPage`를 옮길 수 있다)
- 소유(이 task만 고친다):
  - `packages/shell/renderer/workspace/contexts/` 가운데 `context-search-list.tsx`, `search-tab*.ts(x)`, `search-tab.module.css`, `search-input-form*`, `search-results*`, `context-violations*`, `context-glossary*`, `context-glossary-fields.tsx`, `context-glossary-row.tsx`, 그리고 overview task가 끝낸 뒤의 `source.ts`·`core-source.ts`·`fake-source.ts`·`context-tab-body.tsx`의 하위 탭 쪽
  - `packages/shell/renderer/workspace/kinds/context.tsx`의 위반 넘기기 뒤 session을 여는 연결 한 줄(추가 소유, lead 승인 2026-10-16: screens-project-window 소유 file이다. 이 줄만 고친다)
  - `tools/wireframes/frames/compositions/context-body.tsx`, `contexts/declared-search.tsx`, `glossary.tsx`, `pm-session.tsx`, `tab-toast.tsx`, `violation-toast.tsx`, `open-tab.ts`, `host.tsx`, `context-pages.tsx`의 나머지 페이지
  - `packages/design/wording/catalog/contexts.ts`와 생성물 `catalog/contexts.placeholders.ts` (wording-split이 만든 영역 file. ownership.md에 없어 추가 소유, lead 승인 2026-10-16)
- 읽을 것:
  - spec: S1 8장(위반 toast는 눌러야 Project Manager session으로), S4 4장(Project Manager) — `/home/pyosechang/projects/lophn/project-docs/tmp/specs/event.md`, `agent-definition.md`
  - inventory: `U6.4#7`(용어집: 머리 줄 Glossary·용어 수·오른쪽 끝 [Add term], 더하기와 고치기는 그 줄에서 바로, Enter·✓ 저장, Esc·× 취소, Edit·Delete는 hover 때, 지우기 확인은 modal), `U6.1#1`
  - inventory(다른 단위에서 넘어온 줄): `U2.3#20`(위반 목록의 [Send to …]와 [Send all …] → 위반 근거를 붙여 그 project의 Project Manager에게), `U1.3#17`(위반 목록의 "… is on it" 표시 지우기), `U1.3#12`(Search 하위 탭의 [Ask …] 지우기. `kinds/search.tsx` 쪽은 screens-project-search가 했다)
  - 결정: `../README.md` 3장 #57(`project_manager`)
  - 지금 코드: `contexts/context-search-list.tsx`(129줄), `search-tab.tsx`(154줄), `search-tab-body.tsx`·`search-tab-side.tsx`·`search-tab-results.tsx`, `search-input-form.tsx`(207줄)·`search-input-form-combobox.tsx`, `search-results.tsx`(269줄)·`search-results-model.ts`, `context-violations.tsx`(192줄: `handOff`, "… is on it"), `context-glossary.tsx`(251줄)·`context-glossary-row.tsx`·`context-glossary-fields.tsx`·`context-glossary-model.ts`
  - 본보기(화면): `tools/wireframes/frames/compositions/context-body.tsx`(`Violations` 351줄~, `Searches` 384줄~, `ContextBody` 720줄~), `contexts/declared-search.tsx`(439줄: 입력 form, table·board 결과, 쪽 넘김), `contexts/glossary.tsx`(179줄), `contexts/pm-session.tsx`(125줄), `contexts/tab-toast.tsx`(21줄), `contexts/violation-toast.tsx`(43줄), `contexts/context-pages.tsx`(133줄), `contexts/contexts.module.css`
- 계약:
  - 쓰는 것:
    - `packages/protocol/projects`(contract-calls-places): 선언된 검색 실행(`search`, 입력 옵션 읽기), 위반 목록·`violations.hand_off`·용어집 `set/remove/list`·saved view의 route와 schema
    - `ContextsSource`와 `ContextFrame`(screens-contexts-overview), 탭 안 알림은 design `Toast`(ui-chrome. 행동 단추 오른쪽)
  - 내놓는 것: 하위 탭 component(`SearchTab`, `ContextViolations`, `ContextGlossary`)의 이름은 유지한다(`workspace/kinds/search.tsx`, `kinds/context.tsx`가 import한다). gallery의 export(`ContextBody`, `DeclaredSearch`, `Glossary`, `pmNewTab`, `pmWorkingTab`, `TabToast`, `ViolationToast`, `HostProvider`, `ProjectHost`)는 이름과 props를 유지한다(`project-app.tsx`와 다른 단위의 page가 import한다).

## 할 일

1. 선언된 검색을 옮긴다. `search-tab*`, `search-input-form*`, `search-results*`를 wireframe `declared-search.tsx`의 모양으로 바꾼다: 왼쪽 옆 칸(Context 고르기, 선언된 검색 고르기, 입력 form: pick·choose-many·choose-one 등 선언된 입력 type)과 본문(결과 table 또는 board, 쪽 넘김, 행의 객체는 링크로 파일 탭을 연다). [Ask …] 단추(`onAsk`)와 `inputs`의 Ask 호출은 지운다. Search 하위 탭(`context-search-list.tsx`)은 이 context에 선언된 검색 목록(각 줄의 [Open])과 saved views 목록이고, 누르면 선언된 검색 탭(`kind: "search"`, `context` 있음)이 열린다. 근거: `U1.3#12`.
2. 위반 목록을 옮긴다. 읽기(위반 수 안내), 파일 링크(누르면 파일 탭), 줄마다 [Send to Project Manager], 머리의 [Send all to Project Manager]. 넘기면 위반 근거(파일과 어긴 규칙)가 붙은 채로 그 project의 Project Manager session이 열린다(열린 session이 있으면 그 session). `handOffViolations`가 session 하나를 돌려주면 그 session 탭을 여는 callback(`kinds/context.tsx`의 연결 줄)을 부른다. "… is on it" 표시와 call의 진행 표시는 지운다(`context-violations-model.ts`, wording `contexts.label.violations-on-it`). 근거: `U2.3#20`, `U1.3#17`.
3. 용어집을 옮긴다. 머리 줄(Glossary, 용어 수, 오른쪽 끝 [Add term])을 둔다. 더하기와 고치기는 그 줄에서 바로 한다(Enter·✓ 저장, Esc·× 취소). Edit과 Delete는 hover 때 보이고, 지우기 확인은 modal(design `Dialog`)이다. 옛 별도 form 칸은 없앤다. `set_by`는 `user | agent`에서 `user | project_manager`로(계약대로). 근거: `U6.4#7`.
4. 탭 안 알림은 design `Toast`를 탭 본문 위쪽에 붙여 쓴다(색 다른 띠나 상자 없음. 단추는 오른쪽 끝). 근거: `U6.1#1`.
5. 문구를 wording key로 바꾼다(영역 `contexts`). `contexts.label.violations-on-it`, `contexts.button.input-ask`, Context Engineer 이름이 든 key(18곳)는 `project_manager`·"Project Manager"로 바꾸거나 지운다. 근거: `U1.3#12`, `U1.3#17`. key는 `catalog/contexts.ts`에 더하고 지우고, `deno run --allow-read --allow-write packages/design/wording/generate.ts`로 `catalog/contexts.placeholders.ts`를 갱신한다. 둘 이상의 단위가 쓰는 key는 `catalog/common.ts`(lead 소유)로 가야 하므로 보고에 적는다.
6. gallery를 갈아탄다.
   - `context-body.tsx`의 `ContextBody`(Header, VersionList, Overview, Contract, Searches, Violations, Glossary 조립)를 renderer의 `ContextTabBody`+`ContextFrame`을 fake 통로(`createFakeContextsSource`)로 그리게 다시 쓴다. export 이름과 props 유지.
   - `declared-search.tsx`의 `DeclaredSearch`, `glossary.tsx`의 `Glossary`, `pm-session.tsx`의 `pmNewTab`·`pmWorkingTab`(위반을 붙인 Project Manager 대화: `screens-conversation-view`가 정리한 `ChatShell` adapter 위에 얹는다), `tab-toast.tsx`, `violation-toast.tsx`가 renderer component와 `waiting.toast-violation` key를 쓰게 한다.
   - `context-pages.tsx`의 나머지 페이지(`ContextSearchesPage`, `ContextViolationsPage`, `ContextGlossary*Page`, `ViolationToastPage`, `ViolationSessionNewPage`, `ViolationSessionOpenPage`, `DeclaredSearchTablePage`, `DeclaredSearchBoardPage`)가 옮긴 component로 그려지게 한다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test: 없음 (화면과 호출)
- 남지 않음: `grep -rn "violations-on-it\|input-ask\|context_engineer\|onAsk" packages/shell/renderer/workspace/contexts`가 0줄이다.
- (화면) `deno task wireframes`가 되고, gallery의 `new-context-overview`, `new-context-contract`, `new-context-searches`, `new-context-violations`, `new-context-glossary`, `new-context-glossary-add`, `new-context-glossary-edit`, `new-context-glossary-delete`, `new-search-table`, `new-search-board`, `new-violation-toast`, `new-violation-session-open`, `new-ways-to-open`(`ways-page.tsx`가 쓰는 Context 탭 여는 길)이 옮긴 component로 그려진다.

## 보고

- 바꾼 file
- 등록할 것: 영역 `contexts`의 지운 key와 새 key. gallery `pages.ts`는 바뀌지 않는다.
- 안 쓰게 된 export: `contexts/context-search-list.tsx`·`search-*`의 `onAsk` 관련, `ContextsSource.handOffViolations`가 옛 Context Engineer 지칭을 하던 칸
- 정한 것: 위반 넘기기 뒤 열릴 session을 core 응답으로 받는지 `useSessions`에서 찾는지, 용어집 편집 중 다른 줄 편집을 시작하면 앞 줄을 어떻게 하는지
- 계약 바꾸기 요청(wave 3): `violations.hand_off`가 Project Manager와 열린 session을 돌려주지 않으면 여기 적는다

- (lead가 더함, screens-contexts-overview가 넘긴 것) `context-search-list.tsx`의 `onAsk` prop과 빈 상태 [Ask …]는 이미 걷었다. 나머지를 이어서 한다. `search-tab*`·`search-input-form.tsx`의 `onAsk?`와 `contexts.button.input-ask`를 지운다. `settleContextTabs`가 없어져 복원한 Search 탭은 이름이 비어 있다가 `onState`에서 채워진다. `SearchTab`이 읽은 뒤 이름을 채우게 한다. 없어진 context의 탭은 읽기 실패 ErrorState로 뜬다. gallery `new-context-overview`·`new-context-contract`는 `ContextBody`를 갈아탈 때 같이 바꾼다. 위반 넘기기 연결은 `ContextsSlice.askProjectManager`를 쓴다.
- (lead가 더함, places-sessions-contexts-authority가 넘긴 것. 추가 소유, lead 승인: `protocol/projects/context-api.ts`의 hand_off·`handed_off` 줄) 위반 넘기기 route(`contextHandOffViolationsRoute`)의 handler가 없어졌다. shell `core-source.ts`·`fake-source.ts`·`source.ts`·`context-violations.tsx`의 hand_off 호출과 `handed_off` 읽기를 걷는다. 그 뒤 protocol의 `contextHandOffViolationsRoute`, `violationsHandOff*Schema`, `HAND_OFF_VIOLATIONS_MAX`, `violationItemSchema.handed_off`를 지우고 `reads-lists.ts`의 `handed_off: false` 줄도 지운다. 위반을 PM에게 알리는 것은 이제 `ContextViolationFound` event와 reaction이다.
