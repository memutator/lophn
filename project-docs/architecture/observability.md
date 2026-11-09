# observability

core daemon의 log·trace·metric, 상태 점검(`/healthz`·`/readyz`), 자원 snapshot, 오류 봉투, 개발 환경 점검(`npm run doctor`)이 어디서 생기고 어디로 가는가. 제품 기록(ledger)과 운영 진단 log(`<data root>/logs/platform-*.jsonl`, `diagnostics/list`)는 여기 없다. 그 둘은 그대로다. core의 구조화 log는 `<data root>/logs/core-*.jsonl`에 늘 남는다(아래 "log file").

## 흐름

```
 요청 ─▶ startApiServer.onRequest (core/server/server.ts)
          traceparent 받으면 부모로 잇고, 없으면 새 trace
          server span "POST /resource/method"  ── AsyncLocalStorage에 올림 (core/diagnostics/telemetry.ts)
            │ gate(Host → Origin → Bearer)
            │ /healthz, /readyz ─▶ Health (core/diagnostics/health.ts)
            │ 나머지 ─▶ dispatchHttp ─▶ writer.command / readers.read
            │                            └ client span "ledger.command" / "ledger.read" (core/diagnostics/spans.ts)
            ▼
          응답 header: traceparent, x-trace-id.  오류 body: { error: { code, message, hint, trace_id } }
          RED: http.server.requests, http.server.errors(5xx), http.server.request.duration(ms 히스토그램)

 log ─▶ ctx.telemetry.logger (base/telemetry/log.ts)
          { timestamp, level, service_name, trace_id?, span_id?, component, event, message?, fields? }
          redaction: credential pattern(base/redaction/patterns.ts) + 알려진 secret + key 이름(password, token, api_key …)
          ├▶ stderr 한 줄 (json | pretty), LOPHN_LOG_LEVEL부터
          ├▶ 기록기 ─▶ <data root>/logs/core-N.jsonl (JSON 한 줄). info부터, 설정 diagnostics.trace가 켜지면 debug부터
          └▶ LOPHN_TELEMETRY=otlp면 OTLP /v1/logs에도 (LOPHN_LOG_LEVEL부터)

 span ─▶ 끝날 때마다 debug log 한 줄(component trace, event=span 이름, fields=duration_ms·status·attributes)
         ├ 위 log와 같은 길: trace가 켜져 있을 때만 file에 남는다. 아무도 debug를 받지 않으면 줄을 만들지 않는다
         └ otlp면 10초마다 POST /v1/traces. metric은 /v1/metrics

 agent runtime child ─▶ 자기 telemetry로 stderr에 JSON 한 줄(debug와 span 줄까지 늘). 감독이 줄 단위로 core에 넘기면
                         relayChildLine이 record 모양이면 시각·service·trace id를 두고 글·fields만 redaction해 위 log 길에 싣고,
                         아니면 `agent-runtime child_stderr` info 글로 싣는다
```

- base(`packages/base/telemetry/`)는 node를 모른다: id, traceparent, logger, tracer, meter, OTLP JSON 인코딩. core(`packages/core/diagnostics/telemetry.ts`)가 AsyncLocalStorage, stderr, `node:http` 전송을 붙인다.
- id 모양은 W3C Trace Context와 OTel 그대로다(trace 32 hex, span 16 hex). 나중에 공식 SDK로 바꿔도 log와 header의 id는 그대로다.
- telemetry는 기동마다 `startCore`가 한 번 만든다(`CoreOptions.telemetry`로 넣을 수 있다. 넣으면 log file 기록기는 없다). wiring은 `ctx.telemetry`로 받는다. `console.error`를 새로 쓰지 않는다.
- 알려진 secret 원문은 secret store가 열린 뒤 `useRedactor`로 붙는다(secrets wiring). 그 전 log는 pattern 규칙과 key 이름 규칙만으로 가린다.

## log file과 trace 설정

설치된 앱은 core의 stderr를 버리므로(launcher가 `stdio: ignore`) core log의 정본은 file이다.

- `<data root>/logs/core-{0..4}.jsonl`: 10 MiB씩 5개를 돌려 쓴다. 파일 0600, 폴더 0700, 열기 규칙은 platform log와 같다(`createLogFiles(root, platform, "core")`). 한 줄은 `LogRecord`(timestamp, level, service_name, trace_id?, span_id?, component, event, message?, fields?)다. agent runtime child의 줄도 같은 file에 `service_name: "lophn-agent-runtime"`으로 섞인다.
- 기록기(`core/diagnostics/record.ts`)는 비동기다. record를 queue에 두고 64 KiB씩 모아 쓴다. queue가 1 MiB를 넘거나 쓰기가 실패하면 그 record를 버리고 세며, 다음 record 앞에 `log records_dropped` 한 줄로 개수를 남긴다. 기록이 core의 일을 막지 않는다. file은 instance lock을 잡은 뒤에 열고, 그 전 record는 queue에 둔다. 못 열면 `telemetry log_files_unavailable` warn 한 줄이고 core는 stderr만으로 돈다.
- file 이름의 `core`는 `platform-*`(`diagnostics/list`가 읽는 안전 catalog 기록)와 섞이지 않게 한 것이다. `diagnostics/list`는 `core-*`를 읽지 않는다.
- redaction은 stderr와 같은 logger 한 곳에서 한다. file에 쓰는 것은 redaction을 마친 record뿐이고, child의 원문 줄은 core의 redaction을 거치기 전에는 어디에도 나가지 않는다.

