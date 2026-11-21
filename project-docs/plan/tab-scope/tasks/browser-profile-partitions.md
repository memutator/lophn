# browser-profile-partitions

browser 탭마다 profile의 partition을 쓰게 한다. shell main은 partition마다 session 정책을 깔고, `<webview>` 붙이기 검사를 "알려진 profile의 partition 가운데 하나"로 바꾸고, agent driver와 page host와 데이터 지우기가 profile을 안다. renderer는 탭 값의 `profile`로 partition을 고르고, 탭에서 연 탭과 popup은 연 탭의 profile을 따른다. 화면(고르기, 표시)은 만들지 않는다.

- 단위: browser-profile (wave 1)
- 선행: 없음. lead가 띄우기 전에 아래 "계약"의 protocol file을 commit해 둔다.
- 소유(이 task만 고친다):
  - `packages/shell/main/browser/session.ts`
  - `packages/shell/main/browser/electron-session.ts`
  - `packages/shell/main/browser/webview-guest.ts`
  - `packages/shell/main/browser/webview-guest_test.ts`
  - `packages/shell/main/browser/electron-view.ts`
  - `packages/shell/main/browser/registry.ts`
  - `packages/shell/main/browser/browser-ipc.ts`
  - `packages/shell/main/browser/agent/page.ts`
  - `packages/shell/main/browser/agent/electron-page.ts`
  - `packages/shell/main/page-host/pages.ts`
  - `packages/shell/main/page-host/main.ts`
  - `packages/shell/main/desktop/wiring/browser.ts`
  - `packages/shell/main/workspace/kinds/browser.ts`
  - `packages/shell/ipc/browser.ts`
  - `packages/shell/preload/browser-api.ts`
  - `packages/shell/renderer/app-frame/webview-host.tsx`
  - `packages/shell/renderer/app-frame/workspace-views.tsx`
  - `packages/shell/renderer/workspace/use-surface-requests.ts`
  - `packages/shell/renderer/workspace/kinds/browser.tsx`
  - `packages/shell/renderer/browser/browser-tab.tsx`
  - `packages/shell/renderer/browser/profiles.tsx`
  - `packages/shell/renderer/desktop/settings/browser/window-source.ts`
  - `project-docs/flows/areas/ipc.yaml`
- 읽을 것:
  - 계획: `project-docs/plan/tab-scope/README.md`("browser profile의 id와 partition", "탭의 profile")
  - 제품 결정: `project-docs/products/roadmap/browser-profile.md`의 "무엇을 만드나 › profile"과 "정한 것"
  - architecture: `project-docs/architecture/browser-tab.md`의 "모델 › session", 지키는 것 2·7·18·37·65, "화면 없는 기계의 page"
  - 코드: `packages/shell/main/desktop/wiring/browser.ts`(`ensureSession`, `will-attach-webview`), `packages/shell/main/browser/webview-guest.ts`(`hardenWebviewAttach`), `packages/shell/main/browser/agent/electron-page.ts`(`electronLookup().guest`), `packages/shell/main/page-host/{pages,main}.ts`, `packages/shell/main/desktop/core/settings.ts`(`ShellSettings.get`, `watch`), `packages/shell/renderer/app-frame/webview-host.tsx`(`PARTITION`, `ensure`, `useWebviewSlot`), `packages/shell/renderer/workspace/kinds/browser.tsx`(`openBrowserTab`, `onOpenTab`, `onPopup`, `onOpenInNewTab`)
