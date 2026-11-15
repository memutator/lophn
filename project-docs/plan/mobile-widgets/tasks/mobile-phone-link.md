# mobile-phone-link

**opus high.** core에서 폰으로 가는 요청 길을 짓는다. `request`/`response` frame을 remote channel의 frame 목록에 넣고, core 서비스 `PhoneLink`가 기기의 열린 연결을 찾아 `request`를 보내고 같은 `id`의 `response`나 deadline이나 연결 닫힘을 기다린다. 폰은 자기가 답하는 kind를 `hello.capabilities`에 적고, core는 거기 없는 kind를 묻지 않는다. 이 길은 일반이다: 첫 쓰임은 `location.get`이고 단계 10이 `drive.*`를 얹는다. 부르는 쪽(앱 route)은 `mobile-phone-use-grant`가 짓는다.

- 단위: phone-link (wave 8)
- 선행: mobile-phone-link-contract. **다음이 모두 main에 있은 뒤에 띄운다**(같은 `packages/core/remote`·`wiring/remote.ts`·frame file을 고친다): `mobile-app` 계획(land), `mobile-user-apps`의 `mobile-remote-gate`, `mobile-push`의 `mobile-push-device`, `mobile-coding-agents`의 `mobile-terminal-device-grant`(곧 세 계획의 land)
- 소유(이 task만 고친다):
  - `packages/protocol/remote/frames.ts`
  - `packages/core/remote/phone-link.ts`(새 file)
  - `packages/core/remote/phone-link_test.ts`(새 file)
  - `packages/core/remote/host.ts`
  - `packages/core/remote/mod.ts`
  - `packages/core/main/daemon/wiring/remote.ts`
- 한 줄씩 허락(공유 file. 한 줄만 더하고 보고의 "넘길 줄"에 적는다): `packages/core/main/daemon/wiring/context.ts`(늦게 채우는 칸 `phoneLink`와 `LATE_KEYS`)
- 읽을 것:
  - 계약: `packages/protocol/phone/{link,kinds}.ts`(`mobile-phone-link-contract`), 계획 `README.md`의 "정한 것"
  - 지금 연결: `packages/core/remote/host.ts`(`Connection`, `serve`, `attach`가 frame을 받는 함수, 모르는 frame이면 닫기, `revoked`, `shutdown`), `packages/protocol/remote/channel.ts`(`channel.peer.capabilities`가 폰의 `hello.capabilities`다), `packages/core/remote/host_test.ts`(메모리 전송으로 폰 하나를 붙이는 꼴), `packages/core/main/daemon/wiring/remote.ts`(host를 `reconcile`에서 늦게 만든다, `devicesOf`, `devicesList` 읽기의 `primary`)
  - 같은 생각의 desktop 쪽: `packages/protocol/host-link/frames.ts`(`request`/`response`의 id 꼴과 이름. 공유하지 않고 이름만 맞춘다)
  - 조사 `/home/pyosechang/projects/lophn/reports/mobile-program/widgets-survey.md`의 2.3("One request/answer path")과 5의 2
- 계약:
  - 쓰는 것: `phoneRequestFrameSchema`, `phoneResponseFrameSchema`, `phoneUnavailableReasonSchema`
  - 내놓는 것:
    - `remoteServerFrameSchema`에 `request`, `remoteClientFrameSchema`에 `response`. `REMOTE_PROTOCOL_VERSION`은 그대로(core는 적힌 kind만 묻는다)
    - `packages/core/remote/phone-link.ts`: `createPhoneLink({timers, random})` → `PhoneLink`:
      - `call({device, kind, input, deadline_ms}): Promise<Result<unknown>>`. 그 기기로 붙은 연결이 없으면 `unavailable`(`phone_unreachable`), 여럿이면 마지막에 붙은 것. 그 연결의 `hello.capabilities`에 `kind`가 없으면 `unavailable`(`unsupported`)이고 보내지 않는다. 보낸 뒤 같은 연결에서 온 같은 `id`의 `response`면 `ok:true`는 `ok(value)`, `ok:false`는 그 `error`를 그대로(code 일곱 가운데 하나, `details` 유지). deadline이 지나면 `unavailable`(`timeout`), 기다리는 사이 연결이 닫히면 `unavailable`(`phone_unreachable`)
      - 모르는 `id`, 다른 연결(다른 기기)에서 온 같은 `id`, deadline 뒤에 온 답은 버린다(연결을 닫지 않는다)
      - `value`를 kind의 output schema로 검사하지 않는다(부르는 쪽이 한다. link는 kind를 모른다)
    - host는 `Connection`에 `capabilities`를 두고, 붙은 연결의 `response` frame을 link로 넘기고, 연결이 닫히면 link에 알린다
    - wiring 칸 `phoneLink: {call: PhoneLink["call"]; primary(): Promise<Result<string | null>>}`. `primary()`는 기기 표의 `primary` 기기 id(없으면 null). remote가 꺼져 있으면 `call`은 `unavailable`(`phone_unreachable`)

## 할 일

1. `frames.ts`의 두 union에 계약의 frame을 넣는다. 폰 앱이 같은 file을 Metro로 읽으므로(`packages/protocol/remote/client.ts`) 폰의 frame parse가 `request`를 받아도 깨지지 않는지 본다(폰이 `request`를 다루는 것은 `mobile-phone-location`. 그 전까지 core는 폰에 묻지 않는다: 폰이 아직 kind를 적지 않는다).
2. `phone-link.ts`(pending 표 `id → {connection, resolve, timer}`, id는 `random`으로 `prq_` 꼴). Clock·random·timer는 인자로 받는다(AGENTS.md "코드").
3. `host.ts`: `Connection.capabilities`, `attach`가 돌려주는 frame 함수에 `response` 갈래, `onClose`에서 link에 닫힘을 알린다. `mod.ts` 내보내기.
4. `wiring/remote.ts`: build에서 link를 만들어 `ctx.phoneLink`를 채우고 `createRemoteHost`에 넘긴다(host는 지금처럼 `reconcile`에서 늦게 만든다). `primary()`는 `devicesList` 읽기로.
5. `phone-link_test.ts`: `host_test.ts`의 메모리 전송 꼴로 폰 둘을 붙여 위험 test(아래)를 쓴다.

## 끝남

- `npm run check`가 통과한다.
- 위험 test: "요청은 지정한 기기의 연결로만 가고, 그 기기가 `hello.capabilities`에 적지 않은 kind는 보내지 않으며, 모르는 `id`·다른 기기·deadline 뒤의 `response`는 버리고, 기다리는 사이 연결이 닫히면 `unavailable`(`phone_unreachable`)로 끝난다"(`phone-link_test.ts`. 한 기기의 답이 다른 기기에 묻은 요청을 채우지 못하게 하는 경계다)
- 남지 않음: 없음(더하기만)

- flows catalog: 이 task가 더하거나 지우는 test file과 protocol 입구의 줄은 이 task가 project-docs/flows 에서 고친다(자기 줄만. 꼴은 `.claude/skills/flows/SKILL.md`). `node tools/flows.ts check`가 통과해야 한다.

## 보고

`.claude/skills/orchestrate/brief-template.md`의 "보고" 꼴. 더해서: `PhoneLink`와 wiring 칸의 type, 위험 test의 test 이름, 넘길 줄(`context.ts`).