설정 `diagnostics.trace`(boolean, 기본 `false`, Settings › Diagnostics의 Trace 토글)가 켜지면:

- core의 기록기가 debug log와 span 줄을 받는다(꺼져 있으면 info부터). child는 늘 debug·span 줄을 stderr로 내므로 core가 relay 때 거른다.
- shell main이 터미널 trace(`<data root>/logs/terminal-trace.jsonl`)를 쓴다. 10 MiB를 넘기 전에 `terminal-trace.1.jsonl`로 넘겨 둘만 남긴다. 자세한 것은 terminal-agent.md.
- 앱을 다시 띄울 필요가 없다. core는 설정 store가 값이 바뀌었다고 알리는 자리(config wiring의 publish)에서 `telemetry.setTrace`를 부르고, 그 값은 settings.json을 손으로 고쳐도 따른다. shell main은 설정을 처음 쓸 때 읽어 두고 `SettingsChanged`가 오면 다시 읽는다. renderer는 main이 꺼져 있다고 답하면 5초 동안 모으지 않다가 다시 묻는다.
- 싣는 것은 이벤트 이름, id, 시간, 크기 같은 숫자다. 친 글, 터미널 출력, prompt, model 답은 어느 쪽에도 싣지 않는다.

## agent loop span

child 안의 agent loop가 span을 낸다(child의 tracer를 인자로 넘긴다. 전역은 없다).

| span | 어디서 | 부모 | attribute |
|---|---|---|---|
| `agent.turn` | `run-loop/driver.ts`가 loop를 시작할 때 | 없다(turn마다 새 trace) | `lophn.session`, `lophn.turn`, `model.provider`. 끝에 `lophn.end`(finished·stopped·finish_failed), `lophn.outcome`(completed·failed), `lophn.reason`. 실패하면 status error |
| `agent.model_call` | `run-loop/core-ports.ts` 모델 시도 하나(retry도 따로) | `agent.turn` | `lophn.session`, `lophn.turn`, `lophn.model_call`, `lophn.purpose`, `lophn.attempt_kind`(initial·retry), `lophn.attempt_order`, `model.provider`, `model.name`. 끝에 `lophn.outcome`, `lophn.code`, `http.status_code`, `lophn.tokens.input|output|cache_read|cache_write|reasoning`(아는 것만). failed·partial·uncertain이면 status error |
| `agent.tool_call` | 같은 file의 `attempt`(판정→진입→실행→기록 한 번) | `agent.turn` | `lophn.session`, `lophn.turn`, `lophn.model_call`, `lophn.tool`(이번 turn이 제공한 tool 이름, 모르는 이름은 `unknown`), `lophn.tool_attempt`. 끝에 `lophn.tool_call`, `lophn.outcome`(success·failure·uncertain·not_executed), `lophn.code`. success가 아니면 status error |

- provider로 나가는 HTTP client span(`tracedFetch`)은 `agent.model_call` 아래에 달린다. AsyncLocalStorage context가 loop가 시작된 span에서 이어지기 때문이다.
- id가 ledger의 `model_calls`·tool call 행과 이어 읽는 열쇠다. 진입 없이 닫히는 call(없는 tool, 잘못된 인자)은 `tools.close`로 가서 span이 없다.
- attribute에는 대화 글, prompt, reasoning, tool 입력과 결과, 오류 message, URL을 싣지 않는다(`run-loop/spans.ts`가 만드는 값은 id·이름·종류·숫자뿐이다. 기계 code가 아닌 글은 `other`로 가린다).

## 설정 (core process env)

| env | 값 | 기본 |
|---|---|---|
| `LOPHN_TELEMETRY` | `off` · `otlp` (OTLP 전송만 켠다. log file과 trace 설정과는 무관) | `off` |
| `LOPHN_LOG_LEVEL` | `debug` · `info` · `warn` · `error` (stderr와 OTLP log의 최저 level. log file은 info 이상, trace가 켜지면 debug 이상이다) | `info` |
| `LOPHN_LOG_FORMAT` | `json` · `pretty` | `json` |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | `http://<loopback>:<port>` (예 `http://127.0.0.1:4318`) | 없음 |
| `LOPHN_HEAP_SNAPSHOT` | `1`이면 SIGUSR2 때 heap snapshot도 | 없음 |

