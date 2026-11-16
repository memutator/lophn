# update-viewer

판이 맞지 않는 기기 연결이 누가 올려야 하는지 말하게 한다. remote protocol 판이 범위 밖이면 core도 자기 hello를 보낸 뒤 닫아, 붙는 쪽이 어느 쪽이 낡았는지 안다. `connectRemote`의 `conflict`가 `details.update`로 "이쪽을 올려라"와 "상대를 올려라"를 가른다. 폰은 그 컴퓨터를 offline이 아니라 "Update this app" 또는 "Update lophn on <이름>"으로 보인다.

- 단위: viewer (wave 1)
- 선행: 없음. `machine-identity`(hello 판 범위)와 `app-folder-sync`가 main에 land된 뒤다. `desktop-remote`가 연결 code를 공용 package로 옮겼으면 lead가 아래 `packages/mobile/src/connection/` path를 그 package의 path로 맞춘다
- 소유(이 task만 고친다):
  - `packages/protocol/remote/channel.ts`
  - `packages/protocol/remote/channel_test.ts`
  - `packages/mobile/src/connection/connection.ts`
  - `packages/mobile/src/connection/connection.test.ts`
  - `packages/mobile/src/data/computers.ts`
  - `packages/mobile/src/data/link.ts`
  - `packages/mobile/src/parts/offline.tsx`
- 공유 줄 허락(key만 더한다): `packages/design/i18n/catalog/machine-update.ts`(key는 `machine-update.viewer.*`)
- 읽을 것:
  - 계획 `README.md`의 "정한 것"(범위로 본다, 범위 밖이면 core도 hello를 보내고 닫는다), "계약 바꾸기 요청"(machine-identity), "다른 계획이 기대는 계약"의 연결 오류
  - `project-docs/plan/machine-identity/README.md` "다른 계획이 기대는 계약" 2(hello, 판 범위, `connectRemote`·`acceptRemote`, `RemotePeer`)와 `tasks/machine-hello.md`
  - 지금 코드: `channel.ts`의 `open`(initiator가 hello를 먼저 보내고 responder가 판을 본 뒤 답한다. 지금은 판이 틀리면 responder가 답하지 않고 닫는다), `connection.ts`의 `ConnectionState`와 다시 붙기, `data/computers.ts`의 `ComputerStatus`·`LinkState`, `data/link.ts`의 `STATUS`, `parts/offline.tsx`의 `OfflineBanner`·`useLocked`·`useUnreachable`
  - 비교: `/home/pyosechang/projects/harness-lab/_report/multi-device/comparison.md` 13.1(Orca `client-too-old`/`server-too-old`, Emdash `upgrade-client|upgrade-server`)
  - `packages/mobile/README.md`(test와 typecheck, 개발 core와 pairing)
- 계약:
  - 쓰는 것: machine-identity의 hello 두 꼴과 `REMOTE_PROTOCOL_VERSION`·`REMOTE_PROTOCOL_MIN_VERSION`
  - 내놓는 것(`desktop-remote`가 기댄다): 판이 범위 밖이면 양쪽 channel 결과가 `err({ code: "conflict", message, details: { update: "this" | "peer", peer_version: number, peer_min_version: number } })`. `update`는 "이 판을 올려야 한다"(`this`: 상대의 `min_version`이 내 `version`보다 높다)와 "상대를 올려야 한다"(`peer`: 상대의 `version`이 내 `min_version`보다 낮다)다. 폰의 `ComputerStatus`에 `"update"`, `LinkState`에 `update: "phone" | "computer" | null`.

## 할 일

1. `channel.ts`: responder는 initiator의 hello가 범위 밖이어도 자기 hello를 보낸 뒤 닫는다(hello 말고 다른 frame은 보내지 않는다). 판정은 두 방향을 다 본다. 닫는 쪽 결과의 `details`가 위 계약이다. initiator는 responder의 hello를 받고 같은 판정을 한다. machine-identity의 `machine-hello`가 이미 이렇게 했으면 `details`만 맞춘다.
2. `channel_test.ts`: machine-hello의 "판이 범위 밖이면 양쪽 다 `conflict`로 닫힌다" test에 `details.update`가 양쪽에서 맞게 나오는지를 표로 더한다(client가 낡음, core가 낡음). 새 test는 만들지 않는다.
3. 폰 연결(`connection.ts`): channel이 `conflict`와 `details.update`로 끝나면 상태에 `update: "phone" | "computer"`를 싣는다(`this`면 phone, `peer`면 computer). 다시 붙기는 지금 간격을 따르되 판이 맞을 때까지 상태를 그대로 둔다(한쪽을 올리면 다음 시도에 붙는다). 붙으면 지운다.
4. `computers.ts`·`link.ts`: `ComputerStatus`에 `"update"`, `LinkState`에 `update`. 범위 밖이면 status가 `"update"`다.
5. `offline.tsx`: status가 `"update"`이면 Banner의 제목이 `update`에 따라 "Update the lophn app on this phone to reach {name}." 또는 "{name} runs an older lophn. Update lophn on {name} to reach it from this phone."이고 Retry 단추는 둔다. `useLocked`는 그대로(잠근다), `useUnreachable`도 같은 글을 쓴다. 글은 `machine-update.viewer.*` key로 둔다.
6. 개발 core에서 본다(`packages/mobile/README.md`의 `tools/remote-dev.ts` 길, emulator 없이 `tools/remote-client.ts`로도 된다): `REMOTE_PROTOCOL_MIN_VERSION`을 손으로 하나 올린 core와 그대로인 client로 붙어 client의 오류가 `update: "this"`인지 본다. 손으로 바꾼 것은 되돌린다. 사람의 실제 폰에는 어떤 명령도 보내지 않는다.

## 끝남

- `npm run check`가 통과하고 `cd packages/mobile && npm ci && npm run typecheck && npm test`가 통과한다(`packages/mobile`은 root workspace 밖이다).
- 위험 test: 없음(위 2는 있던 test의 표를 넓힌다).
- 남지 않음: 없음.
- flows catalog: `remote-connection`의 판 범위 밖 outcome(`details.update`)과 폰의 "update" 상태 줄을 project-docs/flows 에서 고친다(자기 줄만. 꼴은 .claude/skills/flows/SKILL.md). `node tools/flows.ts check`가 통과해야 한다.

## 보고

`.claude/skills/orchestrate/brief-template.md`의 "보고" 꼴. 더해서: 6에서 본 오류 JSON, `desktop-remote`가 같은 글을 보일 곳(그 계획이 land됐으면 그 path).
