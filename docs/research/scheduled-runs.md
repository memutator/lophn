---
type: research
concerns: [lophn-agent/scheduling]
---
# 주기 실행

## 질문

주기 실행을 cron 식·간격·첫 시각 중 무엇으로 적고, 잠든 동안 놓친 회차와 아직 안 끝난 run이 겹칠 때 무엇을 하며, 실패가 쌓이면 누가 멈추고 누가 다시 켜나. 회차 계산과 heartbeat가 model을 부르는지, 테스트는 시계를 어떻게 바꾸나.

## 프로젝트별

### OpenClaw (37efa0b4a644)

cron job은 agent 소유다. agent id를 정할 수 없으면 throw. 근거: `openclaw:src/cron/agent-id.ts` `resolveCronJobEffectiveAgentId`.

- 주기 종류는 `at`(한 번), `every`, `cron`, `on-exit`, `stream` 다섯이다. `coerceSchedule`이 kind를 소문자로 맞추고 그 kind가 아닌 필드를 지운다. `everyMs`는 1 이상만 남기고 내림, `anchorMs`는 0 이상. 근거: `openclaw:src/cron/normalize.ts` `coerceSchedule`. cron 식은 `croner`로 파싱하고, timezone이 없으면 `Intl.DateTimeFormat().resolvedOptions().timeZone`으로 떨어진다. 근거: `openclaw:src/cron/schedule.ts` `resolveCronTimezone`. `every`의 다음 시각은 `anchor + (floor(elapsed / everyMs) + 1) * everyMs`. 근거: 같은 파일 `computeNextRunAtMs`.
- 재시작 때 놓친 job은 `runMissedJobs`가 따라잡는다. 한 번의 재시작에 최대 5개, 5초 간격, agent job은 2분 미룬다. 근거: `openclaw:src/cron/service/timer-catchup.ts` `runMissedJobs`, `openclaw:src/cron/service/timer-execution-timeout.ts` `DEFAULT_MAX_MISSED_JOBS_PER_RESTART`(5), `DEFAULT_MISSED_JOB_STAGGER_MS`(5000), `DEFAULT_STARTUP_DEFERRED_MISSED_AGENT_JOB_DELAY_MS`(120000). 최근 하나만 실행하는 방식이 아니다.
- 진행 중 job은 그 tick의 실행 대상에서 빠진다. `isRunnableJob`은 `hasActiveCronRun`이 참이면 `false`를 돌려준다. 근거: `openclaw:src/cron/service/timer-runnable.ts` `isRunnableJob`(65–82행). 슬롯을 소비한 기록은 아니다. 다음 계산에서 아직 due면 다시 대상이 된다. 같은 job을 다른 프로세스가 이미 돌리고 있으면 receipt 선점에서 `CronRunReceiptConflictError`("cron job ... is already running in process ...")가 난다. 근거: `openclaw:src/cron/store/run-receipt-store.ts` `CronRunReceiptConflictError`(89행). 멈춘 표시는 2시간(`CRON_STUCK_RUN_MS`)이 지나면 지운다(같은 파일 87행, `jobs-scheduling.ts` `normalizeJobTickState` 512–526행).
- 실패 멈춤은 두 갈래다. run 실패는 연속 10회, 다음 시각 계산 실패는 연속 3회. 주석: "Run failures get more room than schedule errors (10 vs. 3) because provider and network errors are often transient, and restart-interrupted runs count too." 근거: `openclaw:src/cron/service/auto-disable.ts` `MAX_CONSECUTIVE_RUN_FAILURES`(10), `maybeAutoDisableCronJobAfterRunFailure`; `openclaw:src/cron/service/jobs-scheduling.ts` `MAX_SCHEDULE_ERRORS`(3), `recordScheduleComputeError`. 대상은 `cron`·`every`뿐이고 system monitor 선언은 제외한다. 멈추면 `enabled = false`, `nextRunAtMs` 제거, `state.autoDisabled = { reason, atMs, consecutiveErrors }`를 남기고 `openclaw automations enable <id>`로 다시 켜라고 알린다. 계산이 성공하면 `scheduleErrorCount`를 0으로 지운다. 근거: `openclaw:src/cron/service/timer-outcomes.ts` 565행.
- 회차 계산은 model을 부르지 않는다. `computeNextRunAtMs`는 시각 산술이다. heartbeat는 부른다. 기본 간격 `30m`, 응답 상한 300자. scratch 파일이 헤더·빈 목록·펜스 표시만이면 부르지 않지만, 파일이 없으면 비어 있다고 보지 않아 model이 판단한다. 근거: `openclaw:src/auto-reply/heartbeat.ts` `DEFAULT_HEARTBEAT_EVERY`(26행), `isHeartbeatContentEffectivelyEmpty`(49–80행). heartbeat task는 cron job으로 옮겨 타며 payload는 `systemEvent`다. 근거: `openclaw:src/cron/heartbeat-task.ts` `heartbeatTaskDeclarationKey`.
- 정의가 바뀌면 따라잡기 기준이 바뀐다. `scheduleActivatedAtMs` 이전 슬롯은 놓친 회차로 치지 않는다. 근거: `timer-runnable.ts` `hasMissedCronSlotSinceLastRun`(58–62행). 정의 hash는 `updatedAtMs`와 `state`를 빼고 계산한다. 근거: `openclaw:src/cron/config-revision.ts` `resolveCronJobConfigRevision`.
- 오류 뒤 다음 시각은 backoff 바닥 이후로 민다. 근거: `jobs-scheduling.ts` `recomputeJobNextRunAtMs`(541–553행), `DEFAULT_ERROR_BACKOFF_SCHEDULE_MS`. 간격 값 자체는 [미확인].

