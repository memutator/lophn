# wording-split

`packages/design/wording/en.ts`(3,176줄, 2,503 key)를 wave 3 screens 단위마다 자기 file을 가지는 영역 file로 쪼갠다. 쪼개기 전에 지금 어디서도 쓰지 않는 key를 지우고, placeholder 생성도 영역 file마다 하게 바꿔서 화면 단위가 서로 부딪치지 않게 한다.

- 단위: wording-split (wave 0)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/design/wording/` (새 폴더 `catalog/` 포함)
- 읽을 것:
  - dev: `/home/pyosechang/projects/lophn/project-docs/dev/code.md` "화면" 절(화면 문구는 wording key로 쓴다)
  - 영역 나누기의 근거: `../ownership.md`의 wave 3 `screens-*` 일곱 단위(아래 표가 path를 옮겨 적었다)
  - inventory: `U1.1#8`(쓰는 곳 없는 wording key), `U3.2#6`(call 문구의 안쪽 낱말 규칙) — `/home/pyosechang/projects/lophn/project-docs/tmp/ui-inventory.md` 1.1과 3.2
  - 지금 코드: `packages/design/wording/{en,placeholders,generate,check,rules,format,mod,scan}.ts`, `packages/design/wording/deno.json`
  - 같이 보는 곳(이름이 바뀌면 안 된다): `packages/shell/main/desktop/wording.ts`(`../../../design/wording/en.ts`를 import한다), `packages/core/apps/packages/vendor.ts`의 `@lophn/wording` 항목(폴더를 앱 SDK 사본으로 복사한다. `testdata`만 뺀다), `tools/wireframes/build.ts`(wording package를 bundle에 넣는다)
- 계약:
  - 쓰는 것: 없음
  - 내놓는 것 (그대로 지킨다):
    - 가져오는 길은 지금과 같다: `@lophn/wording`의 `en`, `t`, `createTranslator`, `type MessageKey`, `type Catalog`, `ValuesOf`, `format*`. `en.ts`와 `placeholders.ts`의 path도 그대로다.
    - 생성 CLI: `deno run --allow-read --allow-write packages/design/wording/generate.ts`(쓴다), `... --check`(낡았으면 종료 code 1). check task가 `--check`를 check 단계로 부른다.
    - `generate.ts`의 `placeholdersOf(message)`와 `render(catalog, command)`는 이름과 모양을 유지한다(앱 SDK가 앱 catalog 생성에 쓴다).
    - 화면 단위가 보는 모양은 아래 "영역 file" 표다.

## 영역 file (이 모양으로 쪼갠다)

key는 `<screen>.<part>.<name>` 꼴이다. 첫 구간(screen)은 영역과 일치하지 않는다(`settings.*`는 agent 설정과 coding 설정이 섞여 있다). 그래서 **key를 쓰는 코드의 위치**로 영역을 정한다.

| 영역 file | 가진 단위 | 그 단위의 코드 path (`../ownership.md` wave 3) |
|---|---|---|
| `catalog/data.ts` | screens-data | `packages/shell/renderer/desktop/connection/`, `renderer/overlay/`, `renderer/confirmation/`, `packages/shell/main/confirmation/` |
| `catalog/conversation.ts` | screens-conversation | `renderer/conversation/`, `renderer/workspace/agent/` |
| `catalog/project.ts` | screens-project | `renderer/workspace/`(아래 contexts와 agents 제외), `renderer/editor/`, `renderer/terminal/`, `packages/shell/main/editor/`, `main/workspace/` |
| `catalog/contexts.ts` | screens-contexts | `renderer/workspace/contexts/` |
| `catalog/agents.ts` | screens-agents | `renderer/workspace/agents/`, `renderer/desktop/lophn-space/settings/{agents,providers,extensions}/` |
| `catalog/app-space.ts` | screens-app-space | `renderer/app-frame/`, `packages/shell/main/app-frame/` |
| `catalog/workspace.ts` | screens-workspace | `renderer/desktop/`(위 settings 셋과 `connection/` 제외), `renderer/icons/`, `renderer/entry.tsx` |
| `catalog/common.ts` | 공용 (아래 규칙) | 둘 이상의 단위가 쓰는 key, `packages/design/`·`packages/sdk/`·`packages/shell/main/desktop/`·`packages/core/`·`packages/protocol/`·`packages/coding-agent/`에서 쓰는 key |

