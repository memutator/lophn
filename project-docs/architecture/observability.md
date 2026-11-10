# observability

core daemon이 자기 상태를 어떻게 바깥에 드러내는가. 구조화 log, trace(span), metric, 상태 점검(`/healthz`·`/readyz`), 오류 봉투의 `trace_id`, 자원 snapshot, 개발 환경 점검(`npm run doctor`)이 여기에 든다. 장애가 났을 때 사람(또는 개발자)이 log 한 줄, 요청 하나, ledger의 model 호출 기록을 같은 id로 이어 읽을 수 있고, 설치한 앱에서도 core log가 file로 남는다.

제품 기록(ledger)과 운영 진단 log(`<data root>/logs/platform-*.jsonl`, `diagnostics/list`)는 이 문서의 대상이 아니다. 둘은 그대로이고, core의 구조화 log는 그와 별개로 `<data root>/logs/core-*.jsonl`에 남는다. ledger 원본을 읽는 route(`agent-traces/read`, `agent-usage/read`, `model-calls/read`·`model-calls/list`)도 제품 기록을 읽는 길이다. 여기서 다루는 telemetry와는 span attribute의 id로만 이어진다.

## 문제

- 설치한 앱은 core를 띄울 때 stderr를 버린다. log가 stderr로만 나가면 사람이 쓰다 겪은 문제를 나중에 볼 수 없다.
- 요청, log, ledger의 model 호출·tool call 기록이 서로 다른 id를 쓰면 한 장애를 따라가려고 세 군데를 눈으로 맞춰야 한다.
- core가 죽었는지, 떠 있는데 일을 못 받는지, 일부 기능만 빠졌는지 구분하는 값이 없으면 launcher와 사람이 같은 증상을 다르게 읽는다.
- 메모리 누수나 멈춤이 의심될 때 core 안을 볼 길이 없다.
- 새 개발자가 환경 문제(Node 판, `.env`, port 충돌, sandbox)를 하나씩 손으로 찾는다.
- log, trace, 오류에 secret이나 사람이 친 글이 섞여 나가면 기록 자체가 유출 경로가 된다.

## 목표와 비목표

- 목표: 모든 core log, span, 응답이 같은 모양의 id(W3C Trace Context, OTel)를 공유한다.
- 목표: 설치한 앱에서도 core log가 file로 남는다. 기록이 core의 일을 막지 않는다.
- 목표: 양이 많은 debug log와 span은 사람이 켠 동안만 남기고, 켜고 끄는 데 앱을 다시 띄우지 않는다.
- 목표: log, trace, 오류, snapshot 어디에도 secret과 사람이 친 글이 나가지 않는다.
- 목표: 같은 컴퓨터의 다른 process가 token 없이 core 내부 상태를 읽지 못한다.
- 비목표: OpenTelemetry SDK를 들이는 것. core는 `node:http` loopback API와 SQLite Worker라 auto-instrumentation이 거의 걸리지 않고, base는 바깥 import를 못 한다. 대신 id 모양과 OTLP JSON을 직접 만든다. 나중에 공식 SDK로 바꿔도 log와 header의 id는 그대로다.
- 비목표: 바깥 backend로 직접 내보내는 것. core의 network는 loopback뿐이다.
- 비목표: 서버나 실사용자가 없는 프로토타입이라 log 내보내기, 업로드, "폴더 열기" 단추는 두지 않는다. file에 남기는 데까지만 한다.

## 모델

### 한 process의 telemetry

core와 agent runtime child는 process마다 telemetry 하나(logger, tracer, meter)를 기동 때 만든다. wiring은 context로 받아 쓰고, 새로 stderr에 직접 쓰는 길을 만들지 않는다. 시각·id·무작위는 인자로 받는다. 바깥에서 telemetry를 넣어 core를 띄울 수도 있고, 그러면 log file 기록기는 없다.

base는 node를 모른다(id, traceparent, logger, tracer, meter, OTLP JSON 인코딩). core가 비동기 context 전달, stderr, loopback HTTP 전송을 붙인다.

