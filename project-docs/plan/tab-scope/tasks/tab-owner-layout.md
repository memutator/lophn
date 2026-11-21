# tab-owner-layout

탭 값에 주인을 적는다. layout 파일과 전역 float 파일의 탭 공통 칸에 `owner`(주인 session)와 `handed_tab`(사람이 넘긴 browser 탭의 core 탭 id)을 더하고, 판을 올리며(layout 11 → 12, 전역 float 3 → 4) 옛 파일을 올리는 data step을 같이 넣는다. renderer의 `TabItem`과 저장 변환도 같이 고친다.

- 단위: tab-owner (wave 1)
- 선행: 없음.
- 소유(이 task만 고친다):
  - `packages/shell/main/workspace/schema.ts`
  - `packages/shell/main/workspace/workspace-layout.ts`
  - `packages/shell/main/workspace/workspace-layout_test.ts`
  - `packages/shell/main/workspace/global-floats.ts`
  - `packages/shell/main/workspace/global-floats_test.ts`
  - `packages/core/main/daemon/wiring/shell-agent-tabs.ts`
  - `packages/core/main/daemon/wiring/shell-agent-tabs_test.ts`
  - `packages/shell/renderer/workspace/model.ts`
  - `packages/shell/renderer/shell/layout-source.ts`
  - `project-docs/flows/areas/shell-workspace.yaml`
- 읽을 것:
  - 계획: `project-docs/plan/tab-scope/README.md`("정한 것"의 주인 두 곳, 사람이 연 탭은 주인 칸이 없다, 판을 올리면 migration)
  - architecture: `project-docs/architecture/workspace-layout.md`의 "저장"(판, 읽는 순서, `unsupported_schema`, data step `shell.layout-machines`)과 지키는 것 6·7
  - AGENTS.md "호환성"(ledger 밖 data root 파일은 소유 wiring의 `dataSteps`)
  - 코드: `packages/shell/main/workspace/schema.ts`(공통 칸 `machine`을 떼어 검사하는 자리), `packages/core/main/daemon/wiring/shell-agent-tabs.ts`(`bumpVersion`, `shellLayoutMachinesStep`), `packages/shell/renderer/shell/layout-source.ts`(`tabFromStored`, `tabToStored`의 `machine`)
- 계약:
  - 쓰는 것: 없음.
  - 내놓는 것(뒤 task가 기댄다):
    - 저장 모양: 탭 공통 칸 `owner?: "ses_<ULID>"`(없으면 사람), `handed_tab?: "tab_<ULID>"`(사람이 session에 넘긴 browser 탭의 core 탭 id. 없으면 넘기지 않은 탭). layout `schema_version: 12`, 전역 float `schema_version: 4`. 다른 칸은 그대로다.
    - renderer `TabItem`(`packages/shell/renderer/workspace/model.ts`)에 `readonly owner?: string`(주인 session id, 없으면 사람)과 `readonly handedTab?: string`(넘긴 탭의 core 탭 id)을 더한다.
    - 같은 file에 `export function hostTabOf(tab: Pick<TabItem, "key" | "handedTab">): string | null`: key가 `host:`로 시작하면 그 뒤, 아니면 `handedTab`, 둘 다 아니면 null. core 표의 탭 id를 찾는 곳은 앞으로 이것 하나다(`tab-owner-hand`가 옮긴다).

## 할 일