- 영역 file 하나는 `export const <camelCase 이름> = { "<key>": "<문장>", ... } as const;` 하나다(예: `catalog/app-space.ts`의 `export const appSpace = {...} as const`). 이 file의 key는 이 file에만 있다. key는 이름순으로 둔다.
- 영역 file 옆에 `catalog/<영역>.placeholders.ts`가 생성된다(아래 3번).
- 영역을 정하는 방법:
  - key마다 `packages/` 아래 `.ts`/`.tsx`(`packages/design/wording/`, `testdata/`, `dist/`, `node_modules/` 제외)에서 key 글자 그대로 나오는 곳을 찾는다.
  - 쓰는 곳이 모두 한 단위의 path 안이면 그 단위의 영역 file이다. 둘 이상의 단위에 걸치거나 표의 `common` 쪽 path에서 쓰면 `common.ts`다.
  - 동적으로 이어 붙이는 key(예: `` t(`x.${kind}`) ``, `as MessageKey`)는 prefix가 같은 key 전체를 그 호출 file이 쓴다고 본다. `grep -rn "as MessageKey\|keyof typeof en\|MessageKey)" packages --include=*.ts --include=*.tsx`로 먼저 찾는다.
  - 삭제 예정 코드(wave 1이 지울 `things-to-confirm`, `documents`, `notification-chip` 등)가 쓰는 key도 그 코드의 path로 영역을 정한다. 지우는 것은 cleanup 몫이다.
- 영역 file이 600줄을 넘으면 `<영역>-<부분>.ts`로 나눈다(예: `agents-settings.ts`). 같은 단위가 가진 file이어야 한다. 이름은 `en.ts`의 목록에 같이 올린다.

## 할 일

1. **기준선**: 지금 `deno task check`가 통과하는지 먼저 본다. 통과하지 않으면 이유를 보고에 쓴다. key 수(2,503)와 `placeholders.ts` 줄 수를 적어 둔다.
2. **쓰는 곳 없는 key를 지운다** (`U1.1#8`).
   - 위 "영역을 정하는 방법"의 검색으로 key별 사용처를 모은 임시 script를 scratchpad에 만든다(저장소에 넣지 않는다). 사용처가 없고 동적 이어 붙이기에도 걸리지 않는 key를 지운다. 예상은 505개다(roles 298, settings 101, confirmation-window 49, conversation 20 등). 실제 개수와 prefix별 개수를 보고에 쓴다.
   - 보수적으로 한다. `packages/` 안 어디에서든(`core`, `protocol`, `shell/main`, SDK 포함) key 글자가 하나라도 나오면 쓰는 것으로 본다. `packages/protocol/problems/problem-codes.ts`의 `message_key` 문자열이 가리키는 key도 쓰는 것이다.
   - 지우고 나서 `deno check`로 `t("...")` 호출이 모두 남은 key를 가리키는지 본다. 동적 호출은 type이 못 잡으므로 위 grep으로 한 번 더 본다.
   - **지우지 않는 것**: 지금 코드가 쓰는 key는 wave 1·3 단위가 코드를 지울 때까지 남긴다. 확인 창 wording(`confirmation-window.*`의 approval, grant, release-activation, confirm, automation, account), coding·MCP·Task 문구, `common.button.copy-address`는 지금 쓰는 곳이 있으면 이 task에서 지우지 않는다(`assignment.md`에서 다른 단위로 넘긴다).
3. **영역 file로 쪼갠다.**
   - 임시 script로 `en.ts`를 위 표대로 나눈다. 값(문장)은 한 글자도 바꾸지 않는다. 쪼갠 뒤 `deno fmt`를 돌린다.
   - `packages/design/wording/en.ts`는 이제 영역 목록이다(lead 소유 등록 file이 된다).

     ```ts
     import { agents } from "./catalog/agents.ts";
     // ... 영역마다 한 줄
     export const AREAS = { agents, "app-space": appSpace, /* ... */ } as const;
     export const en = { ...agents, ...appSpace, /* ... */ } as const;
     export type Catalog = typeof en;
     export type MessageKey = keyof Catalog;
     ```

     `AREAS`의 key는 영역 file 이름이다. 영역을 더하려면 이 file에 import 한 줄, `AREAS` 한 칸, spread 한 칸을 더한다.
   - `generate.ts`를 영역별 생성으로 바꾼다.
     - 영역 `<영역>`마다 `catalog/<영역>.placeholders.ts`를 만든다. 내용은 지금 `placeholders.ts`의 `PlaceholderKinds` 가운데 그 영역 key만 든 type `export type <Camel>Placeholders = {...}`와 그 영역 key와 정확히 같은지 보는 `_SameKeys` 검사다. 머리 주석은 지금처럼 "생성한다, 직접 고치지 않는다"이고 재생성 명령을 적는다.
     - `placeholders.ts`는 생성하지 않고 손으로 둔다(lead 소유 등록 file). 영역별 type을 `PlaceholderKinds = AgentsPlaceholders & AppSpacePlaceholders & ...`로 합치고, 지금 있는 `ValuesOf`, `HasPlaceholders`를 그대로 내보낸다. `format.ts`, `mod.ts`가 쓰는 모양이 바뀌면 안 된다.
     - CLI: 인자 없으면 모든 영역의 생성물을 쓰고, `--check`는 낡은 file이 있으면 file 이름을 stderr로 내고 종료 code 1이다.
     - 오류도 CLI가 낸다: 영역 file 사이에 같은 key가 있으면(`Object.keys(en).length`가 영역 key 수의 합과 다르다) 실패, `AREAS`에 없는 영역 file이 `catalog/`에 있어도 실패.
     - `placeholdersOf`와 `render`(앱 catalog용 단일 file 생성)는 그대로 둔다. `render`가 쓰는 `import type { MessageKey } from "./en.ts"` 머리는 앱 쪽 모양이라 바꾸지 않는다.
   - `deno.json`(wording package)의 `exports`는 바꾸지 않는다.
