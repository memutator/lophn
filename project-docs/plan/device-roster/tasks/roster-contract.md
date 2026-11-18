# roster-contract

내 기기 명단의 protocol을 고정한다: 항목·빼기·초대장의 schema와 서명, 믿음과 합치기를 계산하는 순수 함수와 그 위험 test, 새 frame(`join`, `roster`), route 모양(`roster/*`, `machines/*`), 다른 기계의 event를 싣는 bus event, protocol 판. `architecture/remote.md`에 명단 절 초안을 쓴다. 구현(core, client, 화면)은 하지 않는다.

- 단위: roster (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/protocol/remote/roster.ts`(새 file), `packages/protocol/remote/roster_test.ts`(새 file)
  - `packages/protocol/remote/{frames.ts,routes.ts,channel.ts,client.ts}`
  - `packages/protocol/events/transient.ts`
  - `project-docs/architecture/remote.md`(명단 절만)
  - `project-docs/flows/tests/libs-tooling.yaml`
- 읽을 것:
  - 계획 README "정한 것" 전부와 "위험 test"
  - roadmap `project-docs/products/roadmap/multi-device.md` "어떻게 한 묶음이 되나", "길", "해도 되나"
  - 조사 `reports/multi-device/survey-s2-roster.md` 1.2~1.7, 4, 5.1(지금 pairing과 frame), `reports/multi-device/device-enrollment-survey.md`(본보기가 없다는 것)
  - architecture: `project-docs/architecture/remote.md`(지키는 것 19~21, 결정), `machine.md`(표지 규칙), `approval.md` "폰(기기) 자격"
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `remote-protocol`, `project-docs/module-catalog.yaml`의 `packages/remote-client` notes(폰이 Metro로 protocol을 읽는다)
  - 지금 code: `packages/protocol/remote/{frames,routes,channel,noise,client}.ts`, `packages/base/canonical-json.ts`
- 계약:
  - 쓰는 것: `@noble/curves/ed25519.js`(이미 `packages/protocol`과 `packages/mobile`이 2.4.0으로 고정해 든다. 새 의존성이 없다), `canonicalize`(`packages/base`), `keyTextSchema`, `remoteAddressesSchema`, `deviceNameSchema`, `machineIdSchema`, `atSchema`, `idSchema("dev")`, `eventConditionSchema`, `jsonValueSchema`
  - 내놓는 것: 아래 "모양". 뒤 task는 이 이름만 쓴다.

## 모양

file `packages/protocol/remote/roster.ts`. Node 내장 module과 Buffer를 쓰지 않는다(폰의 Hermes가 같은 code를 돈다. `noise.ts`와 같다). `frames.ts`가 `roster.ts`를 import하고 반대는 하지 않는다(ESM 순환이면 schema가 만들어지기 전에 읽힌다). 둘이 같이 쓰는 `keyTextSchema`·`remoteAddressesSchema`·`deviceNameSchema`는 `roster.ts`로 옮기고 `frames.ts`가 import해 지금 export 이름 그대로 낸다.

상수: `ROSTER_SIGN_CONTEXT = "lophn-roster/1"`, `ROSTER_INVITE_SHORT_MS = 1_800_000`(기본), `ROSTER_INVITE_LONG_MS = 604_800_000`(7일. 새 기기가 초대한 컴퓨터와 같이 켜질 수 없을 때 사람이 고른다: dual boot, 집과 직장), `ROSTER_STATEMENTS_MAX = 4096`, `ROSTER_JOIN_STATEMENTS_MAX = 8`, `ROSTER_JOIN_MAX_BYTES = 16 * 1024`(붙기 전 연결이 받는 frame 상한. core host가 `join`에 쓴다).

schema(모두 strict):
- `signatureTextSchema`: base64url 64 bytes(86자). `rosterKindSchema = z.enum(["computer", "phone"])`.
- `rosterEntryBodySchema`: `{type: "entry", id: dev_, kind, key: keyText(Noise static key. 컴퓨터는 host key, 폰은 기기 key), signing_key: keyText | null, machine: mch_ | null, name: deviceName, os: ios|android|linux|macos|windows, terminal_input: boolean, rev: int ≥ 1, invite: keyText | null}`. refine: computer면 `signing_key`·`machine`이 있고 os가 linux|macos|windows, phone이면 둘 다 null이고 os가 ios|android. `invite`는 그 기기가 들어온 초대 key다(컴퓨터가 스스로 만든 항목과 옮긴 항목은 null).
- `rosterRemovalBodySchema`: `{type: "removal", id: dev_, key: keyText, at}`.
- `rosterSignedStatementSchema`: `{body: entry | removal (body.type으로 가름), by: dev_, signature}`. `by`는 서명한 컴퓨터의 id다.
- `rosterInviteBodySchema`: `{type: "invite", key: keyText(한 번 쓸 ed25519 공개 key), by: dev_(초대한 컴퓨터), terminal_input: boolean, expires_at: at}`. `rosterInviteSchema = {body, signature}`(by의 서명 key로 서명).
- `rosterInvitedStatementSchema`: `{body: entry, invite: rosterInviteSchema, signature}`(초대 key로 서명). 새 기기가 초대장으로 스스로 서명한 자기 항목이다. 다른 statement처럼 명단에 실려 나르는 쪽(폰, 다른 컴퓨터)을 거쳐 간다.
- `rosterStatementSchema = rosterSignedStatementSchema | rosterInvitedStatementSchema`.
- `rosterReachSchema`: `{device: dev_, addresses: remoteAddressesSchema, port: 1..65535, relay: url | null}`. 서명하지 않는다(틀린 주소는 Noise가 key로 막아 못 닿을 뿐이다).
- `rosterSnapshotSchema`: `{statements: rosterStatement[] ≤ ROSTER_STATEMENTS_MAX, reach: rosterReach[] ≤ 256}`.
- `rosterInviteTextSchema`(QR과 CLI가 싣는 글의 JSON): `{invite, secret: keyText(한 번 쓸 key의 비밀 32 bytes), issuer: rosterSignedStatement(초대한 컴퓨터의 자기 서명 항목), reach: rosterReach}`.

서명: 서명하는 bytes는 `utf8(ROSTER_SIGN_CONTEXT + "\n" + canonicalize(body))`다. body의 `type`이 다르므로 항목·빼기·초대장 서명이 서로 바꿔 쓰이지 않는다. 서명 key는 Ed25519 하나다.

함수:
- `generateSigningKey(random: RandomSource): KeyPair`(ed25519, `generateKeyPair`와 같은 꼴)
- `signRoster(body, secretKey): string`, `verifyRoster(body, signature, signingKey: string): boolean`
- `mergeRoster(...lists: RosterStatement[][]): RosterStatement[]`: 합집합이다. 같은 statement(body·by·signature의 canonical bytes)는 하나다. 결과는 그 bytes 순서로 정렬해 어느 순서로 합쳐도 같은 배열이다.
- `rosterView(statements, roots: readonly string[]): RosterView`. `roots`는 믿음이 시작하는 컴퓨터의 key다(컴퓨터는 자기 host key 하나, 폰은 저장한 컴퓨터의 key들). 규칙:
  1. root는 statements 안의 자기 서명 항목(by가 자기 id이고 그 항목의 `signing_key`로 맞는 것)으로 믿는다.
  2. 믿는 컴퓨터의 서명이 맞는 항목을 믿고, 그 항목이 computer면 그 컴퓨터도 서명자가 된다. 더 늘지 않을 때까지 되풀이한다(T0).
  3. T0의 서명자가 서명한 빼기를 모두 모은다(K). 빼기는 서명자가 나중에 빠졌어도 남는다.
  4. K의 key를 뺀 채 1~2를 다시 한다: 빠진 key의 항목, 빠진 key가 서명한 statement, 빠진 root는 쓰지 않는다. 그래서 빼기는 늦게 온 항목에 지지 않고 뺀 key는 다시 들지 못한다.
  5. key 하나에 항목이 여럿이면: rev가 가장 큰 것, 같으면 body canonical bytes가 작은 것이 이긴다. kind·signing_key·machine은 그 key의 statement 가운데 (rev, bytes)가 가장 작은 것과 같아야 하고 다르면 버린다.
  - 초대 key로 서명한 statement는 믿음 계산에 쓰지 않는다(아래 `checkInvited`를 지난 뒤 받은 컴퓨터가 서명한 것만 쓴다).
  6. 같은 key에 id가 여럿이면(지금 컴퓨터마다 따로 만든 `dev_`가 옮겨져 만날 때) 가장 작은 id 하나로 접는다. 다른 key가 같은 id를 가지면 key가 작은 쪽만 남는다.
  - 결과 `RosterView = {devices: RosterDevice[](id 순서), removed: {id, key, at, by}[], folded: {from, to}[], keep: RosterStatement[]}`. `RosterDevice`는 이긴 body(접힌 id)와 `signed_by: dev_[]`다. `keep`은 저장하고 보낼 것이다: K의 빼기, 남은 key마다 이긴 rev의 statement 전부, 서명자를 아직 믿지 못하는(빠지지 않은) statement, key를 아직 믿지 못하는(빠지지 않은) 초대 서명 statement. 빠진 것과 진 rev는 버린다. `keep`은 시각을 보지 않는다. 수명이 지난 초대 서명 statement는 저장하는 쪽이 자기 시계로 버린다.
- `checkInvited(statement, input): Result<RosterEntryBody>`. 초대 서명 statement가 검증하는 컴퓨터에 닿을 때(`join`, `roster` frame, 어느 쪽으로 왔든) 한 번 부른다. 입력 `{now(ms), signer(id) → signing key | undefined(믿는 컴퓨터만), usedBy(inviteKey) → 그 초대로 이미 든 기기 key | undefined, removed(key) → boolean}`. 맞으면 받은 컴퓨터가 그 항목에 자기 key로 서명해 둔다. 거절은 `details.reason`을 싣는다:
  - 초대장 서명자를 믿지 않거나 서명이 틀림, 항목이 초대 key로 서명되지 않음, `entry.invite ≠ invite.key`, `entry.terminal_input ≠ invite.terminal_input` → `unauthorized`, reason `untrusted`(서명자를 아직 모르는 것도 이것이다. 그 statement는 `keep`에 남아 나중에 다시 본다)
  - 닿은 때(검증하는 컴퓨터의 `now`) > `expires_at` → `unauthorized`, reason `expired`. 수명 검사는 이 규칙 하나다
  - 같은 초대로 다른 key가 이미 들었다 → `conflict`, reason `used`(같은 key가 다시 내면 받는다. 다시 붙는 것이다)
  - 빠진 key → `unauthorized`, reason `removed`
- 빠진 기기가 돌아오기: 자기 key가 빠진 것(믿는 컴퓨터가 서명한 빼기가 자기 view의 `removed`에 있다)을 안 기기는 들고 있던 명단과 자기 key를 버린다. 컴퓨터는 복사된 data root 길(`roster/forget_all`, host key·서명 key 지우기, 다음 reconcile에 새 key)과 같고, 폰은 다음 pairing 때 새 기기 key를 만든다. 그 뒤 초대장으로 새 항목(새 id, 새 key)으로 든다. 뺀 key 자체는 다시 들지 못한다(규칙 4). core는 빠진 key의 `join`을 거절할 때 그 빼기 statement를 `details.removal`에 실어, 붙는 쪽이 자기 root로 확인한 뒤에만 버리게 한다.

frame(`frames.ts`). `REMOTE_PROTOCOL_VERSION = 3`, `REMOTE_PROTOCOL_MIN_VERSION = 3`. 옛 `pair` frame과 그 schema는 cleanup이 지울 때까지 그대로 둔다.
- client hello에 `phone?: {os: ios|android, width, height, dpr}`(`remoteDeviceSchema`에서 `name`을 뺀 것)를 더한다. 폰이 연결마다 싣는다. `RemoteDevicePeer`(channel.ts)도 `phone?`을 받는다.
- client → core `join {type, id, statements: rosterStatement[] ≤ ROSTER_JOIN_STATEMENTS_MAX}`. 붙는 쪽의 첫 frame이다. statements는 붙는 쪽 key에 대한 항목이다(컴퓨터가 서명한 것과, 처음 들어올 때는 초대 서명 statement). 답은 같은 id의 `result`, value `rosterJoinedSchema = {device: dev_, roster: rosterSnapshot}`.
- client → core `roster {type, id, roster}`(붙은 뒤, 폰과 컴퓨터 모두). 답 value는 core의 rosterSnapshot이다. 붙는 쪽은 `join` 뒤와 자기가 든 명단이 바뀔 때 든 것 전부를 보낸다. 그래서 폰이 운반자다: 한 컴퓨터에서 받은 statement(아직 믿지 못하는 것과 초대 서명 statement 포함)를 다음에 붙는 컴퓨터에 넘기고, 그 컴퓨터의 것을 받아 온다.
- core → client `roster {type, roster}`. core의 명단이 바뀔 때 붙은 연결마다 민다.

route(`routes.ts`. resource `roster`, `machines`):
- `roster/list` memory, actor user, reads `remote_devices`. 출력 `{this: dev_ | null, devices: [{id, kind, name, os, machine: mch_|null, terminal_input, this: boolean, last_connected_at: at|null}]}`. 이름은 명단의 이름 하나다(기기마다 따로 붙이는 별명이 없다).
- `roster/invite` memory, actor user. 입력 `{terminal_input: boolean, lifetime: "short" | "long"}`(`ROSTER_INVITE_SHORT_MS` | `ROSTER_INVITE_LONG_MS`), 출력 `{invite: rosterInviteText, expires_at}`. errors에 `unavailable`(remote가 꺼짐).
- `roster/join` memory, actor user, changes `remote_devices`. 입력 `{text: string 1..16384}`, 출력 `{device: dev_, machine: mch_(초대한 컴퓨터), pending: boolean}`. 초대한 컴퓨터에 닿지 못하면 이 컴퓨터는 초대장을 확인하고 초대 서명 statement를 들고 `pending: true`로 끝난다(그 statement는 link나 폰이 초대한 컴퓨터를 믿는 컴퓨터에 나른다). errors invalid_input, forbidden, unauthorized, conflict(`this_computer`), unavailable(remote가 꺼짐).
- `roster/remove` memory, actor user, changes. 입력 `{id: dev_}`, 출력 `{id}`. 이 컴퓨터 자신이면 invalid_input, 모르는 id면 not_found.
- `roster/set_terminal_input` memory, actor user, changes. 입력 `{id, on: boolean}`, 출력 `{id}`. 서명한 새 rev다.
- `roster/rename` memory, actor user, changes. 입력 `{id, name: deviceName}`, 출력 `{id}`. 이름을 바꾼 새 rev를 이 컴퓨터가 서명한다. 믿는 컴퓨터 어디서나 바꾸고 모든 기계에 같다. host마다의 `devices/rename` 별명과 desktop viewer의 컴퓨터 별명을 대신한다. 컴퓨터 자기 이름은 `machine/rename`을 따라 그 컴퓨터가 자기 항목을 다시 서명한다.
- `roster/leave` memory, actor user, changes. 입력 `{}`, 출력 `{id}`. 부른 기기 자기만 뺀다(principal `device:<id>`가 아니면 forbidden). `devices/unpair`를 대신한다.
- `roster/statements` read, actor machine, reads `remote_devices`. 출력 withReadCommon `{statements, reach}`.
- `roster/store` command, actor machine, changes `remote_devices`. 입력 `{statements ≤ ROSTER_STATEMENTS_MAX, reach: rosterReach[], folds: {from: dev_, to: dev_}[]}`, 출력 `{count}`. 저장할 것은 main thread가 서명하고 합쳐 정한 뒤 부른다.
- `roster/forget_all` command, actor machine, changes. 입력 `{}`, 출력 `{count}`(복사된 data root).
- `devices/connected` 입력에 `phone?: {os, width, height, dpr}`를 더한다(이 컴퓨터에 처음 붙는 폰의 local 행을 만든다).
- `machines/list` memory, actor user, reads `remote_devices`. 출력 `{machines: [{machine: mch_, device: dev_, name, status: connecting|connected|offline|update, update: client|host|null, path: direct|relay|null, last_seen_at: at|null}]}`(이 컴퓨터는 없다).
- `machines/call` memory, actor user. 입력 `{machine: mch_, resource, method, body: unknown}`, 출력 그 기계의 답 value(z.unknown). 그 기계의 오류(code, message, details)를 그대로 낸다. 연결이 없으면 `unavailable`, 명단에 없는 기계면 `not_found`.
- `machines/watch` memory, actor user. 입력 `{machine: mch_, conditions: eventCondition[] ≤ 64}`, 출력 `{}`. 그 기계의 조건을 통째로 바꾼다(빈 배열은 끔).
- event(`transient.ts`) `MachineFrameReceived`: subject `machine:<mch_>`, payload `{machine: mch_, frame: {type: "ready"} | {type: "event", event: jsonValue} | {type: "closed", reason: slow_consumer|credential_revoked|shutdown}}`. `machines/watch`로 건 기계의 Gateway frame을 이 컴퓨터의 bus에 싣는다. `event`의 내용을 `busEventSchema`로 적지 않는 것은 `transient.ts` → `gateway.ts` → `bus.ts` → `transient.ts` 순환 때문이다. 받는 쪽(shell main)이 `busEventSchema`로 읽는다. `REMOTE_ALLOWED_EVENTS`에 넣지 않는다.

## 할 일

1. `roster.ts`에 위 상수, schema, type, 함수를 둔다. 근거: README "정체", "명단", "들이기".
2. `frames.ts`의 판을 3으로 올리고 hello `phone`, frame `join`·`roster`를 union에 더한다. `channel.ts`의 peer type을 맞춘다. 판을 올리는 것은 README "옮기기"다(`v2` 길 없음).
3. `routes.ts`에 위 route를 더한다. 옛 route(`pairing/start`, `devices/register|revoke|unpair|set_terminal_input|forget_all`)는 그대로 둔다(구현 task와 cleanup이 지운다).
4. `client.ts`(폰의 좁은 입구)에 폰이 쓰는 것을 더한다: `rosterInviteTextSchema`, statement·snapshot type, `signRoster`, `verifyRoster`, `rosterView`, `mergeRoster`, `rosterJoinedSchema`. route 정의는 싣지 않는다.
5. `transient.ts`에 `MachineFrameReceived`를 더한다.
6. `roster_test.ts`에 위험 test를 둔다(순수 함수, 표로 여러 경우).
7. `architecture/remote.md`에 "명단" 절 초안을 쓴다: 문제(쌍마다 pairing), 모델(항목·빼기·초대장, 서명 bytes, 믿음 계산 1~6, 들이기와 `join`, 폰이 나르기와 dual boot의 순서, 빠진 기기가 새 기기로 돌아오기, 이름, 컴퓨터끼리의 연결과 `machines/*`), 지키는 것(빼기가 이긴다, 뺀 key는 돌아오지 않는다, 뺀 서명자의 statement를 쓰지 않는다, 초대장은 닿을 때 수명을 보고 한 번, 받는 쪽이 지금의 route 목록으로 거른다), 버린 안(계정, 가운데 기계, 공유 비밀 하나. roadmap). 다른 절은 고치지 않는다(lead가 끝에 맞춘다).
8. flows: `project-docs/flows/tests/libs-tooling.yaml`에 `roster_test.ts`와 covers를 적는다(`flows` skill). covers할 outcome이 아직 없으면 `covers: []`와 note다.

정한 것(README에 답이 없어 정함):
- 초대장 수명은 만들 때 고른다: 기본 30분, 긴 것 7일(lead 결정). 수명은 statement가 검증하는 컴퓨터에 닿을 때 한 번 본다.
- dual boot는 이렇게 끝난다: OS A에서 긴 초대장 → OS B에서 `join`(A에 못 닿아 `pending`) → 사람이 B의 초대장으로 폰을 B에도 들인다(폰은 A의 명단에만 있어 B를 모르고 B는 폰을 모른다. 이 한 번이 없으면 폰이 B에 붙을 길이 없다) → 폰이 B의 statement(초대 서명 statement 포함)를 A에 나르면 A가 7일 안에 받아 서명하고, A의 것을 B에 나른다.
- 같은 key의 여러 id는 가장 작은 id로 접는다. 이유: 같은 폰을 컴퓨터 둘에 pairing해 둔 사람은 migration 뒤 같은 key에 `dev_`가 둘이고, README "기기 id는 명단 전체에서 하나다"를 지키려면 하나로 정해야 한다. 순서와 무관한 규칙이 가장 작은 값이다.
- 초대 서명 statement는 나르기는 하되 믿음 계산(`rosterView`)에는 쓰지 않는다. 닿은 컴퓨터가 `checkInvited` 뒤 자기 key로 서명한 것이 퍼진다. 이유: 수명 검사를 닿는 순간 한 번만 하면 명단 계산에 시각이 들지 않아 순서와 때에 무관하다.
- 주소(reach)는 서명하지 않고 snapshot에 따로 싣는다. 이유: 주소는 자주 바뀌고 Noise가 key로 상대를 확인한다.

## 끝남

- `npm run check`가 통과한다.
- 위험 test(`packages/protocol/remote/roster_test.ts`):
  - "믿는 컴퓨터의 서명이 없는 항목, 수명이 지난 초대장(닿은 때 기준), 한 번 쓰인 초대장으로는 들어오지 못한다"
  - "빼기보다 늦게 도착한 뺀 기기의 항목이 빼기를 되돌리지 못한다"(README 둘째 test의 순수 함수 쪽. 붙지 못하는 쪽은 `roster-core`)
  - "뺀 컴퓨터가 서명한 항목은 받아들이지 않는다"
  - "두 명단을 어느 순서로 합쳐도 같은 명단이 된다"
- 남지 않음: 이 task는 지우지 않는다. `grep -rn "REMOTE_PROTOCOL_VERSION = 2" packages tools tests`가 0줄이다.
- subprocess, 서버, 브라우저를 띄우는 test를 만들지 않는다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: lead가 고칠 목록 file(`protocol/*/mod.ts`, core 조립 목록, gallery `pages/index.ts`, `package.json`). 이 task에서는 `packages/protocol/remote/mod.ts`에 더할 export 목록, `packages/protocol/remote/allowlist.ts`에 `rosterLeave`를 더할 것
- 안 쓰게 된 export(남이 쓰던 것은 지우지 않는다)
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 넘길 줄: 남의 file을 최소로 맞춘 곳
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- **무겁게 짠 것**: 가장 단순한 구현(AGENTS.md "속도")보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것. 없으면 "없음"

## 설계 review 뒤 바뀐 것 (lead가 더함)

merge 전에 다른 worker가 설계를 review했고(합치는 순서, 초대장 새기·다시 쓰기, 빼기와 들이기의 엇갈림, 복사한 data root), 같은 task에서 고쳤다. 뒤 task는 위 "모양"보다 merge된 `roster.ts`와 `architecture/remote.md` 명단 절을 따른다. 바뀐 것:
- `rosterView(statements, roots)`의 roots는 **서명 key**다(host key가 아니다). host key는 서명을 못 하므로 host key root는 누구나 "그 host key + 내 서명 key" 항목을 스스로 서명해 흉내 낼 수 있다.
- 빼기 body에 `signing_key: keyText | null`(빠진 컴퓨터의 서명 key, 폰은 null). 뺀 서명 key는 root·서명자·항목의 `signing_key`로 다 막힌다. 서명 key 하나 ↔ host key 하나, 어긋나면 둘 다 뺀다.
- 초대장 body와 `roster/invite` 입력에 `kind`(computer | phone). `checkInvited`가 `entry.kind`를 대조한다. 샌 폰 초대장으로 컴퓨터(서명자)가 들어오지 못한다.
- `rosterJoinedSchema = {device, computer: {id, signing_key}, roster}`. 이미 pairing한 폰은 host key만 들었으므로 Noise로 확인된 답에서 그 컴퓨터의 서명 key를 root로 배운다.
- `RosterView = {devices: {body, signed_by, pending}[], removed: {body, signed_by}[](셈에 드는 빼기만), conflicts: {key, ids, reason: id|signing_key|shape|invite}[], invites: {invite, key}[], folded, keep}`. 새 export `rosterPending(view, key)`, `rosterFresh(statements, now)`.
- `checkInvited(statement, {now, view})`. 거절 reason에 `conflict/id_taken`, `conflict/key_taken`이 더해졌다.
- 빼기 셈: T0에서 믿은 빼기(K0)의 대상이 서명한 빼기는, 서명자 가운데 대상이 아닌 컴퓨터가 있거나 서로 뺀 경우(둘 다 빠진다)에만 센다. 두 번(둘째는 첫째에서 센 빼기의 대상만) 한다. 빠진 도둑은 자기를 뺀 컴퓨터 말고는 빼지 못한다. (lead: 시각이 없어 "빠진 뒤"와 "엇갈림"을 못 가르니 서로 뺀 경우는 둘 다 빼서 닫힌 쪽으로 간다)
- 같은 rev의 다툼에서 `terminal_input: false`가 이긴다.
- `keep`은 view를 다시 만들 수 있다(`rosterView(view.keep) = view`). 초대 서명 statement는 수명까지, 서명자가 이긴 rev에도 서명했을 때만 진 rev를 버린다.
- 컴퓨터의 공동 서명 규칙: `view.devices[].body`와 `view.removed[].body`만 서명한다. conflict 항목과 셈에 안 드는 빼기는 서명하지 않는다.
