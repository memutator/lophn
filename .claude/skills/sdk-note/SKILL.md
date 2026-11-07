---
name: sdk-note
description: lophn SDK 판(`packages/sdk/*`, 지원 소스 `packages/design` 등)을 올리거나, 앱 agent가 읽는 지침(SDK guide, 내장 skill `design-app`·`migrate-sdk`, 앱 template의 `AGENTS.md.tmpl`·`lophn.ts.tmpl`)을 바꿀 때 쓴다. 판을 정하고, pin을 고치고, `migrate-sdk` 메모(`<part>-<x.y.z>.md`)와 Instruction diff를 쓰고, `lophn.supported_from`을 정한다.
---

# SDK 판 메모 쓰기

앱은 lophn SDK를 정확한 판으로 고정한다. lophn이 판을 올리면 앱의 lophn agent가 내장 skill `migrate-sdk`(`packages/core/agent-workspaces/skills/migrate-sdk/`)의 메모를 고정 판 다음부터 지금 판까지 `Previous:`를 따라 읽고 코드와 자기 지침을 고친다. 그래서 메모는 앱 agent가 이 저장소를 모른 채 읽고 따라 할 수 있어야 한다. 읽는 쪽 절차는 그 skill의 `SKILL.md`이고, 메모 저장과 지원 하한의 규칙은 `project-docs/architecture/ui-kit.md`의 판 절이다.

## 언제

- `packages/sdk/<part>/` 안의 file이 바뀐다(code, `guide.md`, `package.json`). 같은 판 번호로 bytes를 바꾸지 않는다. 바꾸면 이미 그 판을 깐 앱의 `npm ci`가 깨진다.
- 앱 agent가 읽는 지침만 바뀐다(`design-app` skill, 앱 template). SDK 판은 그대로일 수 있지만 습관을 바꿔야 하는 변경이면 SDK guide에도 한 줄을 두고 판을 올려 메모로 알린다. 메모가 없으면 이미 있는 앱의 agent는 바뀐 지침을 알 길이 없다.

## 1. 판을 정한다

각 SDK `guide.md`의 "version 정책"을 따른다.
- **patch**: API·동작을 유지한 내부 수정, 문서 고침.
- **minor**: 기존 API를 유지한 추가. 지침만 바뀌어 앱이 따라야 할 습관이 생긴 것도 minor다.
- **major**: API·동작의 제거나 변경, 요구 permission 증가.

같이 움직이는 package를 본다. 한 SDK가 다른 SDK를 정확한 판으로 의존하면(`@lophn/app-ui` → `@lophn/declaration`·`@lophn/ui`), 의존 쪽 pin이 바뀌는 것만으로 그 SDK의 bytes가 바뀌므로 그 SDK도 판을 올린다.

## 2. pin을 고친다

판을 올린 SDK마다 정확한 판이 적힌 곳을 모두 바꾼다. 하나라도 빠지면 `npm ci`가 깨진다(`project-docs/issues/mistakes.md`에 빠뜨린 일이 있다).

```
grep -rn '"@lophn/<part>"\|@lophn/<part>@\|sdk/<part>/' \
  packages/sdk packages/core/apps/packages/template tests/support tools/wireframes/package.json \
  project-docs/architecture/app-call.md packages/sdk/*/guide.md
```

- 다른 SDK의 `package.json` 의존
- 앱 template: `packages/core/apps/packages/template/app/`의 `lophn.ts.tmpl`(`sdk_dependencies`), `package.json.tmpl`(`file:.lophn/sdk/<part>/<판>`), `AGENTS.md.tmpl`
- `tests/support/app/sample/lophn.ts.tmpl`, `tools/wireframes/package.json`
- guide의 peer 표와 예
- `package-lock.json`은 `npm install`로 다시 만든다.

## 3. 메모를 쓴다

file은 `packages/core/agent-workspaces/skills/migrate-sdk/<part>-<x.y.z>.md`다. `<part>`는 package 이름에서 `@lophn/`를 뺀 것이다. 이미 낸 판의 메모는 고치지 않는다(앱 agent가 그 판에서 이미 읽었다). 앞 판 메모 한두 개를 열어 꼴을 본뜬다(`app-ui-2.5.0.md`는 minor, `declaration-4.0.0.md`는 major의 본보기).

