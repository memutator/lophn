# observability

core daemon의 log·trace·metric, 상태 점검(`/healthz`·`/readyz`), 자원 snapshot, 오류 봉투, 개발 환경 점검(`npm run doctor`)이 어디서 생기고 어디로 가는가. 제품 기록(ledger)과 운영 진단 log(`<data root>/logs/platform-*.jsonl`, `diagnostics/list`)는 여기 없다. 그 둘은 그대로다.

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
          └▶ stderr 한 줄 (json | pretty)
          └▶ LOPHN_TELEMETRY=otlp면 OTLP /v1/logs에도

 span·metric ─▶ off: 버림 / console: span 하나를 debug log 한 줄로 / otlp: 10초마다 POST /v1/traces, /v1/metrics
```

- base(`packages/base/telemetry/`)는 node를 모른다: id, traceparent, logger, tracer, meter, OTLP JSON 인코딩. core(`packages/core/diagnostics/telemetry.ts`)가 AsyncLocalStorage, stderr, `node:http` 전송을 붙인다.
- id 모양은 W3C Trace Context와 OTel 그대로다(trace 32 hex, span 16 hex). 나중에 공식 SDK로 바꿔도 log와 header의 id는 그대로다.
- telemetry는 기동마다 `startCore`가 한 번 만든다(`CoreOptions.telemetry`로 넣을 수 있다). wiring은 `ctx.telemetry`로 받는다. `console.error`를 새로 쓰지 않는다.

## 설정 (core process env)

| env | 값 | 기본 |
|---|---|---|
| `LOPHN_TELEMETRY` | `off` · `console` · `otlp` | `off` |
| `LOPHN_LOG_LEVEL` | `debug` · `info` · `warn` · `error` | `info` |
| `LOPHN_LOG_FORMAT` | `json` · `pretty` | `json` |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | `http://<loopback>:<port>` (예 `http://127.0.0.1:4318`) | 없음 |
| `LOPHN_HEAP_SNAPSHOT` | `1`이면 SIGUSR2 때 heap snapshot도 | 없음 |

- 틀린 값은 기동을 막지 않는다. 기본값으로 두고 `telemetry config_ignored` warn 한 줄을 남긴다. `otlp`인데 endpoint가 없거나 loopback http가 아니면 `console`로 내린다.
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
