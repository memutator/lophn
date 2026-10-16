# A2A (Agent2Agent) protocol 조사

agent call protocol 설계를 위한 조사다. 해석은 마지막 절에만 둔다.

## 읽은 것

- repo: https://github.com/a2aproject/A2A, `--depth 1` clone, commit `7c861a597b93208de3c19357cc0d66b9f6250e9b` (2026-10-12)
- 공식 사이트: https://a2a-protocol.org (repo의 `docs/`를 mkdocs로 낸 것)
- 이 commit의 spec은 v1.0.0이다 (`docs/specification.md` 상단). 이하 "spec §N"은 이 파일의 절 번호다.
- 데이터 모델의 정본은 `specification/a2a.proto`다. spec 본문 §4의 표는 proto에서 생성된다.
- 보조: `docs/topics/life-of-a-task.md`, `streaming-and-async.md`, `enterprise-ready.md`, `agent-discovery.md`, `docs/whats-new-v1.md`.
- 옛 이름(`message/send`, `message/stream`, `tasks/cancel`, `tasks/resubscribe`)은 v0.3 이름이다. v1.0은 `SendMessage`, `SendStreamingMessage`, `CancelTask`, `SubscribeToTask`다 (`docs/whats-new-v1.md`).
- 이 repo 어디에도 "agent chaining"이라는 전용 절은 없다. 아래 chaining 항목은 흩어진 문장을 모은 것이다.

## 1. Core objects와 correlation

| 객체 | 내용 | 출처 |
|---|---|---|
| Task | 작업 단위. `id`, `context_id`, `status`, `artifacts`, `history`, `metadata`. `id`는 server가 만든다 | proto `message Task`, spec §3.4.2 |
| Message | 한 turn. `message_id`(만든 쪽이 정함, 필수), `context_id`, `task_id`, `role`(USER/AGENT), `parts`, `reference_task_ids`, `metadata` | proto `message Message` |
| Part | 내용의 최소 단위. `text` / `raw`(bytes) / `url` / `data`(JSON) 중 하나, 그리고 `filename`, `media_type`, `metadata` | proto `message Part` |
| Artifact | Task의 산출물. `artifact_id`(task 안에서 unique), `name`, `description`, `parts` | proto `message Artifact` |
| contextId | 관련된 task와 message를 묶는 id. 대화 한 덩어리 | spec §3.4.1 |
| taskId | 상태를 가진 작업 하나의 id. server가 만든다. client가 새 task의 id를 정해 보낼 수 없다 | spec §3.4.2 |

Role은 `ROLE_USER`(client에서 server로)와 `ROLE_AGENT`(server에서 client로) 둘뿐이다. 즉 A2A는 비대칭이다. 부르는 쪽이 client, 받는 쪽이 server다.

**call은 어떻게 식별되나.** call이라는 객체는 없다. 식별자는 세 겹이다.

- `message_id`: 한 message를 식별한다. 보낸 쪽이 만든다. 중복 감지에 쓸 수 있다 ("Send Message operations MAY be idempotent", spec §3.3.1).
- `taskId`: 부른 일 하나를 식별한다. 받는 쪽이 만들어 응답에 넣는다.
- `contextId`: 여러 task와 message를 묶는다. 없이 보내면 받는 쪽이 만들어 응답에 넣는다 (spec §3.4.1).

**reply는 어떻게 맞추나.** 별도 `reply_to`가 없다. 응답이 요청에 대한 응답인 것은 transport가 보장한다. 곧 JSON-RPC 응답 id, HTTP 응답, SSE stream, 또는 webhook payload의 `taskId`다. 나중에 오는 update는 `taskId`로 맞춘다. webhook 수신자는 "payload의 task ID가 자기가 만든 task와 맞는지 확인"해야 한다 (spec §4.3.3, §13.2). `reference_task_ids`는 correlation이 아니라 "이 task를 참고하라"는 힌트다 (spec §3.4.3).

## 2. Task lifecycle state

출처: proto `enum TaskState`, spec §3.1.1, §3.1.2, §3.1.6.

