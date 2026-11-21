# tab-owner-core

core의 탭 표가 주인을 shell에 알리고(`tab_open`의 `owner`), agent가 자기 탭 목록을 읽고(`tabs/list`, `lophn tab list`), 사람이 browser 탭을 session에 넘기는(`tabs/hand`) core 쪽을 만든다. 넘겨받은 탭은 agent가 닫지 못한다.

- 단위: tab-owner (wave 1)
- 선행: 없음. lead가 띄우기 전에 아래 "계약"의 protocol 두 곳을 commit해 둔다.
- 소유(이 task만 고친다):
  - `packages/protocol/lophn-agent/host-queue.ts`
  - `packages/protocol/lophn-agent/input-tags.ts`
  - `packages/core/host-queue/queue.ts`
  - `packages/core/host-queue/queue_test.ts`
  - `packages/core/host-queue/mod.ts`
  - `packages/core/main/daemon/wiring/host-queue.ts`
  - `packages/cli/commands/tab.ts`
  - `project-docs/flows/areas/harness.yaml`
  - `project-docs/flows/areas/cli.yaml`
- 읽을 것:
  - 계획: `project-docs/plan/tab-scope/README.md`("정한 것" 전부)
  - 제품 결정: `project-docs/products/roadmap/tab-owner.md`의 "무엇을 만드나"(주인, agent의 시야, 넘기기)와 "정한 것"
  - architecture: `project-docs/architecture/workspace-layout.md`의 "agent가 연 탭", `project-docs/architecture/browser-tab.md`의 지키는 것 34~36(주인만, `not_found` 한 문장, untrusted 감싸기)
  - boundary·module: `project-docs/module-catalog.yaml`의 host-queue module(core/host-queue) 설명
  - 코드: `packages/core/host-queue/queue.ts`(`TabEntry`, `owned()`, `place()`, `unlink()`, `close()`), `packages/core/main/daemon/wiring/host-queue.ts`(`createTabHandlers`, `owner()`, `sessionRow`), `packages/core/router/model.ts`(spawn tree의 `spawned_by` 걷기), `packages/cli/commands/tab.ts`, `packages/cli/commands/browser.ts`(`wrapUntrusted`로 page 글 감싸기)
  - skill: `.claude/skills/write-test/SKILL.md`, `.claude/skills/flows/SKILL.md`
- 계약:
  - 쓰는 것(lead가 이 task를 띄우기 전에 commit한다. 고치지 않는다):
    - profile id의 꼴 `idSchema("bpf")`(lead가 `packages/protocol/base/ids.ts`의 목록에 `bpf`를 더해 두었다). `packages/protocol/lophn-agent/`의 file은 이것만 쓰고 `packages/protocol/shell/browser-profiles.ts`를 import하지 않는다(`check-deps`의 protocol-cycle: 그 file이 `lophn-agent/agent-profile.ts`를 import한다).
    - `packages/protocol/lophn-agent/host-queue.ts`에 더한 두 칸. `tabOpenPayloadSchema`에 `owner: idSchema("ses").optional()`(그 탭의 주인 session. 없으면 사람이다), 그리고 `hostTabTargetSchema`의 browser 갈래만 `{ browser: { url, profile: idSchema("bpf").optional() } }`(`tabsOpen` 입력의 browser target은 `{url}` 그대로라 agent가 profile을 고르지 못한다).
  - 내놓는 것(이 task가 `host-queue.ts`에 정확히 이 모양으로 더한다. 뒤 task `tab-owner-hand`가 이 모양에 기댄다):
    ```ts
    export const TAB_LIST_KINDS = ["session", "terminal", "browser", "preview", "artifact", "phone"] as const;
    const tabListItemSchema = z.strictObject({
      tab: idSchema("tab"),
      owner: idSchema("ses").nullable(),      // 사람 token이 연 탭은 null
      kind: z.enum(TAB_LIST_KINDS),
      title: z.string(),                      // 아래 "정한 것"
      url: z.string().nullable(),             // browser만. 마지막 상태의 url, 없으면 연 url
      path: z.string().nullable(),            // artifact만. `artifacts/<name>`
      loading: z.boolean().nullable(),        // browser만. 상태가 없으면 null
      handed: z.boolean(),                    // 사람이 넘겨준 탭. 닫지 못한다
    });
    export const tabsList = defineMemory({
      resource: "tabs", method: "list", name: "ListTabs",
      input: z.strictObject({}),
      output: z.strictObject({ tabs: z.array(tabListItemSchema) }),
      actors: ["agent", "user"], errors,
    });
    export const tabsHand = defineMemory({
      resource: "tabs", method: "hand", name: "HandTab", changes: [],
      input: z.strictObject({
        tab: idSchema("tab").optional(),      // 없으면 새 id(사람이 손으로 연 탭). 있으면 그 id로 둔다(다시 알리기, 다른 session에 다시 넘기기)
        session: idSchema("ses"),
        workspace: hostWorkspaceSchema,       // 탭이 있는 workspace
        profile: idSchema("bpf").optional(),  // 탭의 browser profile. 없으면 기본
        url: z.string().max(8192),            // 지금 주소. 상태가 오기 전 tab list가 낸다
      }),
      output: z.strictObject({ tab: idSchema("tab") }),
      actors: ["user"], errors,
    });
    ```
    `HOST_QUEUE_MEMORY_ROUTES`에 `tabsList`, `tabsHand`를 더한다(이 file 안의 목록이라 이 task가 고친다). `HostQueue` port(`queue.ts`)에는 `hand`, `list`를 더한다.
  - `tab_open`의 `owner`: core가 늘 채운다. 주인이 session이면 그 id, `"person"`이면 칸을 뺀다. renderer는 `tab-owner-screen`이 읽는다.