- 틀린 값은 기동을 막지 않는다. 기본값으로 두고 `telemetry config_ignored` warn 한 줄을 남긴다. `otlp`인데 endpoint가 없거나 loopback http가 아니면 `off`로 내린다.
- OTLP 목적지는 loopback만 받는다. core의 network는 loopback뿐이라는 규칙(`tools/check-source.ts`의 EXTERNAL_FETCH)을 telemetry도 지킨다. 바깥 backend로 보내려면 loopback에 수집기(OTel Collector 등)를 띄워 그쪽이 내보낸다.
- 수집기가 꺼져 있어도 core는 돈다. 실패는 `otlp_export_failed` warn 한 번만 남기고, buffer(2048개)를 넘는 span·log는 버린다. metric은 cumulative라 다음 차례에 다시 다 간다.

## `/healthz`, `/readyz`

둘 다 `GET`이고 Bearer가 있어야 한다. gate가 다른 route와 같다. 무인증으로 열지 않은 이유: 같은 컴퓨터의 다른 process(사용자 앱, agent가 띄운 명령)가 token 없이 core 내부 상태를 읽지 않게 한다. Host·Origin 검사가 브라우저(DNS rebinding, WebSocket)를 막는다.

- `/healthz` 200: `{status: "ok", service, uptime_s, pid, memory: {rss_mb, heap_used_mb, heap_total_mb, external_mb, array_buffers_mb}}`. 점검을 돌리지 않는다.
- `/readyz`: 구성 요소 점검(`ctx.componentChecks`, `diagnostics/status`와 같은 것)을 지금 돌린다. 점검마다 `latency_ms`.
  - `ready`(200): 모두 된다.
  - `degraded`(200): core·ledger는 되고 나머지 일부가 안 된다. `degraded: [component]`.
  - `not_ready`(503): `ctx.ready`가 아니거나, core·ledger가 안 되거나, healthy reader가 없다.
  - 그 밖 칸: `ledger.readers {healthy, unhealthy, closed}`, `event_loop {p50_ms, p99_ms, max_ms}`(마지막 `/readyz` 뒤로만), `memory`.

## 오류 봉투

경계의 오류 body(`errorBodySchema`, `packages/protocol/base/errors.ts`)는 `code`, `message`에 더해 `hint`(code마다 고정 문장)와 `trace_id`(그 요청의 trace)를 싣는다. handler가 던진 것은 응답에는 `internal`로만 나가고, log에는 `api handler_threw` error 한 줄로 `exception.type`과 저장소 안 첫 frame(`code.location`)만 남긴다. 원문 message와 stack 전체는 secret이 섞일 수 있어 남기지 않는다.

## 자원 snapshot

`kill -USR2 <core pid>`(pid는 `/healthz`)가 `<data root>/diagnostics/`(0700)에 남긴다. 한 번에 하나만 돈다.

- `runtime-<at>-<pid>.json`: memory, v8 heap·space 통계, resourceUsage, cpuUsage, event loop를 붙든 자원 종류별 개수(`process.getActiveResourcesInfo`).
- `cpu-<at>-<pid>.cpuprofile`: 5초 CPU profile(Chrome DevTools, speedscope).
- `heap-<at>-<pid>.heapsnapshot`: `LOPHN_HEAP_SNAPSHOT=1`일 때만. 쓰는 동안 core가 멈춘다.

heap snapshot과 profile은 메모리 원문을 담을 수 있어 0600이고 data root 밖으로 내보내지 않는다.

## `npm run doctor`

`tools/doctor/`. 점검 하나가 `{id, title, run(ctx)}`이고 동시에 돈다(점검마다 5초). 결과는 `PASS [✓]`·`WARN [!]`·`FAIL [✗]`와 저장소 root에서 바로 칠 수 있는 `fix:` 명령. FAIL이 있으면 exit 1.

- 점검: Node ≥ 24.2.0, npm ≥ 11, git, Electron binary와 `Temporal`, Electron sandbox(apparmor userns), `.env` 대 `.env.example`(빠진 key, 모르는 key, 형식, mode 0600. 값은 보이지 않는다), telemetry env 형식, `package-lock.json`과 설치본, 필수 binary(biome, tsc, esbuild, `pty.node`), dev data root(0700, 소유자), port 7431·7499 충돌과 주인, 떠 있는 core의 `/readyz`, 바깥 TCP 연결(registry.npmjs.org, models.dev, provider host).
- `--fix`: 되돌릴 수 있는 로컬 일만 한다(`.env` 복사 0600, chmod, `.cache` 만들기). sudo나 install은 명령만 보인다.
- provider로는 TCP 연결만 연다. key를 실은 요청은 보내지 않는다.