| state | 뜻 | 종류 |
|---|---|---|
| SUBMITTED | 접수되어 확인됨 | 진행 |
| WORKING | 처리 중 | 진행 |
| INPUT_REQUIRED | 사용자 입력이 더 필요 | interrupted (terminal 아님) |
| AUTH_REQUIRED | 인증이 필요 | interrupted (terminal 아님) |
| COMPLETED | 성공 | terminal |
| FAILED | 오류로 끝남 | terminal |
| CANCELED | 끝나기 전에 취소됨 | terminal |
| REJECTED | agent가 하지 않기로 결정. 생성 시점이든 나중이든 가능 | terminal |
| UNSPECIFIED | 알 수 없음. enum의 0 값 | (proto 기본값) |

- terminal은 네 개다: COMPLETED, FAILED, CANCELED, REJECTED. spec은 이 목록을 여러 곳에서 그대로 반복한다.
- terminal task는 되살리지 못한다 ("it cannot restart", `life-of-a-task.md` Task Immutability). 후속 요청은 같은 `contextId`에서 새 task로 만든다.
- terminal task에 message를 보내면 `UnsupportedOperationError` (spec §3.1.1).
- 이 commit의 proto에는 v0.3의 `unknown`이 없고 `UNSPECIFIED`만 있다.

## 3. fire-and-forget / request-response / multi-turn

A2A에는 fire-and-forget 전용 모드가 없다. 항상 응답이 있다. 가장 가까운 것은 "`return_immediately: true`로 보내고 결과를 안 받는 것"이다.

| 하고 싶은 것 | A2A 표현 | 출처 |
|---|---|---|
| 응답을 기다리며 한 번 호출 | `SendMessage`, `return_immediately` 기본값 false. terminal 또는 interrupted까지 **block** | spec §3.2.2 |
| 바로 돌아오고 나중에 받기 | `SendMessage` + `return_immediately: true`. 진행 중 state의 Task가 즉시 반환됨 | spec §3.2.2, proto `SendMessageConfiguration` |
| 단순 질의응답 | server가 Task 없이 `Message`로 직접 응답 | spec §3.1.1 |
| 진행 상황 stream | `SendStreamingMessage` (SSE) | spec §3.1.2, §11.7 |
| 끊긴 stream 다시 붙기 | `SubscribeToTask`. 첫 event는 현재 Task 전체 (`GetTask`와 구독 사이 틈이 없게) | spec §3.1.6 |
| 상태 확인 | `GetTask`(polling), `ListTasks` | spec §3.1.3, §3.1.4 |
| 연결 없이 완료 통지 | push notification: client가 webhook URL을 등록하면 server가 HTTP POST | spec §3.1.7, §4.3.3 |
| multi-turn | task가 `INPUT_REQUIRED`가 되고, client가 같은 `taskId`로 message를 또 보냄 | spec §3.4.3, §6.3 |

- 한 번 응답받고 끝이 아니라 여러 번 주고받는 대화는 두 방식으로 된다. (a) 한 task 안에서 `INPUT_REQUIRED`와 후속 message를 반복한다. (b) 같은 `contextId`로 새 task나 message를 계속 만든다. "어느 쪽이 닫는다"는 개념은 없다. 대화는 task가 terminal이 되거나 context를 안 쓰면 끝난다.
- Message와 Task의 구분: Message는 가벼운 왕복, 협상용이다. Task는 실행할 일이 정해진 뒤 만든다 (`life-of-a-task.md`). 산출물은 Message가 아니라 Artifact로 돌려주라고 한다 ("Messages SHOULD NOT be used to deliver task outputs", spec §3.7).
- message는 신뢰할 만한 전달 수단이 아니다. 재연결하면 status update message를 놓칠 수 있다. 중요한 정보는 Task history나 Artifact에 넣어야 한다 (spec §3.7).
- push 전달은 at-least-once다. client는 idempotent하게 처리해야 한다 (spec §4.3.3).
- 문서 간 불일치: spec §3.1.2는 stream이 terminal에서 닫힌다고 쓰고, `streaming-and-async.md`는 INPUT_REQUIRED에서도 닫힌다고 쓴다. 이 점은 spec 본문이 모호하다.

## 4. client는 block하나

| 방식 | block 여부 |
|---|---|
| `SendMessage` 기본 | block한다. terminal 또는 interrupted까지 기다린다 (spec §3.2.2) |
| `return_immediately: true` | block하지 않는다. "It is the caller's responsibility to poll ... subscribe ... or receive push" |
| `SendStreamingMessage` | 연결이 열려 있는 동안 event를 받는다. 호출 자체는 즉시 시작된다 |
| webhook | 연결 없음. server가 나중에 POST한다 |

