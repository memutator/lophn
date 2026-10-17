# call-frames-rewind

rewind apply 본문(뒤집은 changeset 전부)을 core에서 앱 supervisor로 보낼 때 control frame(256 KiB) 하나에 담지 않고 bytes frame stream으로 보낸다. 지금은 여러 write를 한꺼번에 되돌리면 `encodeFrame`이 `control frame exceeds limit`로 던져 rewind 적용이 통째로 실패한다. write 하나씩 나누지 않는다(중간 실패 때 일부만 되돌린 상태가 된다).

- 단위: call-frames (wave 1)
- 선행: approval-reads. 둘 다 `main/daemon/wiring/apps.ts`를 고친다(이 task는 `channel.bind` block만).
- 소유(이 task만 고친다):
  - `packages/core/apps/runtime/supervisor-link.ts`
  - `packages/core/apps/runtime/supervisor-link_test.ts`
  - `packages/core/apps/runtime/control-protocol.ts`
  - `packages/core/apps/runtime/supervisor/control-link.ts`
  - `packages/core/main/app-supervisor/assembly.ts`
  - `packages/core/main/daemon/wiring/apps.ts`
- 겹침:
  - `main/daemon/wiring/apps.ts`: `appsControl.channel.bind(...)` block(`start()` 안, `appsSupervision.start` 성공 뒤) 한 곳만 고친다. 같은 계획의 `crash-log`와 `approval-reads`가 이 file을 소유 목록에 두고, `sdk-install`도 core 기동 조립에서 고칠 수 있다. 서로 다른 block이라 합치기는 쉽지만 소유가 겹치므로 `status.py`는 이 task와 그 task들을 동시에 띄우지 않는다. lead가 순서를 정한다.
  - `main/app-supervisor/main.ts`는 `crash-log`가 고친다. 이 task는 건드리지 않는다. `attachControlLink`를 부르는 모양(`send`, `ops`, `onHello`, `onCredential`)을 바꾸지 않아 main.ts는 그대로 돈다.
  - `apps/runtime/entrypoint/limits.ts`는 `call-frames-result`가 고친다. 이 task는 `APPLY_BODY_MAX_BYTES`를 읽기만 한다.
  - `apps/rewind/run.ts`와 `apps/ports.ts`(`AppProcessLink.apply(app, ProcessApplyRequest)`)는 고치지 않는다. 호출하는 쪽 모양을 그대로 두므로 `apps/rewind/rewind_test.ts`도 그대로다. 본문을 frame으로 쪼개는 일은 link(`createAppProcessLink`) 안에서 끝난다.
  - `apps/runtime/supervisor/relay.ts`, `entrypoint/apply.ts`, `protocol/apps/calls/process-wire.ts`도 고치지 않는다(supervisor와 앱 process 사이는 HTTP body이고 한도 64 MiB다).
  - `apps/calls/calls_test.ts`는 `test-wait`가 고친다. 건드리지 않는다. 다른 계획의 자리(`apps/agent-tools/`, lophn-agent)는 건드리지 않는다.