### 요청과 trace

```
 요청 ─▶ API 입구: 받은 traceparent가 있으면 부모로 잇고, 없으면 새 trace
          server span "POST /resource/method" (활성 context에 올린다)
            │ gate(Host → Origin → Bearer)
            │ /healthz, /readyz ─▶ 상태 점검
            │ 나머지 ─▶ ledger writer command / reader read
            │            └ client span "ledger.command" / "ledger.read"
            ▼
          응답 header: traceparent, x-trace-id.  오류 body: { error: { code, message, hint, trace_id } }
          RED metric: http.server.requests, http.server.errors(5xx), http.server.request.duration(ms 히스토그램)
```

바깥 provider나 MCP로 나가는 요청에는 `traceparent`를 붙이지 않는다(loopback으로 가는 요청에만 붙는다).

앱 event의 발행(`app_events.publish`)은 요청이라 그 server span의 trace id를 갖는다. 그 id를 발행 기록(`app.event_publications`)과 그 발행이 부른 구독 handler 호출의 caller(`{kind: event, …, trace_id}`, `app.invocations`)에 같이 적어 한 발행과 거기서 나온 호출을 한 id로 잇는다. telemetry가 없는 조립은 id를 새로 만든다. 앱을 짓는 agent가 trace를 심지 않는다.

### log의 길

```
 log 호출 ─▶ { timestamp, level, service_name, trace_id?, span_id?, component, event, message?, fields? }
             redaction: credential pattern + 알려진 secret + key 이름(password, token, api_key …)
             ├▶ stderr 한 줄(json | pretty). LOPHN_LOG_LEVEL부터
             ├▶ log file 기록기 ─▶ <data root>/logs/core-N.jsonl. info부터, trace 설정이 켜지면 debug부터
             └▶ LOPHN_TELEMETRY=otlp면 OTLP /v1/logs에도(LOPHN_LOG_LEVEL부터)

 span 끝  ─▶ debug log 한 줄(component trace, event=span 이름, fields=duration_ms·status·attributes)
             위 log와 같은 길을 탄다. 아무도 debug를 받지 않으면 줄을 만들지 않는다.
             otlp면 span을 10초마다 /v1/traces로, metric은 /v1/metrics로 보낸다.

 agent runtime child ─▶ 자기 telemetry로 stderr에 JSON 한 줄(debug와 span 줄까지 늘).
             core가 줄마다 받아, record 모양이면 시각·service·trace id를 두고 글과 fields만 redaction해 위 길에 싣는다.
             모양이 아니면 `agent-runtime child_stderr` info 글로 싣는다.
```

알려진 secret 원문은 secret store가 열린 뒤에야 redaction에 붙는다. 그 전 log는 pattern 규칙과 key 이름 규칙만으로 가린다.

### log file

- 자리: `<data root>/logs/core-{0..4}.jsonl`. 10 MiB씩 5개를 돌려 쓴다. file은 0600, 폴더는 0700이고 여는 규칙은 platform log와 같다. 한 줄은 위 log record 하나다. agent runtime child의 줄도 같은 file에 `service_name: "lophn-agent-runtime"`으로 섞인다.
- 이름의 `core`는 `platform-*`(`diagnostics/list`가 읽는 안전 catalog 기록)와 섞이지 않게 한 것이다. `diagnostics/list`는 `core-*`를 읽지 않는다.
- 기록기는 비동기다. record를 queue에 두고 64 KiB씩 모아 쓴다. queue가 1 MiB를 넘거나 쓰기가 실패하면 그 record를 버리고 세며, 다음 record 앞에 `log records_dropped` 한 줄로 개수를 남긴다. 기록이 core의 일을 막지 않는다.
- file은 data root의 instance lock을 잡은 뒤에 열고, 그 전 record는 queue에 둔다. 못 열면 `telemetry log_files_unavailable` warn 한 줄을 남기고 core는 stderr만으로 돈다.
- redaction은 logger 한 곳에서 한다. file에 쓰는 것은 redaction을 마친 record뿐이고, child의 원문 줄은 core의 redaction을 거치기 전에는 어디에도 나가지 않는다.

