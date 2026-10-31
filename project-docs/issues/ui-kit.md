# ui-kit

`packages/design`의 kit component(앱 화면, 세션 시각 블록, artifact가 쓰는 것). `project-docs/architecture/ui-kit.md`.

## `package.read @lophn/ui`가 guide를 통째로 버려서 kit를 아는 길이 없다

```yaml
kind: bug
modules: [packages/core/apps, packages/design]
```

지금: 내장 SDK guide는 `packages/core/apps/packages/builtin.ts`의 `guideOf`가 설치 사본의 분류 `mod.ts`에서 만든다. `@lophn/ui`는 지금 42,356 byte(1.1.0), 42,217 byte(1.0.0)다. route 상한(`GUIDE_MAX_BYTES`, 256 KiB)은 넘지 않는다.

그런데 `packages/core/apps/agent-tools/package.ts`의 `cutBytes`가 본문을 `TEXT_MAX_BYTES`(24 KiB, `packages/core/lophn-agent/tools/result.ts`)에서 자른다. 그 결과를 `fitted(...)`가 배열 키 없이 부르므로 `fitJson`이 덜어 낼 배열이 없어 `content`를 `null`로 만든다. 실제로 부르면 `status: success`, `summary: package @lophn/ui@1.1.0`, `complete: false`, `content: null`이다. 잘린 본문도 남지 않는다. 컷 지점(17,853자)에서 이미 `navigation`, `overlay`, `primitives`, `reading` 네 분류가 사라진 뒤다.

영향: agent가 `@lophn/ui` guide를 한 번도 받지 못한다. 앱을 만드는 session은 이 경로를 아예 부르지 않고 앱 폴더의 `.lophn/sdk/ui/<판>/**`를 `file.read`와 `shell.run`으로 직접 읽었다(한 session에서 21회, 50,874자, 그중 kit 10회). 그 파일들은 앱 폴더 안 사본이라 release마다 판이 다르고, 분류 `mod.ts`의 "언제 쓰나" 줄과 props 정의를 손으로 조립해야 한다. 같은 정보를 매번 원문에서 긁으므로 입력 token과 turn 시간이 는다. 분류 `mod.ts` 밖의 표(`_shared`, `generated/tokens.css`)는 guide가 원래 담지 않으므로 이 경로로는 여전히 알 수 없다.

고치려면:
- 작음(추천): `packages.guide_body`가 이미 `offset_bytes`·`length_bytes`로 창을 준다(`packages/core/main/daemon/wiring/apps.ts`). `package.read`가 `file.read`처럼 `continuation`을 싣고 창을 나눠 받게 하고, `cutBytes`를 지운다. `tool_result`에 `guide_truncated`만 남기지 말고 다음 창의 `offset_bytes`를 준다.
- 작음: guide를 "색인"과 "props" 두 요청으로 나눈다. 색인은 `- 이름: 언제 쓰나` 줄만(지금 13,434 byte)이고 props는 분류 단위로 받는다. 상한 안에 들어간다.
- 추천: 앞의 것. 창 나누기는 tool 결과 상한을 이미 다루는 길이고, 나누기 방식은 agent가 한 번 더 부르는 비용이 든다.

## kit guide에 props가 붙어서 본문이 상한을 넘고, 넘을 때 버려지는 쪽이 본문 전체다

```yaml
kind: defect
modules: [packages/design, packages/core/apps]
```

지금: `@lophn/ui`의 guide는 `builtin.ts`의 `indexOfCategory`가 `components/<분류>/mod.ts`마다 export 이름, "언제 쓰나" 한 줄, 같은 export 문이 내보내는 type의 정의를 component source에서 주석째 옮겨 만든다. 지금 분류별 이름·"언제 쓰나" 줄만 세면 13,434 byte이고, props 정의(ts code 블록)를 더하면 42,356 byte다. 상한에 닿으면 `limited`/`cutBytes`가 앞에서부터 자르므로 남는 것은 `data`, `feedback`, `input`, `layout` 네 분류다.

영향: 컴포넌트가 늘 때마다 잘리는 분류가 늘어나고, 잘린다는 사실은 `guide_truncated: true` 하나로만 보인다. agent는 `primitives`(Button, IconButton)와 `overlay`(Dialog, Popover, Menu) 없이 화면을 설계한다. 앱 화면에서 가장 많이 쓰는 분류 둘이 항상 먼저 사라진다. `mod.ts`의 분류 알파벳 순서가 잘림 순서를 정하므로 `reading`·`primitives`는 구조적으로 마지막이다.

고치려면:
- 작음(추천): 위의 창 나누기를 먼저 넣고, guide 생성에서 props 정의를 `max_bytes` 예산 안에서만 붙인다(분류마다 균등 배분). 예산 밖 props는 그 분류의 이름 줄만 남기고 요청 시 받게 한다.
- 작음: props 정의를 guide에서 빼고 `components/<분류>/mod.ts`의 export 문과 "언제 쓰나" 줄만 남긴다. 13 KiB로 돌아가지만 agent가 props를 모른다.
- 추천: 앞의 것. 잘림이 알파벳 순서를 따르지 않게 예산을 분류 단위로 나눈다.