- 읽을 것:
  - 이슈: `project-docs/issues/app-call.md`의 "rewind 적용 요청이 control frame 256KiB를 넘을 수 있다"
  - architecture: `project-docs/architecture/app-call.md`("rewind는 접수를 닫고 ...", "changeset은 최신부터 뒤집어 한 transaction으로 적용하고 충돌하면 통째로 취소한다")
  - 계획 `project-docs/plan/app-platform/README.md`의 "정한 것" 4
  - boundary: `project-docs/boundary-catalog.yaml`의 `child-supervision-protocol`, `apps`와 자식, `project-docs/module-catalog.yaml`
  - 이미 bytes frame stream을 쓰는 길(그 꼴을 따른다): `packages/core/storage/blobs/prepare-relay.ts`(core가 worker로 byte를 보낸다: `worker_request`에 `channel`을 실어 json 요청을 먼저 보내고, 그 channel로 `bytes` frame들을 보내고, `end`나 `abort`로 닫고, 결과는 `worker_response`로 받는다), `packages/core/storage/blobs/child-prepare.ts`(받는 쪽이 channel별로 모은다), `packages/core/main/daemon/wiring/storage.ts`(`io.sendBytes/sendEnd/sendAbort`를 `send`와 같이 끼우는 곳), `packages/protocol/supervision/supervision.ts`의 `workerRequestEnvelopeSchema`(`channel` 칸이 이미 있다)
  - frame: `packages/protocol/base/frame.ts`(`STREAM_CHUNK_MAX_BYTES` 1 MiB, `CONTROL_MAX_BYTES`), `packages/core/supervision/responsiveness/supervisor.ts`의 `Supervisor.sendBytes/sendEnd/sendAbort`
- 계약:
  - 쓰는 것: `worker_request` envelope(`protocol/supervision`), `FrameDecoder`·`encodeFrame`(`protocol/base`), `processApplyRequestSchema`·`processApplyResponseSchema`(`protocol/apps/calls`). 이 셋은 바꾸지 않는다.
  - 내놓는 것(control protocol의 `apps.apply` 모양. 쓰는 쪽 core와 받는 쪽 supervisor를 같은 변경에서 고친다):
    - core → supervisor 요청: json frame `{ type: "worker_request", request_id, op: "apps.apply", channel: N, payload: { app } }`. `N`은 1 이상 정수로, 그 pipe에서 진행 중인 apply끼리 겹치지 않게 core가 정한다. `payload`에는 더는 `request`(changeset 목록)가 없다. `control-protocol.ts`의 `applyInputSchema`는 `z.strictObject({ app: appId })`가 된다.
    - 본문: 같은 channel `N`의 `bytes` frame들. 이어 붙이면 `ProcessApplyRequest`(`{ changesets: base64[] }`)를 `JSON.stringify`한 UTF-8 byte와 같다. frame 하나는 `STREAM_CHUNK_MAX_BYTES` 이하다. 마지막에 `end` frame(channel `N`). core가 보내다 실패하면 `abort` frame을 보내고 그 요청을 `unavailable`로 끝낸다.
    - supervisor → core 응답: 그대로 `worker_response`(`request_id` 같음). payload는 `applyOutputSchema`(= `processApplyResponseSchema`) 그대로다. 오류 code도 지금처럼 `OpError`로 간다.
    - 흐름 제어: credit을 쓰지 않는다. core는 `bytes` frame을 하나 보내고 쓰기가 끝나기를 기다린 뒤 다음을 보낸다(`Supervisor.sendBytes`가 쓰기 끝에서 돌아온다). 이러면 frame writer의 backlog 한도(`WRITE_BACKLOG_MAX_*`)를 넘지 않는다. blob 준비 길이 credit을 쓰는 것은 받는 쪽이 느릴 수 있어서이고, 여기는 받는 쪽(supervisor)이 모으기만 한다.
    - `channel`이 없는 `apps.apply` 요청은 `invalid_input`이다(옛 모양을 읽는 길을 두지 않는다).
    - `SupervisorChannel`의 `bind`가 json만 보내는 함수 하나를 받던 것을, bytes·end·abort도 보내는 함수를 같이 받게 넓힌다(`wiring/apps.ts`가 `ctx.appsSupervision.sendBytes/sendEnd/sendAbort`를 `send`와 같이 끼운다). `SupervisorChannel.request`는 본문 byte를 선택 인자로 받아 channel을 정하고 위 순서로 보낸다. 이름과 정확한 type은 worker가 정한다. 보고에 적는다.

## 할 일

