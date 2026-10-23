# agent-definition

agent 정의와 turn 조립(지침, tool, skill, place 정보, cache)에 걸린 열린 이슈. 흐름과 불변 조건은 `project-docs/architecture/agent-definition.md`.

## 파일 읽기가 pdf와 이미지 말고 docx 같은 형식을 못 읽는다

```yaml
kind: bug
modules: [packages/core/lophn-agent]
```

지금: `packages/core/lophn-agent/tools/file/read.ts`는 UTF-8 텍스트만 읽고, 아니면 pdf/이미지는 각 tool을 안내하고 나머지는 `not a UTF-8 text file`로 거절한다. pdf는 `packages/core/lophn-agent/tools/file/pdf.ts`(`unpdf`), 이미지는 `packages/core/lophn-agent/tools/file/image.ts`뿐이다. docx, xlsx 등의 reader는 없다.

영향: 사람이 place 폴더에 둔 docx 문서를 agent가 읽지 못한다. 사람이 텍스트로 바꿔 줘야 한다.

고치려면: 필요한 형식마다 reader를 더한다(`unpdf`처럼 의존성 하나를 판 고정으로 들이고 쓸 때만 불러온다). 형식을 하나씩 늘리는 것은 비용이 작지만 의존성이 는다. 추천: 쓰는 형식(docx)부터 하나만.

정한 것: 필요해지는 형식 하나씩만 더한다.

## MCP OAuth server는 사람이 만들 수도 sign-in할 수도 없다

```yaml
kind: bug
modules: [packages/core/lophn-agent, packages/shell/renderer, packages/protocol]
```

지금:
- 설정 schema(`packages/protocol/lophn-agent/mcp-settings.ts`의 `layerAuthSchema`)는 `oauth2`(`issuer`, `client_id`, `client_credential`, `scopes`)를 받지만 server form(`packages/shell/renderer/workspace/agents/editor/server-form.tsx`)의 인증 선택은 `none`·`bearer`·`api_key`뿐이다.
- core에 `agent-mcp-auth/begin|complete|state|cancel` route가 있고 shell allowlist에도 있지만 화면은 `state`만 부른다(`packages/shell/renderer/desktop/settings/extension-settings.ts`의 `authStates`). sign-in을 여는 단추가 없어 oauth2 server는 늘 `needs-sign-in`이다.
- 끝점은 discovery 없이 `${issuer}/authorize`·`${issuer}/token`으로 만든다(`packages/core/lophn-agent/extensions/mcp-oauth.ts`의 `begin`). dynamic client registration도 없어 사람이 미리 만든 client id만 쓴다.
- `client_credential`은 schema에만 있고 읽는 곳이 없다. `mcp-auth-control.ts`의 `oauthServerOf`가 넘기지 않아 token 교환과 refresh는 client secret 없이 간다.

영향: 사람은 OAuth가 필요한 MCP server(대부분의 hosted MCP)를 쓸 수 없다. 설정 file을 손으로 써도 sign-in할 길이 없고, 끝점이 `/authorize`·`/token`이 아니거나 client secret이 필요한 발급자는 sign-in해도 교환이 실패한다.

고치려면:
- 작음~중간(추천): 앱 OAuth가 연 인자(`endpoints`, `clientSecret`)를 MCP도 쓴다. `oauthServerOf`가 `client_credential`을 읽어 `clientSecret`으로 넘기고, server form에 `oauth2`와 [Sign in](앱 Access 탭과 같은 begin → OS browser → 상태 폴링 꼴)을 둔다. discovery(`/.well-known/oauth-authorization-server`)는 `endpoints`를 채우는 한 단계로 더한다.
- 중간: dynamic client registration까지 한다. 등록 결과(client id, secret)를 둘 secret 이름 공간과 등록 끝점 호출(발급자 호출 대기열)이 더 필요하다.