4. **`rules.ts`와 `check.ts`를 맞춘다.**
   - `SCREENS` 상수(고정 목록)를 없앤다. key 모양 검사는 첫 구간이 kebab-case 이름이면 통과한다(`keyShape()`의 기본값). 앱 catalog가 `keyShape(screens)`로 자기 목록을 주는 길은 그대로 둔다. 화면 단위가 새 첫 구간을 써도 이 file을 고치지 않게 하려는 것이다.
   - `INTERNAL_WORDS`에 `call`, `accepted`를 더한다 (`U3.2#6`: 화면에 그대로 내지 않는 안쪽 낱말). 지금 그 낱말이 든 key(예: `settings.label.apply-next-call`)가 경고를 내면 고치지 않고 보고에 목록을 쓴다. 경고는 check를 막지 않는다. call 상태 문구 자체는 screens-conversation이 `catalog/conversation.ts`에 쓴다.
   - `checkScreens`가 낸 catalog 위반의 file 이름을 영역 file로 낸다(`catalog/<영역>.ts`). 어느 file을 고쳐야 하는지 보이게 하려는 것이다. 영역별로 `checkSource`를 돌리면 된다.
5. **`generate.ts`로 생성물을 만든다.** `deno run --allow-read --allow-write packages/design/wording/generate.ts`로 영역별 생성물을 만들고 `--check`가 통과하는지 본다. 옛 `placeholders.ts`의 3,279줄 본문은 이 task가 직접 새 손 file로 바꾼다.
6. **마무리**: `deno task check`. check task가 아직 `deno task wording`과 wording 단계를 안 넣었으면 위 `--check` 명령을 직접 돌려 확인한다.

## 끝남

- `deno task check`가 통과한다.
- `deno run --allow-read packages/design/wording/generate.ts --check`가 통과한다.
- 위험 test: 없음 (문구는 test 대상이 아니다. `../../dev/testing.md` "쓰지 않는 test")
- 남지 않음:
  - `wc -l packages/design/wording/en.ts packages/design/wording/placeholders.ts`가 각각 100줄 안쪽이다.
  - `grep -rn "SCREENS" packages tools --include=*.ts`가 0줄이다.
  - `en`의 key 수 = 영역 file key 수의 합 = 2,503 − 지운 수 (보고에 숫자를 적는다).

## 보고

- 바꾼 file (영역 file 목록과 key 수)
- 등록할 것: 없음 (이 task가 `en.ts`·`placeholders.ts`를 직접 만든다. 이후 영역을 더하는 것은 lead 몫이다)
- 안 쓰게 된 export: `SCREENS`, 옛 `placeholders.ts`의 `PlaceholderKinds` 본문
- 정한 것:
  - 지운 key의 prefix별 개수와 동적 이어 붙이기로 남긴 key 목록
  - `common.ts`로 간 key의 수와 이유가 큰 묶음
  - 영역 file 이름(위 표에서 바꾼 것이 있으면)
  - 생성물을 영역별로 두기로 한 것: 화면 단위가 자기 영역 file을 고친 뒤 `generate.ts`를 돌려 자기 영역의 `*.placeholders.ts`만 바꾸므로 합칠 때 충돌이 없다. lead는 새 영역을 더할 때만 `en.ts`와 `placeholders.ts`를 고친다. 전부 한 번에 다시 만들려면 인자 없는 `generate.ts` 한 번이다.
  - 경고가 난 key 목록 (`call`, `accepted`)