즉 A2A는 요청-응답이 기본이고, 비동기는 옵션이다. 결과는 새 입력으로 들어오는 것이 아니라 client가 직접 가져오거나 (GetTask, SSE), client 쪽 HTTP 서버가 받는 것이다 (webhook). 이 점은 lophn의 "reply는 새 input으로 돌아온다"와 다르다.

## 5. 기존 대화에 보내기 vs 새로 시작

규칙은 spec §3.4.3과 proto `Message` 주석에 있다.

| 보내는 내용 | 의미 |
|---|---|
| `contextId`, `taskId` 둘 다 없음 | 새 대화, 새 task (또는 Message 응답). server가 id를 만든다 |
| `taskId`만 있음 | 그 task를 이어감. server가 `contextId`를 추론한다 |
| `contextId`만 있음 | 기존 대화 안에서 새 task 시작 |
| 둘 다 있고 서로 어긋남 | server가 거부해야 한다 (MUST) |
| 없는 `taskId` | `TaskNotFoundError`. client가 새 task의 id를 정해 보낼 수는 없다 |
| terminal task의 `taskId` | `UnsupportedOperationError`. 새 task를 같은 `contextId`로 만들어야 한다 |

- server가 client 지정 `contextId`를 받을 수 없으면 거부해야 하고, 새 id를 만들어 돌려주면 안 된다 (MUST NOT).
- client는 server가 처리 방식을 모르는 `contextId`를 만들어 보내지 않는 것이 좋다 (SHOULD NOT). server가 준 id는 opaque로 취급한다.
- 같은 `contextId`에 parallel task가 여러 개 있을 수 있다 ("Parallel Follow-ups", `life-of-a-task.md`).
- context 안의 LLM 대화 상태는 server가 관리한다. protocol은 "contextId를 internal state에 써도 된다"만 말한다 (MAY).

## 6. Cancel

출처: spec §3.1.5, §3.3.1, §9.4.5.

- `CancelTask(id)` 하나다. 응답은 갱신된 Task다.
- 취소는 요청일 뿐이다. 성공이 보장되지 않는다 ("The server will attempt to cancel ... success is not guaranteed").
- 이미 terminal이면 `TaskNotCancelableError` (-32002), 없으면 `TaskNotFoundError` (-32001).
- idempotent다. 중복 요청은 같은 효과를 낸다. 취소 뒤 task가 purge되었으면 `TaskNotFoundError`가 나올 수 있다.
- 취소 요청이 받아들여졌다고 곧바로 `CANCELED`가 되는 것은 아니다. 최종 state는 Task의 state를 보고 안다.
- 취소할 수 있는 쪽은 client(부른 쪽)이고, 그것도 server의 authorization을 통과해야 한다 (spec §13.1).

## 7. 받을 수 없을 때의 error

출처: spec §3.3.2, §3.3.4, §5.4.

| error | JSON-RPC | HTTP | 언제 |
|---|---|---|---|
| TaskNotFoundError | -32001 | 404 | task id가 없거나, 접근할 수 없거나, 이미 purge됨 |
| TaskNotCancelableError | -32002 | 400 | terminal task를 취소 |
| PushNotificationNotSupportedError | -32003 | 400 | `capabilities.pushNotifications`가 false |
| UnsupportedOperationError | -32004 | 400 | streaming 미지원, terminal task에 message, 기타 |
| ContentTypeNotSupportedError | -32005 | 400 | part의 media type을 agent나 skill이 못 받음 |
| InvalidAgentResponseError | -32006 | 500 | agent가 spec에 안 맞는 응답을 함 |
| VersionNotSupportedError | -32009 | 400 | `A2A-Version`을 지원 안 함 |
| (인증) | - | 401 | credential이 없거나 틀림 |
| (인가) | - | 403 | 권한 부족 |

- 받는 agent가 아예 없는 경우의 A2A error는 없다. 주소(URL)에 닿지 못하면 transport 오류다. A2A는 "agent not found"를 정의하지 않는다.
- 일은 받았지만 하지 않겠다는 것은 error가 아니라 task state `REJECTED`다. 그리고 일하다 실패하면 `FAILED`다. 즉 요청 단계 error(호출이 성립 안 함)와 task 단계 결과(호출은 성립했고 일이 실패/거부)를 나눈다.
- 존재하지 않는 것과 권한 없는 것을 구분하지 말아야 한다: "SHOULD NOT distinguish between 'does not exist' and 'not authorized'", 존재를 드러내면 안 된다 (MUST NOT reveal, spec §3.3.2).
- error 형식은 code, message, 선택적 details(google.rpc `ErrorInfo` 등)다.
- 지원하지 않는 기능은 Agent Card의 `capabilities`로 미리 알 수 있고, client는 호출 전에 확인하는 것이 좋다 (SHOULD, spec §3.3.4).

