# mobile-phone-use-grant

앱 backend가 폰 기능을 쓰는 길의 권한과 core 쪽을 짓는다: grant kind `phone.use`(scope `{capability}`)를 activation 동의 카드로 앱마다 한 번 묻고, broker `POST /_lophn/broker/phone/request`가 요청마다 선언∩grant를 본 뒤 자식 app credential로 core memory route `app_phone.request`를 부르고, 그 handler가 기준 폰에 `PhoneLink.call`을 한다. 표 `grants`의 `kind` CHECK를 넓히는 ledger step이 하나 든다.

- 단위: phone-use (wave 9)
- 선행: mobile-phone-link, mobile-widgets-decl, mobile-phone-link-contract, mobile-cap-phone. `mobile-phone-link`가 기다린 land 뒤다. 동의 카드 file(`waiting/model.ts`)은 `mobile-push` land 뒤의 것을, catalog `data.ts`는 `mobile-user-apps` land 뒤의 것을 고친다
- 소유(이 task만 고친다):
  - `packages/protocol/apps/permissions.ts`
  - `packages/protocol/apps/package-routes.ts`(permission kind 목록 한 곳)
  - `packages/core/apps/permissions`(새 file `broker/phone.ts`, `broker/phone_test.ts`, `schema_test.ts`와 `facts.ts`, `effective.ts`, `schema.ts`, `broker/access.ts`, `mod.ts`. `broker/notify.ts`는 건드리지 않는다)
  - `packages/core/apps/phone-request`(새 폴더: `handler.ts`, `mod.ts`)
  - `packages/core/apps/releases/sdk-permissions.ts`
  - `packages/core/main/app-supervisor/broker.ts`
  - `packages/shell/renderer/desktop/connection/waiting/model.ts`(선언 줄의 `phone.use` 갈래만)
  - `packages/shell/renderer/app-frame/app-detail/{source,model,reads}.ts`(grant 자원 kind `phone` 한 갈래만)
  - `packages/design/i18n/catalog/data.ts`(새 key만)
- 한 줄씩 허락(공유 file. 필요한 줄만 더하고 보고의 "넘길 줄"에 적는다. 다른 계획도 같은 file에 줄을 더한다):
  - packages/core/apps/permissions/broker/server.ts: `BROKER_ROUTES.phoneRequest`와 `routes()`의 한 줄, `BrokerServices.phone`
  - packages/core/main/app-supervisor/assembly.ts: 자식 credential로 `app_phone/request`를 부르는 port(`notice.setTray` 옆)
  - packages/core/main/daemon/wiring/apps.ts: `app_phone/request` memory handler(부를 때 `ctx.phoneLink`를 읽는다)
  - packages/core/apps/register.ts(`memoryRoutes`에 `appPhoneRequest`), packages/core/apps/control.ts(`APP_CHILD_OPERATIONS`와 `appsOperationPolicies`에 `app_phone.request`, actors `machine`·`app`)
  - packages/protocol/apps/mod.ts(`export * from "./phone-request.ts"`)와 packages/protocol/apps/registry.ts(route)
  - packages/core/main/daemon/wiring/remote.ts: `schemaStepsAfterTeams` 끝에 새 step(WIRINGS 맨 뒤 wiring이다. AGENTS.md "호환성")
  - packages/core/storage/migration/schema-steps.lock.json: 끝에 `{id, sha256}` 한 항목
- 읽을 것:
  - 본보기(같은 일을 다른 kind로 한 것): `schema.ts`의 `apps.permissions.notify_kind`(CHECK를 넓히려 표를 다시 만든 step), `facts.ts`의 `resourceOf`·`resourceLabel`, `effective.ts`, broker `notify.ts`·`access.ts`(`liveOnly`, `currentAccess`, `notifyGranted`, `refuse`), app supervisor `broker.ts`와 `assembly.ts`(`asChild`), `waiting/model.ts`의 `declaredLines`(`notify.send` 갈래), `app-detail/{source,model,reads}.ts`의 `notify`
  - 계약: `packages/protocol/apps/phone-request.ts`(`appPhoneRequest`, `brokerPhoneInputSchema`, `PHONE_REQUEST_BROKER_PATH`, `phoneCapabilitySchema`), `packages/protocol/phone/kinds.ts`(`PHONE_KINDS`의 input·output·deadline, `unavailable` 이유), 선언의 `phone.use`(`mobile-widgets-decl`), wiring 칸 `phoneLink`(`mobile-phone-link`)
  - architecture: `project-docs/architecture/activation.md`(선언 사실, 동의를 묻는 판정), `approval.md`, 조사 `/home/pyosechang/projects/lophn/reports/mobile-program/widgets-survey.md`의 2.3("Grant model", 표), 계획 `README.md`의 "정한 것"(banner·기록 없음, 폰을 깨우지 않는다)