1. `schema.ts`의 `layoutTabSchema`가 `machine`처럼 `owner`·`handed_tab`을 떼어 꼴(`idOf("ses", …)`, `idOf("tab", …)`)을 보고 kind schema에 나머지를 준 뒤 다시 붙인다. 꼴이 틀리면 그 탭이 틀린 것이다(`machine`과 같다). `StoredTab` type에 두 칸을 더한다.
2. `workspace-layout.ts`의 `WORKSPACE_SCHEMA_VERSION`을 12로, `global-floats.ts`의 `GLOBAL_FLOATS_SCHEMA_VERSION`을 4로 올린다. 머리 주석의 판 설명(판 12는 공통 칸 `owner`·`handed_tab`을 더했을 뿐)을 고친다. 두 file의 test에서 판 11·3을 12·4로 맞춘다.
3. `shell-agent-tabs.ts`에 `shellLayoutOwnersStep`(id `shell.layout-owners`)을 더한다: `bumpVersion(11, 12)`을 `shell/workspaces/*.json`에, `bumpVersion(3, 4)`를 `shell/global-floats.json`에(`shellLayoutMachinesStep`과 같은 꼴. 다른 판과 손상된 파일은 그대로). 이 wiring의 `dataSteps` 끝에 더한다(`[shellAgentTabsStep, shellLayoutMachinesStep, shellLayoutOwnersStep]`). 이 목록은 이 file 안의 소유 wiring 목록이라 이 task가 고친다(빠지면 사람의 layout이 모두 `unsupported_schema`가 되어 저장이 막힌다).
4. renderer `model.ts`의 `TabItem`에 두 칸과 `hostTabOf()`를 더한다. `layout-source.ts`의 `tabFromStored`가 `owner`·`handed_tab`(문자열일 때만)을 `TabItem.owner`·`handedTab`으로, `tabToStored`가 그 반대로 붙인다(`machine`과 같은 자리).
5. renderer에서 탭 값을 새로 만들며 칸을 골라 담는 곳이 주인을 잃지 않는지 본다(dock·reattach가 preview·transient를 지우는 곳, `packages/shell/renderer/shell/desk-model.ts`의 `openTab`). 칸을 펼쳐 복사하면 그대로 간다. 고칠 곳이 이 task 소유 밖이면 고치지 말고 보고의 "넘길 줄"에 적는다.
6. flows `shell-workspace.yaml`의 layout 저장·읽기 flow에서 판 11을 12로, data step 목록에 `shell.layout-owners`를 더한다. 더한 test가 단정하는 outcome을 `project-docs/flows/tests/core-rest.yaml`의 `shell-agent-tabs_test.ts` 줄 `covers`에 더한다(그 yaml은 같은 wave의 `tab-owner-core`도 한 줄 고칠 수 있다. 줄만 더한다).

정한 것:
- 판을 올린다(12, 4). 칸이 선택이라 옛 파일은 그대로 읽히지만, 새 칸이 든 파일을 옛 빌드가 열면 kind schema(strict)가 탭을 거절한다. 판을 올리면 옛 빌드는 `unsupported_schema`로 파일을 그대로 두고 저장을 막는다(`workspace-layout.md` "새 판의 layout을 옛 빌드로 열어도 덮이지 않는다"). `machine`을 더할 때와 같은 길이다.
- browser 탭의 `profile` 칸(kind schema)은 이 task가 아니라 같은 wave의 `browser-profile-partitions`가 더한다. 판 12에 같이 든다.

## 끝남

- `npm run check`가 통과한다.
- 위험 test(`packages/core/main/daemon/wiring/shell-agent-tabs_test.ts`): "판 11 layout과 판 3 전역 float은 판만 12·4로 올라가고 탭 값은 byte 그대로 남으며, 다른 판과 깨진 파일은 건드리지 않는다"
- 남지 않음: `grep -rn "schema_version: 11\|schema_version\": 11" packages tests tools`가 data step test 밖에서 0줄이다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: lead가 고칠 목록 file(`protocol/*/mod.ts`, core 조립 목록, gallery `pages/index.ts`, `package.json`)
- 안 쓰게 된 export(남이 쓰던 것은 지우지 않는다)
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 넘길 줄: 남의 file을 최소로 맞춘 곳
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- **무겁게 짠 것**: 가장 단순한 구현(AGENTS.md "속도")보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것. 없으면 "없음"