- 계약:
  - 쓰는 것(lead가 이 task를 띄우기 전에 commit한다. 고치지 않는다):
    - 새 file `packages/protocol/shell/browser-profiles.ts`. 정확히 이 모양이다:
      ```ts
      import { z } from "zod";
      import { idSchema } from "../base/ids.ts";
      import { AGENT_CHARACTER_COLORS } from "../lophn-agent/agent-profile.ts";
      // browser profile 하나는 cookie·저장소 partition 하나와 그 profile의 저장 login이다. 기본 profile은 목록에 없고 id가 없다(null).
      // 그 partition은 처음부터 쓰던 `persist:lophn-browser`라 기존 로그인이 남는다. 목록은 core 설정 `shell.browser_profiles`(사람만 바꾼다)다.
      export const BROWSER_PROFILES_SETTING = "shell.browser_profiles";
      export const BROWSER_PROFILE_ID_PREFIX = "bpf";
      export const browserProfileIdSchema = idSchema("bpf"); // `../base/ids.ts`. lead가 목록에 `bpf`를 더했다
      export const browserProfileSchema = z.strictObject({
        id: browserProfileIdSchema,
        name: z.string().min(1).max(40),
        color: z.enum(AGENT_CHARACTER_COLORS),
      });
      export type BrowserProfile = z.infer<typeof browserProfileSchema>;
      export const BROWSER_PROFILES_MAX = 16;
      export const browserProfilesSchema = z.array(browserProfileSchema).max(BROWSER_PROFILES_MAX).refine(
        (list) => new Set(list.map((p) => p.id)).size === list.length &&
          new Set(list.map((p) => p.name.toLowerCase())).size === list.length,
        { message: "profile ids and names are unique" },
      );
      export const DEFAULT_BROWSER_PARTITION = "persist:lophn-browser";
      export function browserPartition(profile: string | null): string {
        return profile === null ? DEFAULT_BROWSER_PARTITION : `${DEFAULT_BROWSER_PARTITION}-${profile}`;
      }
      // browser partition 글에서 profile을 푼다. 기본이면 null, browser partition이 아니면 undefined.
      export function profileOfPartition(partition: string): string | null | undefined { /* 위 규칙 그대로 */ }
      ```
    - `packages/protocol/lophn-agent/host-queue.ts`의 `hostTabTargetSchema` browser 갈래 `{ browser: { url, profile?: <bpf id> } }`(없으면 기본 profile)와 `tabOpenPayloadSchema.owner?`. 모양은 `tab-owner-core` brief의 "계약". 이 task는 browser 갈래의 `profile`만 읽는다.
    - 설정 `shell.browser_profiles`의 선언은 wave 2의 `browser-profile-core`가 한다. 그 전에는 `ShellSettings.get(BROWSER_PROFILES_SETTING)`이 undefined이고 이 task는 그것을 빈 목록(기본 profile뿐)으로 읽는다.
  - 내놓는 것:
    - 저장 모양: browser kind 값에 `profile?: <bpf id>`(없으면 기본). main `packages/shell/main/workspace/kinds/browser.ts`의 layout schema와 renderer `kinds/browser.tsx`의 `fromStored`/`toStored`. renderer 탭 값은 `fields.profile`(문자열, 없으면 기본)이다.
    - IPC `shell:browser-clear-data`의 입력을 `{ profile: <bpf id> | null }`로 바꾼다(null은 기본 profile). preload `clearData(profile: string | null)`. 알려진 목록에 없는 id도 지운다(지운 profile의 data를 지우는 길이라서).
    - renderer `packages/shell/renderer/browser/profiles.tsx`(새 file): `useBrowserProfiles(): readonly BrowserProfile[]`(core 설정 `shell.browser_profiles`를 읽고 바뀌면 다시 읽는다. 못 읽거나 없으면 빈 목록)와 그 값을 주는 context provider(gallery와 fake는 고정 목록을 준다), `partitionOf(profile: string | undefined, known: readonly BrowserProfile[]): string`(목록에 없는 profile은 기본 partition). wave 2·3의 화면 task가 이것을 쓴다.
    - `Page`(`packages/shell/main/browser/agent/page.ts`)에 `readonly profile: string | null`(browser 탭 page의 profile, 그 밖은 null). wave 2의 `browser-profile-core`가 `fill_login` release에 싣는다.

## 할 일