~~~markdown
# @lophn/<part> <x.y.z>

Previous: <앞 판 x.y.z, 첫 판이면 none>
Breaking: <no | yes. 무엇이 안 되나(예: 옛 판으로 봉인한 release가 뜨지 않는다). 같이 옮길 package와 판>

<무엇이 바뀌었나 한두 문장>

<옮기는 code: Before / After block. 이름 바꾸기면 찾을 옛 이름 목록>

<앱에 요구되는 것. 없으면 "Nothing is required of an existing app."과 그래도 쓰면 좋은 때>

## Instruction diff        ← 앱 agent가 읽는 지침이 바뀐 판에만

<무엇을 하라: 앱의 AGENTS.md 중 template에서 온 lophn 관리 부분을 아래 새 줄에 맞추고, 앞으로 만들 화면에서 옛 습관을 버린다>

```diff
<git이 낸 diff. 바뀐 hunk만>
```
~~~

- **말**: 영어, 명령형, 짧게. 앱 agent가 쓰는 이름(SDK API, 앱 file `lophn.ts`·`package.json`·`DESIGN.md`·screens)만 쓴다. lophn 저장소 path, 계획·task 이름, core 내부 이름을 쓰지 않는다.
- **code는 실제로 옮기는 모양**이어야 한다. 새 API를 더한 minor도 한 줄 예를 둔다.
- **같이 움직이는 판**을 `Breaking:` 줄이나 본문에 적는다(예: "Move together with `@lophn/app-ui` 2.3.0").
- **안 옮기면 무엇이 되나**를 적는다: 뜨지 않음, 경고, 모양만 겹침, 아무 일 없음.

### Instruction diff

앱 agent가 읽는 지침 글이 이 판에서 바뀌었으면 넣는다: SDK `guide.md`, 내장 skill(`packages/core/agent-workspaces/skills/design-app/SKILL.md`, `migrate-sdk/SKILL.md` 등), 앱 template(`AGENTS.md.tmpl`, `lophn.ts.tmpl`의 주석). code가 아니라 습관이 바뀌는 변경이 agent에게 전해지는 길은 이것뿐이다.

- 같은 변경 안의 지침 file diff를 git으로 뽑는다. 손으로 다시 쓰지 않는다.

  ```
  git diff <변경 전 commit> -- packages/sdk/<part>/guide.md \
    packages/core/agent-workspaces/skills/design-app/SKILL.md \
    packages/core/apps/packages/template/app/AGENTS.md.tmpl
  ```

- 바뀐 hunk만 남기고 문맥 줄은 줄인다. 지침과 상관없는 hunk(판 번호 표, pin)는 뺀다.
- diff 위에 agent가 할 일을 쓴다: 그 앱 `AGENTS.md`의 lophn 관리 부분을 새 줄로 맞춘다, 옛 습관(예: 화면이 자기 머리 줄을 그림)을 앞으로 하지 않는다.

## 4. 지원 하한을 정한다

SDK와 지원 소스의 `package.json`에는 `"lophn": {"supported_from": "x.y.z"}`(lophn이 아직 돌리는 가장 옛 판)가 있다. 올리는 것은 둘 중 하나일 때뿐이다.
- 그 판 아래로 봉인한 bundle이 지금 core에서 뜨지 않는다(예: `@lophn/declaration` 4.0.0, `sizes` 선언).
- 그 판 아래 사본이 기대는 다른 SDK 판이 설치되지 않는다(예: `@lophn/app-ui`는 declaration 4.0.0에 기대는 2.3.0부터).

하한을 올리면 그 하한 판의 메모가 있어야 하고(check가 본다), 앱 `sdk-status`의 `level`이 `required`가 되어 home의 lophn이 앱 이전을 사람에게 묻는다. 판만 더한 minor·patch는 하한을 그대로 둔다.

## 5. 확인

- `node tools/check-sdk-notes.ts`: 지금 판과 하한의 메모, `Previous:`·`Breaking:` 줄, 메모 사슬, 하한 ≤ 판.
- `npm run check`. pin을 고쳤으면 `npm ci`가 깨끗한 worktree에서 되는지도 본다.
- changelog 열린 판 항목에 바뀐 SDK 판을 적는다(`@lophn/<part>` 판, 무엇이 바뀌었나).