### Hermes (343500b3547e)

주기는 job 하나의 필드로, `once`·`interval`·`cron` 셋이다.

- `parse_schedule`이 자연어("every monday 9am", "every 30m", "in 30m"), 5–6칸 cron 식(croniter, 요일·월 이름 허용), ISO 시각을 받아 종류를 정한다. 시각에 timezone이 없으면 그 profile의 Hermes timezone을 붙인다. 근거: `hermes-agent:cron/jobs.py` `parse_schedule`(784–860행), `hermes-agent:hermes_time.py` `get_timezone`(129–131행), `now`. 서버 로컬 시각이 아니다.
- 따라잡기는 기본 한 번이다. grace(주기의 절반, 120초–2시간) 안에 늦으면 그대로 실행하고, 넘으면 `next_run_at`을 앞으로 당긴 뒤 `cron.catch_up_missed`(기본 `true`)가 켜져 있으면 지금 한 번 실행하고 꺼져 있으면 `record_cron_missed`만 남긴다. 근거: `hermes-agent:cron/jobs.py` `_fast_forward_missed_recurring`(약 3130–3160행), `_cron_config_number("catch_up_missed", True)`, `ONESHOT_GRACE_SECONDS`(111행, 120), grace 범위(934–944행). 한 번짜리(`once`)는 grace를 넘기면 실행하지 않고 진단만 남기고 은퇴한다(`_retire_expired_oneshot`).
- tick은 파일 lock 하나다. lock을 못 얻으면 0을 돌려주고 끝난다. 반복 job은 dispatch 전에 `next_run_at`을 먼저 앞으로 당긴다. 죽어서 다시 떠도 같은 회차를 또 쏘지 않으려는 것이다. 근거: `hermes-agent:cron/scheduler_tick.py` `tick`, `_acquire_tick_lock`. 진행 중이면 "Job '%s' already running — skipping"을 남기고 그 회차는 due인 채로 둔다. dispatch가 실패하면 claim을 풀어 다음 tick이 다시 시도한다. 근거: `hermes-agent:cron/scheduler.py` 4311행, `try_register_running_job`. claim TTL 300초, 이른 실행 허용 60초. 근거: `hermes-agent:cron/constants.py` `FIRE_CLAIM_TTL_SECONDS`(9행), `FIRE_CLAIM_SKEW_SECONDS`(13행).
- 중복 방지는 `(job_id, scheduled_instant, status='completed')` 행이다. 이미 끝난 슬롯을 또 만나면 ledger 행 없이 로그만 남긴다. 근거: `hermes-agent:cron/occurrences.py` `completed_occurrence`(44–47행, 68행). 판(revision)이 없어 주기만 같고 내용이 바뀐 job이 같은 키를 쓸 수 있다.
- 실패는 멈추지 않는다. `failure_streak`가 성공이면 0, 실패면 증가하고, `cron.failure_nudge_threshold`(기본 3, 0이면 끔)에 닿으면 실패 메시지에 `hermes cron pause`를 권하는 문장을 붙일 뿐이다. 근거: `hermes-agent:cron/scheduler.py` `_failure_streak_nudge`(147–176행). `delivery_error`는 streak에 안 더하고, model에 닿기 전 실패(`model_unreachable`)는 한 주기를 기다리지 않고 이른 재시도를 잡는다. 근거: `hermes-agent:cron/jobs.py` `mark_job_run`(2466–2520행), `hermes-agent:cron/unreachable_retry.py`. provider 429는 `quota_hold_seconds` 동안 그 job만 세운다.
- 회차 계산은 croniter와 시각 산술이다. model을 부르는 것은 job 본문 실행이다. 근거: `hermes-agent:cron/scheduler_prompt.py` `_build_job_prompt`(280행). fallback provider는 `cron.model`·`cron.model_provider`. heartbeat라는 이름의 별도 주기는 못 찾았다 [미확인].
- `hermes pause`는 새 dispatch만 멈추고 이미 돌아 중인 run은 건드리지 않는다. 근거: `scheduler_tick.py` tick의 ESTOP 처리.