1. `runtime/control-protocol.ts`: `applyInputSchema`를 `{ app }`으로 줄이고 주석에 "본문은 같은 request의 bytes stream"을 적는다. 근거: 위 계약, README 정한 것 4.
2. `runtime/supervisor-link.ts`:
   - `SupervisorChannel`: `bind`가 bytes·end·abort 보내는 함수도 받게 하고, `request`가 선택으로 본문을 받아 json 요청 뒤에 `STREAM_CHUNK_MAX_BYTES` 단위 `bytes` frame들과 `end`를 순서대로 보낸다. channel 번호는 1부터 올리는 counter(`prepare-relay.ts`의 `nextChannel`처럼 진행 중인 것과 겹치지 않게). 보내다 실패하거나 응답을 기다리다 기한이 지나면 `abort`를 보내고 지금처럼 `details: { sent: true }`(일부라도 보냈을 때)로 `unavailable`을 돌려준다. 기한은 지금 `APPLY_REQUEST_TIMEOUT_MS`(전송 시간도 포함)를 그대로 쓴다.
   - `createAppProcessLink`의 `apply`: `JSON.stringify(request)`를 UTF-8로 만들어 본문으로 넘기고 payload는 `{ app }`만 담는다.
   근거: `child-supervision-protocol` 경계의 stream 규칙, `prepare-relay.ts`가 본보기.
3. `runtime/supervisor/control-link.ts`의 `attachControlLink`: 지금 `frame.kind !== "json"`이면 `continue`로 버린다. channel이 있는 `worker_request`는 바로 처리하지 않고 channel별로 본문 chunk를 모아 두었다가 `end`가 오면 그때 op 처리기를 부르게 한다. `abort`가 오면 그 channel의 모은 것을 버리고 답하지 않는다(core가 이미 포기했다). pipe가 끊기면 모은 것을 버린다. `OpHandlers`의 처리기는 `(payload, body?: Uint8Array)`가 된다(body는 stream이 있을 때만). 읽기 loop는 지금처럼 막지 않는다. 모으는 byte 수에 따로 상한을 두지 않는다(앱 process가 `APPLY_BODY_MAX_BYTES`로 거절한다. core는 신뢰한다).
4. `main/app-supervisor/assembly.ts`의 `SUPERVISOR_OPS.apply` 처리기: `parse(applyInputSchema, payload)`로 `app`을 읽고 `body`가 없으면 `OpError("invalid_input", ...)`, 있으면 UTF-8로 풀어 `JSON.parse` 후 `processApplyRequestSchema`로 검사해(실패는 `invalid_input`) 기존 `relay.apply(app, request)`를 부른다. relay와 앱 process 쪽은 그대로다.
5. `main/daemon/wiring/apps.ts`: `appsControl.channel.bind(...)`에 `ctx.appsSupervision.sendBytes/sendEnd/sendAbort`를 `send`와 같은 모양(`.then((sent) => sent.ok)`)으로 끼운다.
6. 위험 test 하나를 `runtime/supervisor-link_test.ts`에 쓴다(아래 "끝남"). 프로세스를 띄우지 않고 한 test 안에서 이어 붙인다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test: "frame 한도를 넘는 rewind 적용도 한 번에 되돌린다". `createSupervisorChannel`에 보내는 함수를 끼우되, 보내는 함수가 `encodeFrame`으로 실제 frame을 만들어(256 KiB를 넘는 control frame이면 여기서 던진다) 같은 test 안의 `attachControlLink`(가짜 supervisor 객체, hello 한 번, `apps.apply` op 처리기 하나)에 `FrameDecoder` 경로로 흘려 보낸다. 256 KiB를 훨씬 넘는 `{ changesets }`를 `createAppProcessLink(channel).apply`로 보냈을 때 (a) 처리기가 받은 body를 풀어 쓴 changeset 목록이 보낸 것과 같고 (b) 응답이 `applied`로 돌아온다. 요청 json 수만 아니라 처리기가 받은 byte로 판정한다. 앱 process, socket, 자식 process는 띄우지 않는다. 조금 길어도 이 test 하나로 끝낸다.
- 남지 않음:
  - `grep -rn "request: processApplyRequestSchema" packages/core/apps/runtime/control-protocol.ts`가 0줄이다.
  - `applyInputSchema`를 `request`와 함께 쓰는 곳이 없다: `grep -rn "applyInputSchema" packages tools --include=*.ts`에 `input.request`가 없다.
