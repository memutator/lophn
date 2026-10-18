# pm-wireframes

gallery(`deno task wireframes`)가 새 model 고르기 흐름의 상태를 진짜 renderer component와 fake data로 보이게 한다. 사람이 gallery에서 모양을 보고 고른다. component는 고치지 않는다(모양을 고치게 되면 `pm-picker-ui`의 일이니 보고한다).

**먼저 지금 코드를 다시 읽는다**: 앞 wave가 들어온 뒤의 `tools/wireframes/pages/screens/{agent,agent-pages,agent-chat,conversation,agent-settings,settings,settings-frame}.tsx`, `agent-setup/agent-setup-pages.tsx`, `tools/wireframes/mock/{agents-data,driven,drive,mock-desktop}.ts(x)`와 fake source 설정(`pm-picker-data`, `pm-connect-flow`가 만든 것)을 읽고 시작한다.

- 단위: pm-wireframes (wave 5)
- 선행: pm-picker-ui
- 소유(이 task만 고친다):
  - `tools/wireframes/pages/screens/**`
  - `tools/wireframes/mock/**`
  - `packages/shell/renderer/workspace/agents/fake-source.ts`
  - `packages/shell/renderer/conversation/agent-tab-fake-source.ts`
  - `packages/shell/renderer/desktop/settings/providers/testdata/fake-providers.ts`
  - `packages/shell/renderer/desktop/settings/agents/testdata/fake-agents.ts`
- 읽을 것:
  - `.claude/skills/ui-design/SKILL.md`("새 화면(page) 만들기", "상태 하나를 고정하는 법": fake source 설정으로 바탕을 정하고 `mock/drive.ts`의 `useDrive`와 `find`·`click`·`press`로 사람이 한 것처럼 만든다. portal로 열리는 dialog와 menu는 drive의 `global`로 찾는다. 함정 절)
  - README: `project-docs/plan/provider-model/README.md`의 "정한 것", "사람이 정할 것"
  - 본보기: `agent.tsx`의 `new-agent-model-picker`, `agent-chat.tsx`의 `modelDemo`, `settings.tsx`의 `new-settings-agents`·`new-settings-connect`, `agent-settings.tsx`의 `new-operator-editor`
- 계약: 쓰는 것은 앞 wave의 fake source 설정이다. 내놓는 것은 아래 page id들이다.

## page (id는 주소라 한 번 정하면 바꾸지 않는다. title은 영어, description은 한국어 한두 문장)

고치는 것(id 그대로):
- `new-agent-model-picker` — 대화의 picker를 연 상태. 연결된 provider 묶음, Favorites, option 축, 맨 아래 Connect provider 줄과 Change defaults…, 머리의 층 한 줄("이 대화"에서 고른 상태).
- `new-settings-agents` — Default model이 새 picker 칸이다.
- `new-operator-editor` — Model 칸에 층이 보인다(이 agent가 고른 상태).
- `new-settings-providers` — 안내 문구만 바뀐다(`pm-connect-flow`).

새로 만드는 것:
- `new-model-picker-empty` — 붙인 provider가 없다. 안내와 Connect provider 줄만 있다.
- `new-model-picker-inherited` — 이 대화에서 고르지 않아 project default를 따른다. 머리의 층 한 줄이 "project default"다.
- `new-model-picker-custom` — custom provider(provider가 알려 준 목록)의 묶음. 일부 이름은 catalog와 겹쳐 정보가 있고 일부는 없다. 묶음 머리의 Refresh models 단추와 이름 직접 적기 줄이 보인다.
- `new-model-picker-refresh-failed` — Refresh models가 실패해 앞 목록이 그대로 있고 picker 안에 실패 한 줄이 있다.
- `new-operator-model-picker` — Operator의 Model 칸 picker를 연 상태. 맨 위 "Use project default — …" 줄, 층 한 줄, Connect provider 줄.
- `new-settings-default-model-prompt` — 처음 provider를 붙여 전역 기본 model이 없을 때 뜨는 "Choose a default model" 대화창.

영역 file(`agent.tsx`, `agent-settings.tsx`, `settings.tsx`)의 `pages`에 올린다. 같은 영역의 page끼리 순서는 흐름 순서(picker 상태 → Settings → Operator)로 둔다.

## 할 일

1. 필요한 fake source 상태를 `mock/`과 renderer의 fake source 설정으로 만든다(provider 없음, 내장 provider와 custom provider, project default 있음, refresh 실패). 화면 모양을 덮어쓰는 CSS나 gallery 전용 prop을 만들지 않는다.
2. gallery 틀이 `ConnectProviderHost`(`pm-connect-flow`)로 감싸지게 한다. 감싸지 않으면 Connect 줄이 숨는다.
3. 위 page를 만들고 고친다. 상태는 drive로 건다(picker 열기, Connect 줄 누르기, 기본 model 대화창 열기).
4. 옛 설명 문구가 틀어진 page description을 맞춘다.

## 끝남

- `deno task check`, `deno task wireframes`가 통과한다.
- 위험 test: 없음(화면).
- (화면) gallery의 위 page들이 진짜 component로 그려진다. 보고에 `python3 -m http.server`로 띄우는 방법과 각 page의 주소(`#/<id>`)를 적는다. 사람이 이 주소들을 보고 모양을 고른다.
- 남지 않음: gallery 전용 CSS를 새로 만들지 않았다(`deno task check`의 kit 단계가 본다).

## 보고

- 바꾼 file, 통과한 check
- 등록할 것: 없음(page는 영역 file에 올렸다)
- page id와 주소 목록
- 정한 것 / 넘길 줄 / 계약 바꾸기 요청(모양을 component에서 고쳐야 하는 곳)
- **무겁게 짠 것** / **알려진 미완 동작**: 없으면 "없음"