### Pi (83692682f095)

주기 실행이 없다. `packages/durable`의 `TaskScheduler`는 작업 상태 기계(pending·running·waiting·completing)지 cron이 아니다. 근거: `pi:packages/durable/src/harness/scheduler.ts`.

시계만 가져올 만하다. harness는 `options.now ?? Date.now`로 시각 함수를 받는다. 근거: `pi:packages/durable/src/harness/harness.ts` 179행. 테스트가 고정 시각을 넣을 수 있다. subagent는 호출마다 자식을 만들고 끝나면 두며, 재위임만 막는다(`replay: "safe"`). 근거: `pi:packages/coding-agent/src/experimental/durable/subagent.ts` `Subagent`(26–55행).

### Gemini CLI (fb972b2f87fe)

주기 실행이 없다. `scheduleAgentTools`는 agent가 낸 tool call 배치를 한 scheduler에 넘겨 실행하고 끝나면 `dispose`한다. 근거: `gemini-cli:packages/core/src/agents/agent-scheduler.ts` `scheduleAgentTools`(50–93행). 시각·간격·회차 개념이 없다. agent 하나의 실행 상한은 `max_turns` 30, `timeout_mins` 10이다(presets 문서).

### Codex (3a69ec3ef8fb)

주기 실행의 회차 계산은 이 저장소에 없다. heartbeat는 host가 만들어 넣은 입력으로만 보이고, 언제 쏠지는 여기서 확인 못 했다 [미확인]. 저장소가 가진 것은 그 입력을 사람 입력과 구별하고, 진행 중 turn에 끼워 넣고, 같은 지시가 반복되면 기록에서 접는 처리다.