## 8. Agent Card와 skill discovery

출처: spec §8, proto `AgentCard`, `AgentSkill`, `docs/topics/agent-discovery.md`.

- 모든 A2A server는 Agent Card를 내놓아야 한다 (MUST).
- 찾는 방법 세 가지: (1) well-known URI `https://{domain}/.well-known/agent-card.json`, (2) registry/catalog, (3) 직접 설정한 URL 또는 내용.
- Agent Card 필드: `name`, `description`, `supported_interfaces`(URL, binding, version, tenant), `capabilities`(streaming, push_notifications, extensions, extended_agent_card), `security_schemes`, `security_requirements`, `default_input_modes`, `default_output_modes`, `skills`, `signatures`(JWS).
- `AgentSkill`: `id`, `name`, `description`, `tags`, `examples`, `input_modes`, `output_modes`, `security_requirements`. spec은 skill을 "largely a descriptive concept"라고 한다. 즉 skill id를 골라 호출하는 필드는 `SendMessageRequest`에 없다. caller(주로 LLM)가 description과 examples를 읽고 자연어 message를 보내면, 받는 쪽이 알아서 capability에 맞춘다 (`life-of-a-task.md`: "An agent maps an incoming message to a supported capability").
- 같은 endpoint 뒤에 여러 agent를 두려면 `tenant`라는 opaque 값을 쓴다 (proto `AgentInterface.tenant`).
- 인증된 caller에게만 더 많은 skill을 보이는 extended card가 있다 (`GetExtendedAgentCard`, spec §13.3).
- 즉 "어떤 agent를 부를지"는 caller 쪽 판단이다. protocol은 카드를 주는 데까지만 한다.

## 9. 권한(authority)

- caller의 권한이 callee로 넘어가지 않는다. 인증은 transport 층(HTTP header, OAuth2, mTLS)에서 하고, payload에는 사용자나 client 정체성이 없다 ("No Identity in Payload", `enterprise-ready.md`).
- server는 모든 요청을 인증하고(MUST), 인증된 정체성과 자기 정책으로 인가한다. 인가 모델은 "agent-defined"이고 protocol이 정하지 않는다 (spec §7.4, §7.5, §13.1). 판단 근거는 요청한 skill, task 안의 행동, data 접근 정책, OAuth scope 등이다.
- Task, List, Cancel, Subscribe, push config 전부 호출마다 접근 권한을 검사해야 한다 (MUST).
- callee가 일하다 다른 자원이 필요하면 `AUTH_REQUIRED`로 caller에게 넘긴다 (spec §7.6). 이 state 전환 자체는 어떤 작업도 인가하지 않는다 (MUST NOT treat as authorization, §7.6.4). credential을 message로 넘기면 chain의 모든 agent에게 노출되므로, 원 요청자에게만 쓸 수 있게 묶고 암호화하라고 권한다 (§7.6.3).
- 결국 "누가 누구를 부를 수 있나"를 protocol은 정하지 않고, 받는 쪽 server의 정책에 맡긴다.

## 10. agent chaining / delegation

- spec의 모델은 client agent가 remote agent를 부르는 것이다. remote agent는 내부에서 다른 도구(MCP)나 다른 agent를 쓸 수 있고, 이는 protocol 밖의 일이다 ("Opaque Execution", spec §1.2, Appendix B).
- chain 전용 id(parent task, call stack)는 없다. 각 호출은 독립된 client-server 쌍의 task다. 앞 호출의 결과를 뒤 호출에 넘기려면 `reference_task_ids`나 `contextId`를 쓴다.
- 결과는 단계별로 되돌아온다. 중간 agent가 아래 agent의 Task 결과를 받고, 자기 Task의 artifact나 status로 위에 올린다. 이 중계를 protocol은 정의하지 않는다. 구현이 한다.
- `AUTH_REQUIRED`와 `INPUT_REQUIRED`는 chain을 따라 위로 올릴 수 있다 ("forming a chain of Tasks in AUTH_REQUIRED", spec §7.6.2).
- tracing은 W3C Trace Context header로 한다 (`enterprise-ready.md`). protocol payload 안에 trace field는 없다.