- 계약:
  - 쓰는 것: 위 계약, `ctx.phoneLink.{call,primary}`
  - 내놓는 것:
    - grant kind `phone.use`, scope `{capability}`. 자원 이름(`resourceLabel`)은 `phone.use:<capability>`. 동의 카드 줄: label "Phone", 값은 capability마다 한 문장(`location.get` → "Use your phone's location"). App details의 grant 줄도 같은 글
    - ledger step `apps.permissions.phone_kind`: `grants`를 `kind` CHECK에 `'phone.use'`를 더해 다시 만든다(`notify_kind`와 같은 SQL 꼴, 행과 index·trigger 그대로). 이미 낸 step의 SQL은 고치지 않는다
    - broker `phone/request`: body parse → `liveOnly(child, "phone.use", {capability})` → `currentAccess` → 그 capability의 grant가 없으면 `refuse("phone.use", {capability})`(core를 부르지 않는다) → core `app_phone/request`
    - core `app_phone.request` handler: actor가 app이 아니면 `forbidden`, 앱이 없으면 `not_found`·보관이면 `conflict`, capability나 `input`이 `PHONE_KINDS`에 맞지 않으면 `invalid_input`, `phoneLink.primary()`가 null이면 `unavailable`(`no_phone`), 그 밖은 `phoneLink.call({device, kind: capability, input, deadline_ms: PHONE_KINDS[kind].deadline_ms})`의 결과. 성공 `value`가 kind의 output schema에 맞지 않으면 `unavailable`(폰이 틀린 답을 했다). 출력 `{value}`
    - `sdk-permissions.ts`에 `"@lophn/cap-phone": [["phone.use"]]`

## 할 일

1. protocol: `permissions.ts`의 `permissionRequirementSchema`·`appGrantScopeSchema`에 `phone.use`와 scope `{capability: phoneCapabilitySchema}`(superRefine의 scope 가르기에 `capability` 갈래), `package-routes.ts`의 kind 목록.
2. core grant: `facts.ts`, `effective.ts`, `schema.ts`의 새 step(export해 remote wiring의 줄에서 잇는다), lock 항목(sha256은 기존 항목을 만든 길로 계산한다), `access.ts`에 `phoneGranted(state, capability)`.
3. broker: `broker/phone.ts`(`createPhoneService({access, core})`), `server.ts`의 줄, app supervisor `broker.ts`에서 만들기와 `assembly.ts`의 port.
4. core route: `packages/core/apps/phone-request/handler.ts`와 등록 줄(`wiring/apps.ts`, `register.ts`, `control.ts`, `protocol/apps/{mod,registry}.ts`).
5. 동의 카드와 App details: `waiting/model.ts`의 `declaredLines`에 `phone.use:` 갈래, `app-detail`의 자원 kind `phone`, `data.ts`의 key(`waiting.label.declared-phone`, `waiting.label.declared-phone-location` 등. 폰 Inbox는 같은 waiting model을 쓰므로 따로 고치지 않는다).
6. 개발 core에서 손으로 확인: `phone.use`를 선언한 작은 앱(`@lophn/cap-phone`을 쓴다)을 activate하면 동의 카드에 위치 줄이 서고, 허락 전에는 `getLocation`이 `forbidden`, 허락 뒤 기기가 없으면 `unavailable`(`no_phone`), 폰을 붙였지만 `location.get`을 적지 않았으면 `unavailable`(`unsupported`)인지.

## 끝남

- `npm run check`가 통과한다.
- 위험 test:
  - "`phone.use`를 선언하지 않았거나, 선언했지만 grant가 없거나, 거둬졌거나, 다른 capability의 grant뿐이거나, live가 아닌 자식이거나, 보관된 앱이면 broker는 `forbidden`(`permission: "phone.use"`, `scope: {capability}`)이고 core port를 부르지 않는다"(`broker/phone_test.ts`. spy port. 폰의 위치가 허락 없이 나가지 않게 하는 경계다)
  - "`apps.permissions.phone_kind` step 뒤에도 기존 grant 행이 모든 칸 그대로 남고, active·revoked 규칙(trigger)이 그대로 걸리며, `phone.use` 행을 넣을 수 있다"(`schema_test.ts`. 사람의 grant를 잃지 않게)
- 남지 않음: 없음(더하기만)

- flows catalog: 이 task가 더하거나 지우는 route, broker 길, test file의 줄은 이 task가 project-docs/flows 에서 고친다(자기 줄만. 꼴은 `.claude/skills/flows/SKILL.md`). `node tools/flows.ts check`가 통과해야 한다.

## 보고

`.claude/skills/orchestrate/brief-template.md`의 "보고" 꼴. 더해서: 동의 카드 줄의 그림이나 글, 손 확인 넷의 결과, step id와 sha256, 등록할 것과 넘길 줄 목록.