- 새 E2E·subprocess·서버 test는 쓰지 않는다. core를 띄워 손으로 확인하는 일도 하지 않는다. 확인은 unit test와 `deno task check`까지다.

## 지켜야 할 것(계획 README에서 그대로)

- module은 `core/main`을 import하지 않는다. 바닥은 위층을 import하지 않는다. domain끼리는 problems → apps만. (`assembly.ts`·`wiring/apps.ts`는 main이라 module을 import해도 된다. `supervisor-link.ts`·`control-link.ts`는 module 안이라 `main`을 import하지 않는다.)
- import를 지우려고 다른 module의 표를 SQL로 직접 읽지 않는다. 못 끊으면 `tools/check-deps.ts` 예외로 드러낸다.
- protocol을 바꾸면 쓰는 쪽을 같은 변경에서 고친다. `v2`나 옛 이름 읽기를 두지 않는다. (`apps.apply`에 payload로 `request`를 싣는 옛 모양을 같이 받는 길을 두지 않는다.)
- 설치 사본은 읽기 전용이고 release bundle에 굳힌 사본과 섞지 않는다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: 없음 예상(새 export가 `apps/runtime/mod.ts`나 `supervisor/mod.ts`에 필요하면 lead에게)
- 안 쓰게 된 export: `applyInputSchema`의 `request` 칸
- 정한 것: `SupervisorChannel.bind`/`request`의 새 type 이름과 모양, channel 번호 규칙, chunk 크기
- 넘길 줄: `wiring/apps.ts` 한 곳
- 계약 바꾸기 요청: `child-supervision-protocol`에 `apps.apply`의 stream 사용을 한 줄 적어야 하면 적는다(lead가 boundary-catalog·`architecture/app-call.md`를 plan 끝에 고친다)
- **무겁게 짠 것**: 없으면 "없음". 가장 단순한 쪽은 credit 없이 chunk를 하나씩 기다려 보내는 것이다.
- **알려진 미완 동작**: 호출 입력(`apps.call` payload의 `request.input`, `CALL_BODY_MAX_BYTES` 1 MiB)도 같은 control frame을 쓰므로 256 KiB를 넘는 입력은 같은 오류로 막힐 수 있다. 이 task 범위 밖이다. 코드로 따라간 결과만 적는다.

## (lead가 더함)

- 호출 입력 크기: `call-frames-result`가 `CALL_BODY_MAX_BYTES`(`apps/runtime/entrypoint/limits.ts`)를 control frame 한도 아래로 낮췄다. 그런데 core는 `apps.call`을 보내기 전에 입력 크기를 보지 않아, 큰 입력은 `encodeFrame`이 던져 "request could not be sent to the app supervisor"(`unavailable`)로 끝난다. 다시 해도 안 되는 일을 일시 장애처럼 알린다. `createAppProcessLink`의 `call`이 `JSON.stringify(request)`의 UTF-8 byte가 `CALL_BODY_MAX_BYTES`를 넘으면 보내지 않고 `{ sent: false, error: { code: "invalid_input", message: "call body exceeds the size limit" } }`를 돌려주게 한다(몇 줄). test는 따로 쓰지 않는다. 보고의 "알려진 미완 동작"에서 입력 문장은 이것으로 닫는다.
- 받는 쪽 `control-link.ts`의 끝나지 않은 channel(`end`·`abort` 없이 pipe가 살아 있는 것)은 따로 치우지 않는다. core가 기한에 `abort`를 보낸다.