### trace 설정

설정 `diagnostics.trace`(boolean, 기본 `false`, Settings › Diagnostics의 Trace 토글)가 켜지면 다음이 달라진다.

- core의 file 기록기가 debug log와 span 줄까지 받는다(꺼져 있으면 info부터). child는 늘 debug·span 줄을 stderr로 내고 core가 relay 때 이 설정으로 거른다.
- shell main이 터미널 trace(`<data root>/logs/terminal-trace.jsonl`)를 쓴다. 10 MiB를 넘기 전에 `terminal-trace.1.jsonl`로 넘겨 둘만 남긴다. 자세한 것은 terminal-agent.md.
- 앱을 다시 띄울 필요가 없다. core는 설정 값이 바뀌었다는 알림(settings.json을 손으로 고친 경우 포함)을 받는 자리에서 바로 trace를 바꾼다. shell main은 설정을 처음 쓸 때 읽어 두고 `SettingsChanged`가 오면 다시 읽는다. renderer는 main이 꺼져 있다고 답하면 5초 동안 모으지 않다가 다시 묻는다.
- 싣는 것은 이벤트 이름, id, 시간, 크기 같은 숫자뿐이다. 친 글, 터미널 출력, prompt, model 답은 어느 쪽에도 싣지 않는다.

### agent loop span

child 안의 agent loop가 span을 낸다(child의 tracer를 인자로 넘긴다. 전역은 없다).

| span | 시점 | 부모 | attribute |
|---|---|---|---|
| `agent.turn` | loop를 시작할 때 | 없다(turn마다 새 trace) | `lophn.session`, `lophn.turn`, `model.provider`. 끝에 `lophn.end`(finished·stopped·finish_failed), `lophn.outcome`(completed·failed), `lophn.reason`. 실패하면 status error |
| `agent.model_call` | model 시도 하나(retry도 따로) | `agent.turn` | `lophn.session`, `lophn.turn`, `lophn.model_call`, `lophn.purpose`, `lophn.attempt_kind`(initial·retry), `lophn.attempt_order`, `model.provider`, `model.name`. 끝에 `lophn.outcome`, `lophn.code`, `http.status_code`, `lophn.tokens.input\|output\|cache_read\|cache_write\|reasoning`(아는 것만). failed·partial·uncertain이면 status error |
| `agent.tool_call` | tool 호출 시도 하나(판정, 진입, 실행, 기록 한 번) | `agent.turn` | `lophn.session`, `lophn.turn`, `lophn.model_call`, `lophn.tool`(이번 turn이 제공한 tool 이름, 모르는 이름은 `unknown`), `lophn.tool_attempt`. 끝에 `lophn.tool_call`, `lophn.outcome`(success·failure·uncertain·not_executed), `lophn.code`. success가 아니면 status error |

- provider로 나가는 HTTP client span은 `agent.model_call` 아래에 달린다. 활성 context가 loop를 시작한 span에서 이어지기 때문이다.
- `lophn.*` id가 ledger의 `model_calls`·tool call 행과 log 한 줄을 이어 읽는 열쇠다.
- 진입 없이 닫히는 call(없는 tool, 잘못된 인자)은 span이 없다.

### 상태 점검

`/healthz`와 `/readyz`는 둘 다 `GET`이고 Bearer가 필요하다(gate가 다른 route와 같다).

