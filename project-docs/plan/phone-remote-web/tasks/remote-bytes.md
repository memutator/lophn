# remote-bytes

기기가 부를 수 있는 route를 대화 화면이 쓰는 만큼 넓히고, file·upload route를 base64로 실어 나르고, 폰이 import할 좁은 protocol 입구를 낸다.

- 단위: remote (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/protocol/remote/{allowlist,mod}.ts`, `packages/protocol/remote/client.ts`(새 file), `packages/protocol/package.json`
  - `packages/core/remote/{call.ts,host.ts,host_test.ts}`
  - `tools/remote-client.ts`
  - `project-docs/flows/`의 해당 항목
- 읽을 것:
  - 계획 README "정한 것"
  - `packages/shell/renderer/conversation/agent-tab-core-source*.ts`(대화 화면이 부르는 route), `packages/shell/renderer/shell/use-left-sidebar.ts`
  - architecture: `project-docs/architecture/approval.md`의 기기 자격
- 계약:
  - 쓰는 것: `REMOTE_ALLOWED_ROUTES`, `call` frame
  - 내놓는 것: 넓힌 route 목록, file route의 답 `{content_type, base64}`, upload route의 body `{input, base64}`, `@lophn/protocol/remote/client`(channel, frame, noise만 내놓는 입구)

## 할 일

1. README의 route를 실제 route 정의로 찾아 `REMOTE_ALLOWED_ROUTES`에 더한다. `sessions/delete`, secret, provider 쓰기, 설정 쓰기, `devices/*`, `pairing/*`, `host/*`는 넣지 않는다.
2. `call.ts`: file route의 답(bytes와 content type)을 `{content_type, base64}`로 바꿔 돌려준다. upload route는 body의 `base64`를 bytes로 바꿔 지금 upload 길로 넘긴다. 크기 한도는 그 route의 한도를 그대로 쓴다.
3. `message-images/read`와 `message-images/upload`를 목록에 넣는다.
4. `client.ts`: `connectRemote`, frame type, key 함수만 다시 내놓는다. route 정의나 다른 protocol 영역을 끌고 오지 않는다(폰 bundle에 protocol 전체가 들지 않게).
5. `tools/remote-client.ts`에 file route 하나를 받아 저장하는 명령을 더한다.

## 끝남

- `npm run check`가 통과한다.
- 위험 test: "넓힌 뒤에도 `sessions/delete`와 secret·provider·설정 쓰기·`devices/*`·`pairing/*`는 `forbidden`이다"
- `packages/protocol/remote/client.ts`의 import graph에 `packages/protocol/remote/{routes,allowlist}.ts`가 없다.

## 보고

`.claude/skills/orchestrate/brief-template.md`의 "보고" 꼴. 넣은 route와 뺀 route, 이유를 "정한 것"에 적는다.