1. shell main session: `electronBrowserSession(partition: string)`로 바꾸고 `desktop/wiring/browser.ts`의 한 번 설치를 partition마다 한 번으로 바꾼다(`Map<partition, installed>`. userData를 잡은 뒤에만 만드는 규칙 그대로). `session.ts`의 `BROWSER_PARTITION`은 지우고 protocol의 `DEFAULT_BROWSER_PARTITION`·`browserPartition()`을 쓴다.
2. 붙이기 검사(`hardenWebviewAttach`)가 받는 browser partition을 집합으로 받는다: 기본 partition과 `ShellSettings.get(BROWSER_PROFILES_SETTING)`을 `browserProfilesSchema`로 읽은 profile들의 partition. 집합에 없는 partition, `lophn-*` src, 앱·artifact partition은 지금처럼 거절한다. 받은 붙이기는 그 partition의 session 정책을 깐 뒤 붙인다.
3. 크기 준 popup은 opener의 contents라 같은 session이다(확인하고 적는다). crash 뒤 다시 여는 `create`(`electron-view.ts`, `registry.ts`)는 그 popup이 쓰던 partition으로 연다.
4. agent driver의 guest 찾기(`electron-page.ts`의 `guest`)는 알려진 browser partition 가운데 하나의 guest만 browser 탭으로 본다. `Page.profile`을 채운다(desktop은 맞춘 partition에서 `profileOfPartition`, page host는 연 탭의 target profile).
5. page host: `pages.open(tab, url, profile)`이 `browserPartition(profile)`로 offscreen 창을 만들고, `main.ts`가 `tab_open`의 `payload.target.browser.profile ?? null`을 넘기며 partition마다 처음 쓸 때 `installBrowserSession`을 한 번 깐다.
6. 데이터 지우기: `ipc/browser.ts` 입력 schema, `browser-ipc.ts`, preload를 `{profile}`로 바꾸고 그 partition만 지운다(지우고 cache를 비운 뒤 그 profile의 열린 page만 다시 load한다. 지금 다시 load하는 곳을 찾아 같이 좁힌다). 지금 부르는 쪽 `desktop/settings/browser/window-source.ts`는 `clearData(null)`로 맞춘다(화면은 wave 3의 `browser-profile-settings`가 고친다).
7. renderer: `webview-host.tsx`의 `PARTITION` 상수를 지우고 `ensure(key, src, kind, partition?)`와 `useWebviewSlot({ partition })`이 browser kind의 partition을 받는다(없으면 기본). 같은 key의 partition은 바뀌지 않는다(탭의 profile은 정해지면 그대로다).
8. renderer `kinds/browser.tsx`: `fromStored`/`toStored`에 `profile`(bpf id 꼴의 문자열만), `openBrowserTab(host, url, open)`의 `open`에 `profile?: string`. page 안에서 연 탭(`onOpenTab`), 크기 준 popup 탭(`onPopup`, dock하면 같은 profile의 `<webview>` 탭), "Open in new tab"(`onOpenInNewTab`)은 연 탭의 `fields.profile`을 그대로 싣는다. `BrowserTab`(`browser-tab.tsx`)은 `useBrowserProfiles()`와 `partitionOf()`로 partition을 정해 slot에 준다.
9. agent가 연 탭: `use-surface-requests.ts`가 `target.browser.profile`을 `openBrowserTab`에 넘기고, `workspace-views.tsx`의 `HostPlacement`에 `profile: string | null`을 더해 mount 전에 만드는 page(`hostPage`)도 그 partition으로 만든다(core가 보낸 profile은 core가 알려진 목록으로 고른 값이라 그대로 쓴다).
10. main `workspace/kinds/browser.ts`의 layout schema에 `profile: browserProfileIdSchema.optional()`을 더한다(shell code는 `protocol/shell/browser-profiles.ts`를 import해도 된다. `packages/protocol/lophn-agent/`와 `secrets/`의 file만 그 file을 import하지 못한다)(판 올림은 같은 wave의 `tab-owner-layout`이 한다).
11. flows `ipc.yaml`의 `shell:browser-clear-data` flow 입력과 steps를 profile 하나로 고친다. 더한 test의 outcome을 `project-docs/flows/tests/shell.yaml`의 `webview-guest_test.ts` 줄 `covers`에 더한다(그 yaml은 줄만 더한다).

정한 것:
- partition 이름은 `persist:lophn-browser-<bpf id>`다(기본은 그대로). 디스크 자리는 Electron이 userData의 `Partitions/` 아래에 정한다.
- 사람이 Settings에서 막 만든 profile을 main이 설정 event로 받기 전에 붙이면 거절될 수 있다(빈 page). 드문 틈이라 막지 않는다. 보고의 "알려진 미완 동작"에 적는다.

## 끝남

- `npm run check`가 통과한다. renderer를 고쳤으니 `node packages/shell/renderer/build.ts`도 된다.
- 위험 test(`packages/shell/main/browser/webview-guest_test.ts`): "알려진 profile의 partition은 browser guest로 붙고 그 partition이 강제되며, 목록에 없는 profile partition·앱 partition·`lophn-*` src를 적은 붙이기는 거절된다"
- 남지 않음: `grep -rn "BROWSER_PARTITION\|\"persist:lophn-browser\"" packages tests tools`가 `packages/protocol/shell/browser-profiles.ts` 밖에서 0줄이다.

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