- `/healthz` 200: `{status: "ok", service, uptime_s, pid, memory: {rss_mb, heap_used_mb, heap_total_mb, external_mb, array_buffers_mb}}`. 점검을 돌리지 않는다.
- `/readyz`: 구성 요소 점검(`diagnostics/status`와 같은 것)을 지금 돌리고 점검마다 `latency_ms`를 잰다.
  - `ready`(200): 모두 된다.
  - `degraded`(200): core와 ledger는 되고 나머지 일부가 안 된다. `degraded: [component]`.
  - `not_ready`(503): core가 아직 준비 전이거나, core나 ledger가 안 되거나, healthy한 ledger reader가 없다.
  - 그 밖 칸: `ledger.readers {healthy, unhealthy, closed}`, `event_loop {p50_ms, p99_ms, max_ms}`(마지막 `/readyz` 뒤로만 센다), `memory`.

### 오류 봉투

경계의 오류 body는 `code`, `message`에 더해 `hint`(code마다 고정 문장)와 `trace_id`(그 요청의 trace)를 싣는다. handler가 던진 것은 응답에는 `internal`로만 나가고, log에는 `api handler_threw` error 한 줄로 예외 종류와 저장소 안 첫 frame 위치만 남긴다. 원문 message와 stack 전체는 secret이 섞일 수 있어 남기지 않는다.

### 자원 snapshot

`kill -USR2 <core pid>`(pid는 `/healthz`)가 `<data root>/diagnostics/`(0700)에 남긴다. 한 번에 하나만 돈다. Windows에는 이 signal이 없어 걸지 않는다.

- `runtime-<at>-<pid>.json`: memory, v8 heap·space 통계, resourceUsage, cpuUsage, event loop를 붙든 자원 종류별 개수.
- `cpu-<at>-<pid>.cpuprofile`: 5초 CPU profile(Chrome DevTools, speedscope).
- `heap-<at>-<pid>.heapsnapshot`: `LOPHN_HEAP_SNAPSHOT=1`일 때만. 쓰는 동안 core가 멈춘다.

요약은 secret 없는 숫자뿐이다. heap snapshot과 profile은 메모리 원문을 담을 수 있어 0600이고 data root 밖으로 내보내지 않는다.

### `npm run doctor`

개발 환경 점검이다. 점검 하나가 `{id, title, run}`이고 동시에 돈다(점검마다 5초). 결과는 `PASS [✓]`·`WARN [!]`·`FAIL [✗]`와 저장소 root에서 바로 칠 수 있는 `fix:` 명령이다. FAIL이 있으면 exit 1.

- 점검: Node ≥ 24.2.0, npm ≥ 11, git, Electron binary와 `Temporal`, Electron sandbox(apparmor userns), `.env` 대 `.env.example`(빠진 key, 모르는 key, 형식, mode 0600. 값은 보이지 않는다), telemetry env 형식, `package-lock.json`과 설치본, 필수 binary(biome, tsc, esbuild, `pty.node`), dev data root(0700, 소유자), port 7431·7499 충돌과 주인, 떠 있는 core의 `/readyz`, 바깥 TCP 연결(registry.npmjs.org, models.dev, provider host).
- `--fix`는 되돌릴 수 있는 로컬 일만 한다(`.env` 복사 0600, chmod, `.cache` 만들기). sudo나 install은 명령만 보인다.
- provider로는 TCP 연결만 연다. key를 실은 요청은 보내지 않는다.

## 지키는 것

