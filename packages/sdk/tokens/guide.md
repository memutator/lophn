# @lophn/tokens

## 목적

앱이 import하는 고정 token이다. 값의 정본은 packages/design이고 여기서는 다시
내보내기만 한다. 시각 스타일은 @lophn/tokens 및
shell/design-system을 따른다.

## 공개 API와 type

```ts
import { tokenNames, tokens, vars } from "@lophn/tokens";
```

- `tokens` — token 값 묶음이다.
- `vars` — CSS 변수 이름 묶음이다.
- `tokenNames()` — token 이름 목록이다.
- type: `Tokens`, `TokenVars`, `TokenName`, `Theme`, `Themed`, `StatusTone`,
  `Breakpoint`, `SpaceStep`
- CSS: `@lophn/tokens/tokens.css`, `@lophn/tokens/base.css`

## 요구 permission

없다. token 값은 정적이다.

## peer 의존

정확한 peer는 없다(단독 사용).

## 예제

```ts
import { tokens, vars } from "@lophn/tokens";

const space = tokens.space[4];
const color = vars["--color-accent"];
```

## version 정책

- **patch**: API·동작을 유지한 내부 수정·문서·예제 개선이다.
- **minor**: 기존 API를 유지한 token·CSS 변수 추가다.
- **major**: API·token 값의 제거나 변경이다. 요구 permission의 증가도 major다.