## 할 일

1. `queue.ts`의 `TabEntry`에 칸을 더한다: `handed: boolean`(사람이 넘긴 탭), `profile: string | null`(browser 탭의 profile, 기본은 null), `target`(목록의 kind·title·path를 내는 데 쓰는 연 대상. session id, terminal ref, preview·phone 앱, artifact 이름, browser 연 url). `OpenInput`에 `profile?: string`을 더하고 `place()`가 browser target에 `profile`을 싣는다(값이 있을 때만). 이 task의 wiring은 profile을 아직 넘기지 않는다(뒤 `browser-profile-core`가 agent 정의로 채운다).
2. `place()`가 `tab_open` payload에 `owner`를 싣는다(`"person"`이면 뺀다). preview·artifact처럼 하나만 두는 탭이 이미 있고 주인이 바뀌면 같은 탭 id로 `tab_open`을 한 번 더 넣어 창이 주인을 고치게 한다(지금 preview에 기기·화면이 있을 때 다시 넣는 것과 같은 길).
3. `close()`: 넘겨받은 탭(`handed`)은 주인 session도 닫지 못한다. `forbidden`이고 문장은 model이 그대로 받는 고정 문장이다(예: "The person handed you this tab; you cannot close it. Tell the person when you are done."). 사람 token은 주인이 아니라 지금처럼 `forbidden`이다.
4. `hand(input: {tab?, owner: Id<"ses">, workspace, profile, url}): Result<Id<"tab">>`를 더한다.
   - `tab`이 없으면 새 id로 `{owner, workspace, kind: "browser", handed: true, profile, state: {url, title: "", loading: false}}`를 올린다. `tab_open` 요청은 넣지 않는다(탭은 이미 창에 있다). `changed()`를 부른다(멀리서 보기 목록).
   - `tab`이 있고 표에 없으면 그 id로 같은 값을 올린다(창이 core에 다시 붙을 때 다시 알린다).
   - 표에 있고 `handed`거나 주인이 `"person"`이면 주인·profile을 바꾸고 `handed: true`로 둔다. agent가 연 탭(그 밖)이면 `conflict`다.