1. 로그, span attribute, 오류 응답, snapshot 요약 어디에도 대화 글, prompt, reasoning, tool 입력과 결과, 터미널 출력, 오류 원문 message, URL이 실리지 않는다. span attribute는 id, 이름, 종류, 숫자뿐이고 기계 code가 아닌 글은 `other`로 가린다.
2. log file과 stderr에 나가는 모든 record는 redaction(credential pattern, 알려진 secret, key 이름)을 거친다. agent runtime child의 원문 줄도 core의 redaction을 거치기 전에는 어디에도 나가지 않는다.
3. log file 기록은 core의 일을 막거나 늦추지 않는다. 밀리면 버리고 그 개수를 다음 record 앞에 남긴다. 기록기를 못 열어도 core는 stderr만으로 돈다.
4. info 이상은 늘 file에 남고 debug와 span은 `diagnostics.trace`가 켜진 동안만 남는다. 이 설정은 앱이나 core를 다시 띄우지 않고 적용된다.
5. 모든 API 응답에 `traceparent`와 `x-trace-id`가 붙고, 오류 body의 `trace_id`는 그 요청의 trace다. 받은 `traceparent`가 있으면 그 trace를 잇는다.
6. `/healthz`와 `/readyz`는 Bearer 없이 답하지 않는다. Host·Origin 검사는 다른 route와 같다.
7. `/readyz`는 core나 ledger가 안 되거나 healthy한 reader가 없으면 503이고, 그 밖의 일부 구성 요소가 안 되면 200 `degraded`다.
8. OTLP는 loopback http 목적지에만 보낸다. 수집기가 꺼져 있거나 느려도 core는 그대로 돈다.
9. 틀린 telemetry env 값은 기동을 막지 않는다. 기본값으로 두고 `telemetry config_ignored` warn 한 줄을 남긴다. `otlp`인데 endpoint가 없거나 loopback http가 아니면 `off`로 내린다.
10. 핸들러가 던진 예외는 응답에 `internal`로만 나간다. 원문 message와 stack 전체는 log에도 없다.
11. 자원 snapshot과 profile은 0600이고 data root 밖으로 나가지 않으며, 한 번에 하나만 돈다.
12. `npm run doctor --fix`는 되돌릴 수 있는 로컬 일만 한다. 점검은 값(secret)을 보이지 않고, provider에는 key를 실은 요청을 보내지 않는다.

## 경계와 계약

boundary: `diagnostics`(운영 log, crash 기록, 상태 점검, telemetry, 자원 snapshot), `server`(API 입구의 span, header, 오류 봉투).

core process env:

| env | 값 | 기본 |
|---|---|---|
| `LOPHN_TELEMETRY` | `off` · `otlp`(OTLP 전송만 켠다. log file과 trace 설정과는 무관) | `off` |
| `LOPHN_LOG_LEVEL` | `debug` · `info` · `warn` · `error`(stderr와 OTLP log의 최저 level. log file은 info 이상, trace가 켜지면 debug 이상) | `info` |
| `LOPHN_LOG_FORMAT` | `json` · `pretty` | `json` |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | `http://<loopback>:<port>`(예 `http://127.0.0.1:4318`) | 없음 |
| `LOPHN_HEAP_SNAPSHOT` | `1`이면 SIGUSR2 때 heap snapshot도 | 없음 |

- 설정: `diagnostics.trace`(boolean, 기본 `false`).
- HTTP: `GET /healthz`, `GET /readyz`(Bearer). 응답 header `traceparent`, `x-trace-id`. 오류 body `{error: {code, message, hint, trace_id}}`.
- OTLP/HTTP JSON: `/v1/traces`, `/v1/logs`, `/v1/metrics`(loopback 수집기). 10초마다와 종료 때 보낸다.
- 저장: `<data root>/logs/core-{0..4}.jsonl`, `<data root>/logs/terminal-trace.jsonl`(+ `.1`), `<data root>/diagnostics/{runtime,cpu,heap}-*`.
- 이름: log record 모양 `{timestamp, level, service_name, trace_id?, span_id?, component, event, message?, fields?}`. span 이름 `agent.turn`, `agent.model_call`, `agent.tool_call`. 기록 event `log records_dropped`, `telemetry log_files_unavailable`, `telemetry config_ignored`, `telemetry otlp_export_failed`, `api handler_threw`, `agent-runtime child_stderr`.
- id 모양: trace 32 hex, span 16 hex.
- OTLP buffer: span과 log 각 2048개. 내보내기 timeout 2초.
- 수집기에 보낸 batch가 실패하면 다시 보내지 않고 버린다. 실패 warn은 연속 실패 동안 한 번만 남기고 성공하면 다시 셀 수 있다. metric은 cumulative라 다음 차례에 전체가 다시 간다.
- OTLP 목적지는 loopback만 받는다. 바깥 backend로 보내려면 loopback에 수집기(OTel Collector 등)를 띄워 그쪽이 내보낸다.

