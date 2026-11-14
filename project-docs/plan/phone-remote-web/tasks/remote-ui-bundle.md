# remote-ui-bundle

core가 remote 화면 bundle을 hash와 함께 기기에 내주게 한다.

- 단위: remote (wave 3)
- 선행: remote-web-base.
- 소유(이 task만 고친다):
  - `packages/core/remote/ui-bundle.ts`(새 file)와 그 test
  - `packages/protocol/remote/{routes,allowlist}.ts`
  - `packages/core/main/daemon/wiring/remote.ts`
  - `tools/package/main.ts`, `tools/dev.ts`
  - `project-docs/flows/`의 route 항목
- 읽을 것:
  - 계획 README "정한 것"
  - `packages/core/apps/screens/serve.ts`(폴더 밖을 막는 법, content type 표), `packages/core/agent-workspaces/skills/root.ts`(자기 source 기준으로 내장 file 찾기)
  - architecture: `project-docs/architecture/platform.md`의 "설치 묶음"
- 계약:
  - 쓰는 것: `dist/remote/`, file route의 base64 답
  - 내놓는 것: route `remote_ui/manifest`(`{hash, files: [{path, hash, size}]}`)와 `remote_ui/file`(`{path}`, file route). actor user, 기기 목록에 든다

## 할 일

1. bundle 자리: 설치본은 `platform/` 아래 폴더, 개발은 `packages/shell/renderer/dist/remote`. core가 자기 source 기준으로 찾는다. `tools/package/main.ts`가 `dist/remote`를 그 자리에 복사한다.
2. `remote_ui/manifest`: file마다 sha256과 크기, 전체 hash(path와 file hash를 정렬해 hash)를 돌려준다. 기동 뒤 한 번 계산해 둔다. bundle이 없으면 `unavailable`이다.
3. `remote_ui/file`: `serve.ts`처럼 realpath로 폴더 밖과 symlink를 막는다. content type은 같은 표를 쓴다.
4. 둘을 `REMOTE_ALLOWED_ROUTES`에 넣는다. 새 route에 `changes`/`reads`를 맞게 적는다.

## 끝남

- `npm run check`가 통과한다.
- 위험 test: "`remote_ui/file`은 bundle 폴더 밖의 file을 내주지 않는다"
- `tools/remote-client.ts`로 manifest를 읽고 file 하나를 받아 hash가 맞는다(보고에 적는다).

## 보고

`.claude/skills/orchestrate/brief-template.md`의 "보고" 꼴.

## 추가 (lead가 더함)

- 위험 test는 `..`, 절대 path, URL로 감싼 `%2e%2e`, bundle 밖을 가리키는 symlink, 폴더 자체, 없는 file을 다 본다. 앞의 넷은 bundle 밖 file 내용이 답에 들지 않아야 한다.
- 개발 bridge(`packages/shell/renderer/remote/dev/bridge.ts`)의 file 답은 `{content_type, base64}`를 `{bytes, contentType}`로 바꾼다. 같은 꼴을 쓴다.