- 구별은 trigger 문자열 하나다. `automation_heartbeat_scheduled`면 `UserInputOrigin::Heartbeat`, 그 외(없거나 다른 값)는 `User`다. 근거: `codex:codex-rs/history/src/heartbeat.rs` `UserInputOrigin::from_turn_trigger`(24–29행). 저장된 메시지는 내용이 아니라 metadata로 판정한다. content kind가 정확히 하나이고 그 값이 `user.heartbeat`(`HEARTBEAT_CONTENT_KIND`, 10행)일 때만 heartbeat다(31–46행). 종류를 두 개 이상 달거나 다른 종류면 사람 입력으로 남는다.
- 입력 본문은 `<heartbeat>` 봉투다. `automation_id`(1–128자, ASCII 영숫자·`-`·`_`), `current_time_iso`(1–64자, 숫자와 `T Z : . + -`), `instructions`. 형식이 어긋나거나 전체 길이가 3,600자를 넘으면 파싱을 포기하고 입력을 그대로 둔다. 근거: 같은 파일 `Heartbeat::parse`(75–110행), 파일 머리 주석 "Unknown origins, extra content, oversized inputs and unfamiliar wrappers stay unchanged."
- 진행 중 turn에는 steer로 들어간다. `TurnInputMode::Steer`로 제출된 heartbeat는 그 turn의 pending input 끝에 origin `Heartbeat`로 붙고, turn은 중단되지 않는다. 근거: `codex:codex-rs/core/src/session/turn_input.rs` `steer_input`(698–792행), `codex:codex-rs/core/src/session/turn_input_tests.rs` `steer_preserves_request_origin`(1018–1074행). 테스트는 trigger가 요청 쪽에 있으면 heartbeat, 진행 중 turn 쪽에만 있으면 사람 입력으로 기록됨을 확인한다. Review·Compact turn은 steer 자체를 거절한다(`ActiveTurnNotSteerable`, `turn_input.rs` 733–744행). 거절되면 입력은 pending에도 안 남는다. Regular turn에는 대기열처럼 쌓인다.
- 같은 heartbeat가 여러 번 쌓여도 실행을 건너뛰지는 않는다. 접는 곳은 기록 복원이다. `ordered_entries`가 같은 scope 안에서 `automation_id`별 마지막 instructions만 남기고, instructions가 같으면 앞의 것을 버린다. 근거: `codex:codex-rs/history/src/reconciled_retained_context.rs` `ordered_entries`(116–138행). 사람 입력은 절대 접히지 않는다(`UserInputOrigin`의 `User` 주석 "never eligible for heartbeat coalescing", `heartbeat.rs` 16–18행). 봉투로 파싱되지 않는 heartbeat를 만나면 그 지점까지의 접기 상태를 비운다(130–132행).
- 회차를 계산하는 코드, 놓친 회차, 연속 실패 멈춤은 이 저장소에서 못 찾았다. heartbeat 입력은 host가 이미 시각을 정해 봉투에 담아 보낸다. 그 계산의 위치는 [미확인].

### OpenCode (907b3bc518fa)

cron·heartbeat·간격 실행 코드를 확인하지 못했다. "없다"가 아니라 이 조사에서 그 경로를 읽지 않았다 [미확인].

## 비교