## 결정

- OpenTelemetry SDK를 들이지 않고 W3C Trace Context와 OTLP JSON 모양을 직접 만든다. 이유: core는 `node:http` loopback API와 SQLite Worker라 auto-instrumentation이 거의 걸리지 않고, base는 바깥 import를 못 한다. 버린 안: `@opentelemetry/*` 6~8개 의존. (agent)
- `/healthz`와 `/readyz`도 Bearer를 요구한다. 이유: 같은 컴퓨터의 사용자 앱이나 agent가 띄운 명령이 token 없이 core 내부 상태를 읽지 않게 한다. Host·Origin 검사가 브라우저(DNS rebinding, WebSocket)를 막는다. 버린 안: `/healthz` 무인증. (agent)
- OTLP는 loopback 수집기에만 보낸다. 이유: core의 network는 loopback뿐이라는 규칙을 telemetry도 지킨다. 바깥 backend는 수집기가 내보낸다. (agent)
- 바깥 provider·MCP로 가는 요청에는 `traceparent`를 붙이지 않는다. (agent)
- 늘 기록(info부터)과 trace(debug·span)를 나눈다. 이유: info 이상은 양이 적어 늘 남기고, 양이 많은 debug·span은 사람이 켠 동안만 남긴다. 버린 안: 시작 env로 켜기(설치한 앱은 env를 줄 수 없고 껐다 켜야 한다). (agent)
- child는 늘 debug·span을 stderr로 내고 core가 trace 설정으로 거른다. 이유: child에 설정을 알리는 길이 없어도 바로 적용된다. 버린 안: child에 설정 변경 보내기. (agent)
- shell main은 trace 설정을 알림으로 미리 읽지 않고 처음 쓸 때 읽고, 알림이 오면 다시 읽는다. 이유: core가 아직 안 떠도 시작 순서를 따지지 않는다. (agent)
- 로그 내보내기, 폴더 열기 단추, OTLP 변경은 하지 않는다(`console` mode 제거만 했다). 이유: 서버도 실사용자도 없는 프로토타입이라 file에 남기는 데까지만 한다. (사람)
- core log file 이름은 `core-*`로 하고 `diagnostics/list`가 읽지 않는다. 이유: `platform-*`(안전 catalog 기록)와 섞이지 않게 한다. (agent)
- redaction은 logger 한 곳에서 한다. 이유: stderr, file, OTLP, child relay가 같은 규칙을 거치게 하려고 길마다 따로 가리지 않는다. (agent)
- `LOPHN_TELEMETRY=console`과 `LOPHN_TERMINAL_TRACE`는 없앴다. 이유: trace 설정이 대신한다. 틀린 `otlp` 설정은 `console`이 아니라 `off`로 내린다. (agent)
- `npm run dev`·`npm run doctor`는 Linux 전용으로 둔다. 이유: 사람이 Linux에서만 개발한다. (agent)

## 열린 것

- 설치한 앱(packaged)에서 `core-*.jsonl`이 실제로 생기는지는 아직 보지 않았다.
- `agent-usage/read`의 `missing_records`와 `complete`는 고정값이라 기록이 빠진 호출을 알리지 못한다. 설계와 맞는지 확인이 필요하다(flow catalog의 unclear).
- `model-calls/read` 핸들러가 자격을 보지 않아 agent 자격이 다른 session의 model 호출을 읽을 수 있는지는 credential의 operation 목록에 달렸다. 확인이 필요하다.
- ledger의 model 호출 기록을 시작 상태로 쓰는 route 하나는 호출하는 곳이 코드에 없다. 죽은 route로 보이고 지울지 정할 일이다.
- 오류 본문과 읽지 못한 성공 본문을 한 글자도 남기지 않는 규칙은 코드 주석에만 있다(이슈 `provider-failure-body-not-kept`).