## lophn에 비춰 본 점

- **축 1 (새 session vs 열린 session)**: A2A의 `contextId` / `taskId` 규칙이 그대로 대응한다. id 없음이면 새로 시작하고, `taskId`면 그 일을 이어가고, `contextId`면 같은 대화에 새 일을 만든다. lophn은 "role로 새 session을 연다"와 "열린 session id로 보낸다"를 envelope의 receiver 필드 하나로 구분하면 된다. 다만 A2A처럼 receiver가 id를 만들어 돌려주는 방식은 피하는 편이 낫다. 같은 앱 안이므로 Router가 call id와 session id를 직접 발급할 수 있다.
- **축 2 (reply 모드)**: A2A에는 fire-and-forget이 없다. none은 lophn이 더해야 한다. one result는 A2A의 `return_immediately: true` + Task + Artifact와 같다. conversation은 `INPUT_REQUIRED`와 같은 task에 후속 message를 보내는 모양과 같다. 다만 A2A는 닫는 주체를 정하지 않는다. lophn은 "한쪽이 닫을 때까지"를 명시적 close로 만들어야 한다.
- **축 3 (sender는 block하지 않는다)**: A2A 기본은 block이다 (`return_immediately` 기본 false). lophn은 항상 `true`에 해당하는 동작만 갖고, 기본값도 그것으로 한다. 결과를 가져오는 polling(`GetTask`), SSE, webhook도 쓰지 않는다. 결과는 Router가 sender session의 새 input으로 넣는다. A2A에는 이 방식이 없다. A2A의 `reference_task_ids` 같은 역할은 envelope의 `reply_to`가 맡는다.
- **상태 이름**: A2A 상태에서 가져올 만한 것은 submitted(=sent/accepted), working, completed, failed, canceled, rejected다. lophn의 sent, accepted, done, failed, cancelled에서 rejected(받는 쪽이 하지 않겠다고 함)를 따로 둘지 정해야 한다. A2A는 "호출이 성립 안 함"(error)과 "일을 거부함"(REJECTED)과 "일이 실패함"(FAILED)을 나눈다. 이 분리는 쓸 만하다. terminal은 되살리지 않고 새 call로 만든다는 규칙(Task Immutability)도 그대로 가져올 만하다.
- **받는 쪽이 없거나 권한이 없을 때**: A2A는 존재하지 않음과 권한 없음을 같은 error로 돌려준다. lophn은 단일 사용자 앱이므로 정보 노출을 막을 이유가 약하다. sender가 고칠 수 있게 `not_found`와 `not_allowed`를 구분해 알려 주는 편이 낫다. 그 결과도 call state(failed)와 sender의 새 input으로 돌아가야 한다.
- **취소**: `CancelTask`처럼 "요청이며 보장하지 않는다", idempotent, terminal이면 거부하는 규칙은 그대로 쓸 만하다. 취소 요청과 최종 `cancelled` state를 분리하는 점도 같다.
- **복사하지 말 것**: Agent Card 서명, well-known URI, OAuth/mTLS, tenant, webhook(SSRF 방어 포함), extended card, protocol version header, 여러 transport binding, SSE 재연결과 artifact chunk(`append`, `last_chunk`). 모두 네트워크 너머의 서로 모르는 조직 사이를 위한 장치다. lophn은 한 앱 안의 peer이고 Router가 신뢰된 중개자다.
- **skill discovery**: A2A는 caller가 카드를 읽고 자연어로 부르며 skill id 필드가 없다. lophn은 role(lophn, App Engineer, Operator, Context Engineer)이 이미 정해져 있으므로 role 이름이 receiver 주소다. 카드 대신 role별 한 줄 설명을 prompt에 넣는 정도로 충분하다.
- **권한**: A2A는 caller의 권한을 callee에 넘기지 않고, callee가 자기 정책으로 인가한다. lophn도 sender의 권한이 receiver로 번지지 않도록, receiver session이 자기 권한으로만 일하게 하는 편이 맞다. 호출 허용 여부(누가 누구를 부를 수 있나)는 A2A가 비워 둔 부분이므로 Router의 정책으로 lophn이 직접 정해야 한다. chain의 parent id가 protocol에 없는 점도 lophn은 envelope에 `reply_to`와 call id로 직접 풀 수 있다.