| 항목 | lophn | OpenClaw | Hermes | Codex | Pi | Gemini CLI |
|---|---|---|---|---|---|---|
| 주기 표현 | UTC `first_at` + 양의 `every_ms`. cron·timezone·달력 없음 | `at`·`every`·`cron`·`on-exit`·`stream`. cron은 timezone, 없으면 서버 로컬 | `once`·`interval`·`cron` + 자연어. profile timezone | 저장소 안에 없음. host가 시각을 정해 입력을 넣음 [미확인] | 없음 | 없음 |
| 기본값 | 없음. 비우면 주기 실행 없음 | heartbeat 기본 `30m` | `catch_up_missed` 기본 true, grace 120초–2시간 | 확인 못 함 | 해당 없음 | 해당 없음 |
| 놓친 회차 | 가장 최근 하나만 실행, 앞의 것은 missed 범위로 기록 | 재시작당 최대 5개, 5초 간격, agent job은 2분 지연 | 기본 1개. 끄면 0개, 기록만 | 확인 못 함. 계산이 host 쪽 | 해당 없음 | 해당 없음 |
| 진행 중 겹침 | 그 회차를 `unfinished_run`으로 skip하고 슬롯을 소비. 대기열 없음 | 그 tick의 실행 대상에서 제외. 슬롯은 남음. 다른 프로세스는 receipt 충돌 | "already running"으로 건너뛰고 due 유지. 다음 tick 재시도 | steer로 진행 중 turn의 pending에 합침. turn은 안 멈춤. Review·Compact는 거절 | 해당 없음 | 해당 없음 |
| 중복 방지 | `(assignment, revision, due_at)` 행. 주기 변경은 `last_due_at` 초기화 | `scheduleActivatedAtMs`로 편집 전 슬롯 제외 + receipt 선점 | `(job_id, scheduled_instant)` 완료 행. 판 없음. tick 파일 lock | 실행은 안 건너뜀. 기록 복원 때 같은 automation의 같은 instructions만 남김 | 해당 없음 | 해당 없음 |
| 연속 실패 | 실제 시작 후 실패로 끝난 run 3회면 assignment 멈춤. 사람 재개만 | run 실패 10회 또는 계산 실패 3회면 `enabled=false`. 재시작으로 끊긴 run도 셈. 사람이 `automations enable` | 3회면 문구만 덧붙임. 자동으로 안 멈춤. 전달 실패·model 도달 전 실패는 streak 제외 | 확인 못 함 | 해당 없음 | 해당 없음 |
| 계산이 model을 부르나 | 안 부름 | 안 부름 | 안 부름 | 계산 위치 [미확인]. 입력 처리 자체는 model을 안 부름 | 해당 없음 | 해당 없음 |
| heartbeat | 없음 | 30분마다 model 호출. scratch가 비어 있으면 생략 | 별도 heartbeat 못 찾음 [미확인] | host가 넣는 입력. 사람 입력과 origin으로 구별 | 없음 | 없음 |
| 시계 | ledger 밖 기계가 계산 | 함수마다 `nowMs`를 넘김 | `hermes_time.now()` 모듈 전역, 캐시 | 봉투의 `current_time_iso`를 host가 채움 | `options.now ?? Date.now` 주입 | 해당 없음 |

## lophn에 가져올 것과 버릴 것

- **scheduling R1.** 가져올 것: 셋 다 회차 계산을 시각 산술로만 한다. 버릴 것: cron 식, timezone, 자연어 파싱(Hermes `parse_schedule`), 요일·달력. lophn은 `first_at` + `every_ms`만 받는다. Hermes의 grace(120초–2시간)도 필요 없다. `(assignment, revision, due_at)` 키가 같은 회차의 두 번 실행을 이미 막는다.
- **scheduling R3.** 가져올 것: Hermes의 "놓친 것 중 한 번만". 기본값이 한 번이고 나머지는 기록만 남긴다. 버릴 것: OpenClaw의 재시작당 5개 재생. 잠든 동안의 회차를 몰아서 실행하면 같은 변경을 여러 run이 반복한다.
- **scheduling R5.** 가져올 것 없음. 셋 다 lophn과 반대로 간다. Hermes는 due를 유지해 다음 tick이 다시 시도하고, OpenClaw는 그 tick의 실행 대상에서만 빠지고 슬롯은 남긴다. Codex는 한 발 더 나아가 진행 중 turn에 steer로 합친다(`turn_input.rs` `steer_input`). pending input 끝에 붙어 그 turn이 이어서 처리하므로, 주기 입력이 사람 입력과 한 turn 안에서 섞인다. lophn은 그 회차를 `unfinished_run`으로 skip하고 `last_due_at`을 넘긴다. 대기열도 재시도도 없다(D24 H8). Codex의 steer 합류와 Hermes의 "stay due"를 가져오면 안 된다.
- **주기 입력과 사람 입력의 구별.** Codex는 trigger 문자열과 content kind로 origin을 남겨 기록 복원 때 heartbeat만 접는다. lophn은 주기 회차가 곧 run 하나라 같은 구별이 필요 없다. 다만 사람이 시작한 run과 주기가 시작한 run을 결과에서 섞어 세면 R6의 streak가 오염된다. 시작 이유를 run에 남기는 쪽이 Codex의 origin과 같은 자리다.
- **scheduling R4.** Hermes는 이미 끝난 슬롯을 또 만나면 ledger 행 없이 로그만 남긴다(`occurrences.py`). lophn은 수락과 skip마다 시각과 이유를 남긴다. 로그로 대체하지 말 것.
- **scheduling R6.** 가져올 것: OpenClaw가 재시작으로 끊긴 run을 실패로 센다는 점. 버릴 것: 횟수(10)와 계산 실패 별도 카운트(3). lophn은 실제 시작한 run이 실패로 끝난 것만 3회, 시작 못 한 것·사람 중단·거절·무응답·질문·승인 대기는 제외, Operator의 변경 없음은 성공. Hermes가 전달 실패와 model 도달 전 실패를 streak에서 빼는 것이 이 제외와 가깝다. 재개 권한은 둘 다 사람에게만 있다.
- **roles/common R9.** heartbeat를 가져오지 말 것. OpenClaw heartbeat는 30분마다 model을 부른다. lophn의 주기 계산은 model을 부르지 않는다.
- **중복 키.** OpenClaw의 `scheduleActivatedAtMs`와 Hermes의 `(job_id, scheduled_instant)`는 둘 다 주기 변경 뒤의 중복을 막으려 한다. Hermes 키에는 판이 없어 내용이 바뀌어도 같은 시각이면 같은 슬롯이다. lophn은 `(assignment_id, assignment_revision, due_at)`이라 판이 바뀌면 키가 바뀐다. 여기에 `last_due_at` 초기화를 더한다.

