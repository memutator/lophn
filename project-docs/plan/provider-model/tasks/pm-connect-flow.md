# pm-connect-flow

provider 연결 화면을 Settings → Providers 밖에서도 열 수 있게 하고(model picker의 "Connect provider" 줄이 부른다), provider를 붙인 직후 전역 기본 model이 없으면 기본 model을 고르게 한다. 연결 자체(key 보호 창, 구독 로그인, custom 입력)와 보안 규칙은 바꾸지 않는다.

**먼저 지금 코드를 다시 읽는다**: 계획 `ui-fixes`가 들어온 뒤의 `packages/shell/renderer/desktop/settings/providers/**`, `packages/shell/renderer/desktop/main.tsx`, `desktop/settings/agents/agents-panel.tsx`를 읽고 시작한다.

- 단위: pm-screens (wave 3)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/shell/renderer/desktop/settings/providers/**`
  - `packages/shell/renderer/desktop/main.tsx`(host를 끼우는 줄만)
  - `packages/design/wording/catalog/{common,agents}.ts`(key만)
- 읽을 것:
  - README: `project-docs/plan/provider-model/README.md`의 "정한 것"(model picker 맨 아래 "provider 붙이기" 줄, 처음 붙일 때)
  - 지금 연결 화면: `provider-list.tsx`(Add a provider 목록, `ConnectDialog`, 창에서 돌아오면 focus로 다시 읽기), `connect-dialog.tsx`, `settings-source.ts`(`WindowOutcome`: 보호 창을 연 결과이고 창은 닫혀도 결정이 아니다), `core-source.ts`의 `connect`/`registerCustom`/`connectWithKey`
  - 기본 model 저장: `desktop/settings/agents/settings-source.ts`의 `read().defaultModel`, `changeDefaultModel`, `editor.models()`, 그리고 `workspace/agents/editor/model-field.tsx`의 `DefaultModelField`
  - 화면 규칙: `.claude/skills/ui-design/SKILL.md`, `.claude/skills/wording/SKILL.md`
  - 본보기(화면): `tools/wireframes/pages/screens/settings.tsx`의 `new-settings-providers`, `new-settings-connect`
- 계약:
  - 쓰는 것: `ProviderSettingsSource`(`connected()`, `available()`, `connect`, `registerCustom`), `AgentsSettingsSource`
  - 내놓는 것(다음 task `pm-picker-ui`가 기대는 모양): `desktop/settings/providers/connect-host.tsx`가 내는
    ```ts
    export type ConnectProviderApi = {
      // Connect provider 대화창을 연다. 연결이 끝나면 새로 생긴 provider id(찾지 못하면 null)로 onConnected를 부른다.
      open(options?: { onConnected?: (providerId: string | null) => void }): void;
    };
    export const ConnectProviderContext: React.Context<ConnectProviderApi | null>;
    export function useConnectProvider(): ConnectProviderApi | null; // host 밖이면 null
    export function ConnectProviderHost(props: { providers: ProviderSettingsSource; agents: AgentsSettingsSource; children: ReactNode }): ReactNode;
    ```

## 할 일

1. 정의 고르기를 대화창으로 뽑는다: Settings → Providers의 "Add a provider" 목록(내장 정의, Custom provider 줄, 줄마다 [+ Connect])을 `ConnectProviderDialog`로 만들어 새 host가 열 수 있게 하고, Settings → Providers 화면은 같은 목록 component를 쓴다(복사하지 않는다). 고른 정의의 `ConnectDialog`는 그대로 쓴다.
2. host(`connect-host.tsx`): 위 계약대로 context를 낸다. `open`을 부르면 정의 고르기 대화창이 열리고, 연결이 끝난 뒤 `connected()`를 다시 읽어 이전에 없던 provider id를 찾아 `onConnected`에 준다. key 연결은 보호 창이 따로 끝나므로(`WindowOutcome` 설명) 창이 닫힌 뒤 창이 다시 focus를 받을 때 한 번 더 읽는다(`provider-list.tsx`의 focus 재읽기와 같은 방식, 오래 기다리지 않는다). 모르면 null을 준다.
3. 처음 붙일 때: 연결이 끝난 뒤(위 `open`으로 연 것이든 Settings → Providers에서 한 것이든) `agents.read().defaultModel`이 null이면 "기본 model 고르기" 대화창을 띄운다. 본문은 지금의 `DefaultModelField`(model 목록은 `agents.editor.models()`)이고, 고르면 `agents.changeDefaultModel`로 저장하고 닫는다. [Skip]이 있고, 이미 기본값이 있으면 띄우지 않는다. 한 번의 연결에 한 번만 띄운다. 이 대화창의 본문은 `pm-picker-ui`가 공유 picker로 바꾸지만 `DefaultModelField`의 props(`models`, `value`, `onChange`)는 유지된다.
   Settings → Providers 화면의 `onConnected`도 같은 뒤처리를 부르도록 host가 `useAfterConnect` 같은 작은 hook을 내거나 Providers 화면을 host 안에 둔다.
4. `desktop/main.tsx`: `settingsPanels.providers`와 `settingsPanels.agents`가 있을 때 `ConnectProviderHost`로 화면 전체를 감싼다. 없으면(mock 등) 감싸지 않고 `useConnectProvider()`는 null이다.
5. 문구: Providers 화면의 안내(`settings.notice.provider-lead`, "You choose models per agent and per session, not here.")를 model을 picker와 Settings → Agents에서 고른다는 말로 고친다. 새 key는 영역 file에 더하고 `deno task wording`으로 placeholders를 만든다. 손으로 `*.placeholders.ts`를 고치지 않는다.
6. fake source(`providers/testdata/fake-providers.ts`)를 설정으로 상태를 정할 수 있게 한다: 연결된 provider 0개, 일부 연결, 연결 뒤 기본 model 없음. 다음 wave의 gallery가 쓴다.

## 끝남

- `deno task check`, `deno run -A packages/shell/renderer/build.ts`, `deno task wording --check`가 통과한다.
- 위험 test: 없음(화면과 연결 흐름. 데이터를 잃거나 권한을 넘는 규칙이 아니다).
- 남지 않음: `grep -rn "not here" packages/design/wording/catalog/*.ts`가 옛 안내 문장을 0줄로 둔다.
- 손 확인: `deno task dev:mock`(renderer build 먼저)에서 Settings → Providers의 [+ Connect]가 전과 같이 열린다.

## 보고

- 바꾼 file, 통과한 check
- 등록할 것: wording 생성물이 바뀌면 그 사실
- 정한 것(새 provider id를 찾는 방법, focus 재읽기 횟수) / 넘길 줄 / 계약 바꾸기 요청
- **무겁게 짠 것** / **알려진 미완 동작**: 없으면 "없음"