5. `list(caller: TabOwner, inScope: (owner: TabOwner) => boolean)`를 더한다. `inScope(entry.owner)`인 탭을 위 `tabListItemSchema` 모양으로 낸다. title·url은 page가 정한 글이라 부른 쪽(wiring)이 redaction을 거친다. 그리고 순수 함수 `withinTeam(caller, owner, parentOf: (session) => string | null): boolean`을 export한다: owner가 caller 자신이거나 caller 밑(owner에서 `spawned_by`를 64번까지 거슬러 caller를 만나면 참). 사람 token(`"person"`)은 owner가 `"person"`일 때만 참이다.
6. `unlink()`는 그대로 browser 탭(넘겨받은 탭 포함)을 모두 뺀다. 다시 알리기는 창이 `tabs/hand {tab}`으로 한다(`tab-owner-hand`).
7. `wiring/host-queue.ts`: `tabsList` handler(부른 쪽의 주인을 `owner()`로 읽고 `inScope = (o) => withinTeam(caller, o, (s) => sessionRow(s)?.spawned_by ?? null)`. title은 session이면 `sessionRow(...).title ?? ""`, browser면 상태의 title, preview·phone은 앱 id, artifact는 이름, terminal은 `""`. url·title은 `deps.redact`를 거치고 못 끝내면 `unavailable`), `tabsHand` handler(사람 token만. `sessionRow(session)`이 없거나 `lifecycle !== "open"`이면 `not_found`). 둘을 route 표에 단다.
8. `input-tags.ts`의 `UNTRUSTED_SOURCES`에 `"tab.list"`를 더하고, `tab.ts`에 `tab.list` 명령을 더한다: 입력 없음, `routes: [tabsList]`, `effect: "read"`, `workspaces: WORKSPACE_KINDS`, `arrayKeys: ["tabs"]`, 찍는 글은 `wrapUntrusted("tab.list", ...)`(page title·url이 들어 있다). description에 "자기 탭과 team spawn으로 연 자기 밑 session의 탭만 나온다, 사람이 손으로 연 탭은 사람이 넘겨야 나온다, handed 탭은 닫지 못한다"를 쓴다. `TAB_COMMANDS`에 더한다. agent 자격의 operation과 lophn agent의 `lophn` tool은 명령의 `routes`와 명령 목록에서 저절로 나온다(`packages/core/agent-workspaces/credentials.ts`, `packages/core/lophn-agent/tools/lophn/`). 따로 등록할 곳이 없다.
9. flows: `harness.yaml`에 `host-tab-list`, `host-tab-hand` flow를 쓰고 `host-tab-close`의 `forbidden` outcome `when`에 넘겨받은 탭을 더한다. `cli.yaml`의 cli link에 `cli:tab.list`를 단다. queue_test에 더한 test가 단정하는 outcome을 `project-docs/flows/tests/core-rest.yaml`의 그 file 줄 `covers`에 더한다(그 yaml은 같은 wave의 `tab-owner-layout`도 한 줄 고칠 수 있다. 줄만 더한다). `node tools/flows.ts check`.

정한 것:
- 표는 메모리 그대로다(README 정한 것 1). 다시 알리기는 route 하나(`tabs/hand {tab}`)로 한다: 새 frame을 만들지 않고, 처음 넘기기와 같은 검사(session이 열려 있나)를 지난다.
- `tabs/list`는 사람 token에게도 연다(`tab open|close|show`와 같은 actor). 사람 token은 `"person"` 탭만 본다.
- coordinator가 자기 탭을 자식에게 넘기는 길(roadmap "넘기기")은 이 계획에서 만들지 않는다. 계획 README 단계 2가 사람의 탭만 말해서다. 보고에 적는다.

## 끝남

- `npm run check`가 통과한다.
- 위험 test(`packages/core/host-queue/queue_test.ts`):
  - "넘겨받은 browser 탭은 주인 session이 닫으려 해도 forbidden이고 탭은 표에 남는다"
  - "tabs/hand는 agent가 연 탭을 사람에게 넘겨받은 탭으로 바꾸지 못한다(conflict)"
  - "tab list는 자기 탭과 자기 밑 session의 탭만 내고 부모·형제 session의 탭은 내지 않는다"(`withinTeam`을 표로 본다)
- 남지 않음: 없음(이름을 바꾸지 않는다).

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