## 구현 메모

- 시각은 주입한다. Pi의 `options.now ?? Date.now`처럼 함수로 받고, Hermes의 `hermes_time.now()` 모듈 전역은 쓰지 않는다. 테스트는 고정 `now`로 흐른 시각을 만든다.
- 회차 하나 처리(`ProcessAssignmentOccurrence`)는 한 트랜잭션이다. 수락이면 `AcceptRun`과 `last_due_at` 전진을, skip이면 skip 행과 `last_due_at` 전진을 같이 쓴다. 둘 중 하나만 남으면 안 된다.
- 키가 `(assignment, revision, due_at)`이므로 같은 판의 같은 회차는 한 행뿐이다. 주기만 같고 판이 다른 회차는 다른 행이다.
- 주기 변경은 `last_due_at`을 비우고 `first_at`을 미래로 요구한다. 상태나 scope만 바꾸는 수정은 `last_due_at`을 유지한다.
- 경계 테스트: 10회 놓침 → run 1개 + `missed_count` 9. 진행 중 run이 있는 회차 → `unfinished_run` skip, 다음 회차는 그 run이 끝나도 같은 슬롯을 다시 안 집음. 답변 대기 중 skip. 주기 수정 뒤 `last_due_at` 초기화, 상태만 수정하면 유지. 시작 전 종료는 streak 제외, 시작 후 실패만 누적, 변경 없음은 streak 초기화. 3회째에 자동 멈춤, 그 뒤 사람 재개만 유효, 철회 후 재개 거절.
- 재시작으로 끊긴 run의 처리만 요구가 비어 있다. 아래 open-issues 후보.

확인 못 한 것: OpenClaw `DEFAULT_ERROR_BACKOFF_SCHEDULE_MS`의 실제 간격 값, Hermes에 heartbeat라는 별도 주기가 있는지, OpenCode의 주기 실행 경로, Codex에서 heartbeat 회차를 계산하는 위치(저장소 밖 host로 보이지만 확인 못 함)와 놓친 회차·연속 실패 처리.

## open-issues 후보

- **assignments R10, R11.** 시작했고 아직 `completed`도 `no_change`도 아닌 채로 프로세스가 죽은 run을 실패로 셀지 말이 없다. OpenClaw는 재시작으로 끊긴 run을 실패 횟수에 넣는다(`auto-disable.ts` 주석). 추천: 시작해서 정상 종료 기록 없이 끝난 run은 실패로 보고, 시작 전에 죽은 run은 보지 않는다. 이렇게 정하지 않으면 streak가 재시작 횟수에 따라 달라진다.
