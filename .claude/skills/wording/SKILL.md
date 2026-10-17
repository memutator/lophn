---
name: wording
description: 화면에 보이는 문구(label, 단추, 안내, 오류)를 더하거나 고치거나 지울 때, wording message key를 만들거나 t("...") 호출을 쓸 때, packages/design/wording catalog나 placeholders를 만질 때, check-wording이나 wording 생성 check가 실패했을 때 쓴다.
---

# wording

화면 문구는 코드에 직접 쓰지 않고 message key로 쓴다. catalog는 `packages/design/wording/catalog/<영역>.ts`이고 지금은 en만 있다.

## key 이름

- `<screen>.<part>.<name>`. 세 구간 모두 kebab-case다.
- screen: 문구가 나오는 화면이나 component 이름(`app-panel`, `file-search`). 여러 화면이 쓰는 공용 문구는 `common`이다. 만들기 전에 `common.*`에 같은 뜻이 있는지 먼저 본다.
- part: 종류. 많이 쓰는 것은 `label`, `button`, `heading`, `title`, `notice`, `error`, `empty`, `note`, `status`.
- 마침표: `button`, `title`, `heading`, `label`, `name`, `view`, `models`, `activity` part는 마침표가 없고, 나머지는 문장이라 마침표가 있어야 한다. 어기면 check가 실패한다.
- 값은 완성된 문장 하나의 ICU MessageFormat이다. 문장 조각을 코드에서 이어 붙이지 않는다. 숫자나 복수는 `{n, plural, ...}`로 쓴다.
- 화면에 내보이지 않을 안쪽 말(`ledger`, `release`, `run`, `ticket`, `grant`, `call`, `snapshot`, `claim` 등), snake_case, ID 접두사, 원시 enum은 값에 쓰지 않는다. check가 warning을 낸다.

## 새 문구 더하는 순서

1. 같은 뜻의 key가 이미 있는지 grep한다(`common.*` 먼저).
2. 알맞은 영역 file(`catalog/<영역>.ts`)에 key를 더한다. 기존 정렬을 따른다. 영역 사이에 같은 key를 두지 않는다.
3. `deno task wording`으로 `catalog/<영역>.placeholders.ts`를 다시 만든다.
4. 화면 코드는 `t("key")`나 `t("key", { name })`로 쓴다(`import { t } from "@lophn/wording"`). 값 이름은 문장의 `{placeholder}`와 같아야 한다.
5. `deno run --allow-read tools/check-wording.ts`.
6. `deno task check`.

새 영역 file이 필요하면 `wording/en.ts`에 import 한 줄, `AREAS` 한 칸, `en`의 spread 한 칸을 더하고 `wording/placeholders.ts`(손으로 두는 file)에 import와 `&` 한 칸을 더한다. 그다음 `deno task wording`.

## 명령

| 명령 | 하는 일 |
|---|---|
| `deno task wording` | placeholders 생성물을 쓴다 |
| `deno task wording --check` | 생성물이 catalog와 같은지만 본다 (`deno task check`의 "wording 생성", design이 바뀌면 돈다) |
| `deno run --allow-read tools/check-wording.ts` | 화면 코드의 직접 문구, 없는 key, 값 이름 불일치, catalog 규칙을 본다. warning은 목록만 낸다 |

## 손으로 생성물을 고치지 않는다

`catalog/*.placeholders.ts`는 생성물이다. 한 번 손으로 고치다 괄호를 깨뜨린 채 commit한 적이 있다. 틀렸으면 고치지 말고 `deno task wording`으로 덮어쓴다. 충돌이 나도 손으로 풀지 말고 영역 file(`catalog/<영역>.ts`)을 풀고 다시 생성한다. `generate.ts`는 영역 file이 `AREAS`에 없거나 영역 사이에 key가 겹치면 실패한다.

## key를 지우기 전에

- **template literal로 만드는 key가 있다.** ``t(`secret-input.title.${purpose}`)``나 ``t(`project-workspace.label.sidebar-tab-${key}`)`` 같은 호출은 key 전체 문자열이 코드에 없다. key 전체로 grep해 "쓰는 곳 없음"으로 보고 지우면 안 된다(실제로 `common.label.tab-${dot}` 류를 지운 적이 있다).
- 지우기 전에 key의 **앞부분**(`secret-input.title.`)으로 `packages`와 `tools`를 grep한다(catalog와 `.placeholders.ts` 제외). template 호출이 보이면 그 union의 모든 값에 대응하는 key를 남긴다.
- check-wording은 `t("...")`의 문자열 literal만 확인한다. template 호출이 깨졌는지는 type check(`deno task check`)가 잡는다. 지운 뒤 이 둘을 모두 돌린다.
- key 이름을 바꿀 때도 같다. 앞부분 grep으로 쓰는 곳을 다 찾아 바꾼다.

## 검사 범위 (함정)

- check-wording은 `packages/shell/renderer`, `packages/sdk`, `packages/design/components`의 `.tsx`만 훑는다. `.ts` file과 `tools/wireframes`의 직접 문구는 못 잡으니 스스로 key로 쓴다.
- 테스트 fixture(`_test.tsx`)의 문구는 검사하지 않는다.
- wording catalog는 병렬 작업에서 충돌이 몰리는 곳이다. 여러 worker가 나눠 일할 때 catalog는 한 worker에게만 맡긴다.
