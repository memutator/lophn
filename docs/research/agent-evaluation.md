---
type: research
concerns: [lophn-agent/evaluation]
---
# 실제 model agent eval

## 질문

fixture·시행 격리·결과 판정·오류 집계·전후 비교를 어떤 코드로 만들 것인가.
실제 model의 판단 품질과 fake provider로 확인하는 실행 제어를 분리하고, lophn의 3/5회 반복·사람 승격·judge 보정을 지킬 방법을 조사한다.

조사일 2026-10-04. 아래 경로는 `/tmp/claude-1000/lophn-research/`의 고정 clone 기준이다. `[확인]`은 읽은 코드, `[추측]`은 구현 추천, `[미확인]`은 이 조사에서 확인하지 못한 범위다. lophn 정본은 `lophn-agent/evaluation#R1–R24`, 해당 domain model, `docs/architecture/lophn-agent.md` §5.6·§8.3다. 이 문서의 자료 구조 제안은 정본을 바꾸지 않는다.

## 프로젝트별

### Gemini CLI (fb972b2f87fe)

**fixture와 시행.** `[확인]` `gemini-cli:evals/test-helper.ts` `BaseEvalCase`·`EvalCase`(427–448)는 `suiteName`, `suiteType`(behavioral/component-level/hero-scenario), 이름, 선택 timeout, 파일 map, prompt, setup, 시작 messages/sessionId, approvalMode, 임의 assert callback을 받는다. `internalEvalTest`(93–225)는 새 `TestRig`를 만들고 setup→파일 준비→CLI subprocess→assert→cleanup한다. `prepareWorkspace`(289–354)는 절대 경로·`..`를 거절하고 시작 파일을 쓰고 git 초기 commit을 만든다. 시작 세션은 isolated home의 chats에 쓴다. 그 쓰기가 실패하면 경고하고 계속한다(155–158); lophn은 시작 자료 누락을 model 호출 전 오류로 끝내야 한다.

**격리 한계.** `[확인]` `gemini-cli:packages/test-utils/src/test-rig.ts` `setup`(375–410)은 testDir/homeDir를 만들고 기존 디렉터리를 청소한다. `_getCleanEnv`(659–688)는 전체 `process.env`를 복사하고 일부 Gemini env만 제거하며 API key·model·base URL을 유지한다. `internalEvalTest`는 node_modules를 workspace에 symlink한다. 새 작업 폴더는 있지만 운영 credential·모든 host 파일·외부 MCP 차단을 보장하는 보안 경계는 아니다. 기본 approvalMode는 `yolo`(172); lophn의 fixture 사람 답 map과 다르다.

**판정.** `[확인]` `gemini-cli:evals/file_creation_behavior.eval.ts` 첫 사례는 새 파일 존재/내용과 기존 파일 불변을 검사하지만 `write_file` 호출도 요구한다. 둘째 사례는 `read_file`이 `write_file`보다 먼저였는지 검사한다. `gemini-cli:evals/validation_fidelity.eval.ts` 사례는 timeout 600000ms이고 build/tsc 계열 shell 호출 존재를 통과 기준으로 쓴다. 결과 상태 predicate라는 틀은 가져오되 tool 선택·정확 순서를 품질 정답으로 삼는 부분은 lophn R9에 맞지 않는다.

**judge.** `[확인]` `gemini-cli:evals/llm-judge.ts` `LLMJudge.judgeYesNo`(37–113)는 기본 `gemini-3-flash-base`, `selfConsistencyRuns=1`; 3·5회 병렬 호출 옵션을 제공한다. 질문 하나를 user content로 보내고 YES/NO를 요구한다. 대문자/문장부호 제거 뒤 문장 안 YES/NO도 받아들이며 YES가 NO와 OTHER 각각보다 많으면 true다(105–106; 과반수라기보다 plurality). 호출 오류는 `ERROR: ...` text→OTHER→false로 들어간다. 명시 undecidable·invalid 답 1회 재질문·축별 calibration은 이 함수에 없다. 사람 30개/24개 일치 보정은 `[미확인]`. lophn R14–R17의 strict 세 답·근거 부족을 이 parser로 구현하면 안 된다.

**오류·재실행.** `[확인]` `withEvalRetries`(55–90)는 message에서 500/503을 찾아 최대 3회 retry, 즉 최초 포함 최대 4회다. 모두 실패하면 reliability JSONL에 SKIP을 적고 정상 return하여 PR을 막지 않는다. 일반 assert 오류는 throw한다. 각 retry는 새 rig지만 log basename이 사례 이름에서만 만들어져 재시도 log는 같은 자리에 쓰인다(`prepareLogDir`, 392–397). lophn R11·R13의 최초 오류 보존·불완전 통과율 금지와 반대다.

**반복·suite·자동 실행.** `[확인]` `runEval`(359–390)은 ALWAYS_PASSES/USUALLY_PASSES/USUALLY_FAILS 정책이다. RUN_EVALS가 없으면 보통 통과/실패 사례를 skip, USUALLY_FAILS는 `it.fails`로 다룬다. 최근 세 suite 5/5 승격 로직은 `[미확인]`. `gemini-cli:evals/vitest.config.ts` 기본 test timeout 300000ms. `TestRig.run` 기본 subprocess timeout도 300000ms(761). `gemini-cli:.github/workflows/evals-nightly.yml`은 cron `0 1 * * *`, 6개 model×3 run_attempt, continue-on-error, log retention 7일이다. `chained_e2e.yml` 334–351은 prompt 변경 감지 뒤 실제 key로 ALWAYS_PASSES를 돌린다. suite/model/name filter는 비용 범위를 줄이지만 lophn R21–R22의 사람 지시만 허용과 다르다.

### Pi (83692682f095)

**fixture와 fresh 환경.** `[확인]` `pi:packages/evals/src/harness.ts` `PiCodingAgentInput`(43)은 text 또는 prompt/reload step 배열이다. 옵션은 명시 model, tools, workspaceFiles, system prompt transform, output extractor다(50–68). `runPiCodingAgent`(272–469)는 매 호출 mkdtemp 아래 workspace/home/agentDir/sessions를 만들고 `seedWorkspace`(225–236)로 파일을 준비한다. resolve/relative 검사로 path escape를 거절하고 mode 0600 파일을 쓴다. 세션은 새 `SessionManager.create`; 예상 밖 extension load는 오류다(357–363). 종료 시 session JSONL artifact를 먼저 저장하고 dispose→임시 root 삭제→env 복원한다. 실패와 cleanup 오류는 AggregateError로 보존한다(448–465).

**보안 경계와 credential.** `[확인]` `applyIsolatedEnvironment`(82–100)는 HOME/USERPROFILE/PI_CODING_AGENT_DIR를 isolated 값으로 바꾸고 PI_EVAL_* env를 숨긴다. `enterToolSandbox`(154–188)는 POSIX root에서 groups를 비우고 UID/GID로 privilege를 내린 뒤 transformed eval module을 읽을 수 없는지 확인한다. documentation harness는 container·sandbox identity가 없으면 거절(526–528), shell/무제한 network tool은 목록에서 제외한다(484–485). `pi:packages/evals/src/docker.ts` `dockerArgs`는 `--read-only`, tmpfs, artifact mount, sandbox UID/GID 65532, auth.json readonly mount를 쓴다. 다만 일반 harness는 host agentDir/auth.json에서 선택 credential을 읽어 memory store로 복제한다(312–315). lophn R7은 운영 credential을 읽지 않는 쪽이므로 이 자동 import는 버린다. Docker 자체의 network egress allowlist는 읽은 dockerArgs에서 `[미확인]`이다.

**판정.** `[확인]` `pi:packages/evals/evals/extensions.docs.eval.ts`는 output extractor로 extension load 오류·tool 결과·response를 뽑고 `StructuredOutputJudge` strict/allowExtras=false, `ToolCallJudge` 예상 name/args를 같이 쓴다. `judgeThreshold:null`로 quality score를 test 실패 gate와 분리한다. structured extraction과 final state 검사 틀은 유용하지만 exact response와 expected tool은 lophn의 품질 oracle로 가져오지 않는다. 해당 judge 라이브러리 구현은 clone 밖 dependency이므로 semantic/tool sequence 세부는 `[미확인]`. 별도 LLM content judge·사람 calibration도 `[미확인]`.

**오류를 숨기지 않는 비교.** `[확인]` `pi:packages/evals/src/report.ts` `EvalObservation`(32–34)은 scored/unscored/skipped/pending/errored다. `readTaskObservation`(136–188)은 report 읽기 실패·결과 수/identity/status mismatch·실제 model mismatch·비정상 metric·run error를 errored로 분리한다. score는 finite 0..1이고 score>=1만 pass다. `resolvePair`(249–281)는 expected·observed 각각 정확히 1개인지 검사하고 unscored 등은 blocked pair다. `summarizeEvalObservations`(359–412)는 해당 evalSet에 blocked pair 하나라도 있으면 headline pass rate/lift를 null로 둔다. token/tool/time/cost는 보조 metric, 누락 metric은 0으로 만들지 않는다. lophn R13에 가장 가까운 구현이다. 단, lophn은 네 outcome과 missing을 별도로 세고 suite 전체 gate를 적용한다.

**한 조건 비교와 반복 순서.** `[확인]` `pi:packages/evals/src/plan.ts` `parseDiscoveredCases`는 이름 identity 중복을 model 시행 전 거절한다. `createTaskPlan`(39–59)은 provider/model identity·양의 반복 수를 검사하고 홀수에는 without_docs→with_docs, 짝수에는 역순이다. `pi:packages/evals/src/cli.ts` 기본 runsPerVariant 1(79–84); protocol에 model·반복·image IDs·파일·case·task를 고정하고 SHA256 digest, expected-runs.json을 시행 전에 저장(153–168)한다. 매 task 관측을 저장하고 다른 CLI run에는 timestamp+UUID artifact root를 쓴다(`artifactRunId`). `vitest.evals.config.ts` timeout/hookTimeout 300000ms, worker 1/fileParallelism false다. regression/capability 분리·15/15 사람 승격·주기 CI 여부는 `[미확인]`이며 lophn 고유 정책을 따로 구현해야 한다.

### Hermes Agent (343500b3547e)

**업무 실패를 최소 fixture로 만든 사례.** `[확인]` `hermes-agent:evals/toolperf_abeval/ab_eval.py` `TASKS`·`make_sandbox`(44–127)는 이미 적용한 patch, 같은 timeout 3곳 중 한 곳, 대소문자 검색, hidden directory, 잘린 큰 output, 여러 디렉터리, 큰 파일 등 9개 작업을 합성 파일로 만든다. `run`(146–221)은 model/arm/task/repetition 경로별 workspace를 준비한다. timeout 600초, max-turns 30. output/state predicate인 `SUCCESS`(130–143)는 config 중복 0, versions.txt 내용 등을 검사하지만 응답 tail 안 magic marker 검사도 많다. lophn의 9가지 함정과 문제 종류가 겹치되 lophn의 문서 2개/접힌 section/scope 밖 변경을 이것으로 대체할 수 없다.

**최초 결과와 오류 집계의 위험.** `[확인]` 같은 `run`은 meta.jsonl에 완료 run_id를 append하고 resume에서 skip한다. 하지만 exit!=0이며 출력이 없으면 infra-crash를 결과에 기록하지 않고 다음 resume에서 retry한다(210–215). `report`(260–309)는 기록된 rows만 분모로 쓰고 predicate 예외는 false로 합친다. 첫 장애·예정 수가 사라져 lophn R11·R13에 맞지 않는다. HOME은 모든 시행이 공유하는 configured ABEVAL_HOME(41–42, 191–196)이다. 작업 파일 초기화만 fresh이고 credential·session·approval 독립까지 보장하지 않는다.

**별도 browser benchmark.** `[확인]` `hermes-agent:evals/browser_use/single_run.py`(45–69, 117–129)는 throwaway HERMES_HOME, 일부 web-fetch key 제거, skip_context_files/skip_memory, max_iterations 30을 쓴다. task JSON의 prompt·oracle_all/oracle_any를 final response에 case-insensitive regex로 검사하고 exception을 `error`로 남긴다(`_ok`, 170–199). `orchestrate.py`(28–34, 76–123)는 기본 3 reps, cell timeout 1200초, arms 순서 고정, timeout/no-result도 JSONL append, 완료 cell resume skip다. browser cookie를 지우지만(53–73) CDP Chrome을 공유한다. `report.py`는 오류도 false를 포함한 전체 ok fraction을 표시하고 token/call/time·base delta는 성공 rows만 계산(42–57)한다. lophn은 오류가 있는 비교 숫자 자체를 금지한다.

**environment는 eval isolation 정책과 다르다.** `[확인]` `hermes-agent:tools/environments/base.py` `BaseEnvironment`(225–286)는 backend execute/cleanup interface, session별 snapshot·cwd 파일, snapshot timeout 30초를 둔다. `docker.py` `_BASE_SECURITY_ARGS`(300–322)는 cap-drop ALL 뒤 DAC_OVERRIDE/CHOWN/FOWNER를 추가하고 tmpfs 512MiB/256MiB, pids 기본 2048(cgroup 가능 때)을 쓴다. credential/skill/cache host mount helper도 있다(526–553). `[미확인]` 위 ab_eval/browser runner가 Docker backend를 강제하는 연결은 확인하지 못했다. environment 클래스의 존재를 'eval은 안전하게 격리된다'는 근거로 쓸 수 없다. LLM judge·strict three-way 답·사람 calibration·capability promotion은 읽은 runner에서 `[미확인]`이다.

## 비교

| 질문/정책 | lophn | Gemini CLI | Pi | Hermes Agent |
|---|---|---|---|---|
| 사례 입력·시작 상태 | versioned manifest, intent, preset/tools/permissions, 사람 답, expected/forbidden | 파일 map·prompt·setup·messages·assert | workspaceFiles·prompt/reload·harness output·judges | 합성 sandbox+TASKS 또는 task JSON+oracle |
| 시간·반복 | 600초, regression 3/capability 5 | 기본 300초, 사례 600초; nightly 3회 | 기본 300초, variant 기본 1회 | toolperf 600초/명시 reps; browser 1200초/3회 |
| 시행마다 fresh workspace/DB | 모두 fresh; 운영 자료/credential/MCP 차단 | fresh rig home; key env 유지, node_modules 공유 | fresh workspace/home/session; 선택 host credential import | toolperf HOME 공유; browser fresh home·Chrome 공유; fresh DB 미확인 |
| 통과 oracle | final state·금지 변경 우선; 성공 문장/정확 tool 순서 금지 | final 파일+tool 선택/순서 혼합 | structured output+tool name/args | 상태+응답 marker, browser 응답 oracle |
| LLM judge | 두 축, satisfy/unsatisfy/undecidable; invalid 1회 재질문 | YES/NO, 유연 parser, OTHER 및 호출 오류 false | 별도 content judge 미확인 | 미확인 |
| 사람 calibration | 축별 30개 중 24개; 10 suite마다 5개 review/2개 불일치 invalid | 미확인 | 미확인 | 미확인 |
| 결과·분모 | 네 outcome+missing; 오류/부족/누락 있으면 rate/delta null | 500/503 최대 4시도 뒤 SKIP 정상 return | scored/unscored/skipped/pending/errored; blocked 있으면 headline null | toolperf infra 누락; browser 오류 포함 ok fraction |
| 최초 결과 보존 | 재실행은 새 결과; 기존 결과 불변 | retry 뒤 성공/skip가 test를 덮음 | task identity·protocol digest·새 artifact root | 완료 append/skip; toolperf infra는 미기록 |
| regression/capability·승격 | 3/5회, 최근 3 suite 5/5는 사람 후보 | ALWAYS/USUALLY 정책; 승격 미확인 | 분리/승격 미확인 | 분리/승격 미확인 |
| 한 조건·순서 | 조건 1개, 홀수 전→후/짝수 후→전 | 비교 gate 미확인 | docs 유무 1조건, 반복 순서 교대 | toolperf checkout arm; browser arm 고정 순서 |
| 사람 지시/CI·비용 | 실제 model 사람 지시만; 사례 시간 상한·product 한도 | 매일 01:00 CI+prompt 변경 CI; filter | 명시 CLI·한 worker·보조 usage/cost; 주기 미확인 | 명시 benchmark script·30 turns·time 상한; 주기 미확인 |

표의 미확인은 저장소 전체의 부재 판정이 아니다. 특히 toolperf와 browser eval은 Hermes 전체 평가 시스템을 대표한다고 단정하지 않는다.

## lophn에 가져올 것과 버릴 것

- **R1–R3, R18:** Pi의 사전 task plan+expected runs+protocol digest, Gemini/Pi의 path 검증을 가져온다. fixture·judging rule은 runner가 read-only로 읽고 평가 대상이 못 쓰는 위치에 둔다. Gemini의 시작 session write 실패 후 계속, 함수 callback만 있고 version manifest가 없는 형태는 버린다.
- **R4, R12:** 정책은 lophn 그대로 regression=3/capability=5로 고정한다. Gemini의 `it.fails`는 known failure를 통과 test로 표현할 수 있어 가져오지 않는다. 최근 3 suite의 snapshot 호환성과 각 5회 satisfied를 확인한 뒤 사람 후보만 출력한다. 자동 이동 command는 만들지 않는다.
- **R5–R6, R23:** Hermes의 '실패 유형마다 작은 합성 파일'을 가져온다. lophn 9가지 함정 및 권한 거절·approval 취소·응답 취소·steering·MCP injection을 따로 만든다. 실제 운영 session dump·DB 복제를 fixture로 쓰지 않는다. 사람이 비밀 없는 최소 사례를 채택하며 regression 실패 수정 때 기대를 낮추지 않는다.
- **R7–R8:** Pi의 fresh root/home/session·예상 밖 extension 거절·setup path 검사와 readonly fixture를 가져온다. 기존 credential 자동 import, 공유 home/Chrome, yolo 승인은 버린다. SQLite는 매 시행 새 파일 DB(WAL)와 fixture 앱 DB로 초기화하고 fake MCP에만 접속한다. approval/질문 답은 exact fixture map; missing answer를 임의 승인하지 않는다.
- **R9–R10:** output extractor와 final-state predicate만 품질 oracle로 쓴다. tool log는 근거와 비교 수치에만 둔다. 내용 judge는 prepare/format/state/forbidden 판정 통과 뒤 필요한 축에만 호출한다. tool 오류 자체와 요청 의도 실패를 혼동하지 않는다: 복구 요구가 있는 사례라면 최종 복구 상태로 판정한다.
- **R11–R13:** Pi의 blocked headline 원리를 가져오되 lophn 네 outcome+missing으로 번역한다. Gemini retry→SKIP 정상 종료, Hermes infra 누락·성공 rows만 비교는 버린다. 사람이 재실행해도 새 suite ID/결과를 만들고 첫 시행 참조를 남긴다.
- **R14–R17:** Gemini의 임의 질문+유연 YES parsing·vote를 버린다. 두 축 각각 고정 질문/경계·strict enum·calibration 상태를 개발 파일로 저장한다. 사람 30 sample 확보가 judge 기반 통과의 선행 작업이며 미보정 축은 insufficient_evidence다. 보정 없는 model을 '일단 judge'로 넣으면 R16을 채우지 못한다.
- **R19–R20:** Pi의 홀짝 교대 plan·paired identity·누락 metric 보존을 가져온다. diff allowlist로 단 하나의 조건 변경만 허용하고 동일 fixture/predicate/calibration 판을 고정한다. 다른 snapshot 결과를 평균 내지 않는다. tool 순서/수/비용 절감은 통과 기준이 아니다.
- **R21–R22, R24:** 명시 CLI 시작과 기본 600000ms timer를 쓴다. `deno task check`/E2E/CI에는 실제 model eval을 연결하지 않는다. 실제 model regression이 미실행이면 품질 유지 미확인으로 남긴다. model 호출을 수반하는 auto record나 judge calibration도 사람 지시 gate 안에 둔다.

### open-issues 후보

1. **evaluation#R7·R18, R21–R22:** 운영 credential을 읽거나 복제하지 않으면서 유료 actual/judge model을 부르는 개발 runner의 credential 주입 경로는 읽은 eval 정본에 구체화되지 않았다. **추천:** 사람이 명시 공급한 eval 전용 credential을 runner 메모리에만 넣고, agent tool 환경/fixture/결과에는 전달하지 않는다. host 제품 keychain/CLI auth 자동 탐색은 금지한다. 실제 model 호출을 금지하자는 뜻이 아니라 운영 credential 복제 금지의 구현 경계를 명확히 하자는 것이다.
2. **evaluation#R24·R10–R11:** 제품 시간 초과와 runner 장애 구분은 요구됐지만 eval timer 600초가 제품을 cancel한 경우 outcome 매핑이 명시적으로 적혀 있지 않다. **추천:** 제품이 제한 시간 내 필요한 결과를 못 낸 정상 관측은 unsatisfied(`product_timeout`), runner crash·관측/판정 중단은 evaluation_error(`runner_interrupted`). 의도된 응답 취소 사례는 fixture 기대 상태로 판정한다. 이 추천은 구현 전 사람/정본 결정이 필요하다.

## 구현 메모

### runner 작업을 나눌 곳

`[추측]` 하나의 작업에 실제 model·DB 격리·judge 보정까지 몰지 않는다.

1. **model 없는 runner 테스트:** domain model schema, fixture preflight, snapshot/hash, task plan, 결과 append와 집계, paired 비교, promotion 후보 계산. fake agent contract 사용.
2. **fresh 환경:** file SQLite/core testing harness·fixture 문서/앱·tool-judgment·fake MCP·fixture 사람 답. products 계약이 선행이다. 임시 환경을 다 만들고 검증한 뒤 실제 call gate를 연다.
3. **machine predicate:** format·필수 상태·금지 diff, output/trace 참조. fixture 불량과 agent 불량의 provenance를 구별한다.
4. **content judge:** strict enum·invalid 1회 재질문·axis calibration/review. 사람 30개 확정 자료 확보와 별도 model 배정이 선행이다.
5. **live CLI:** 사람이 명시 선택한 case/model/credential, actual trial timer, 회귀 근거·전후 report. 위 결정적 테스트가 끝난 뒤 연결한다.

### 상태와 기본값

| 것 | 초기 값/전이 | 보존할 것 |
|---|---|---|
| trial | prepared→running→finished; 준비 오류는 prepared→finished | 최초 finished 불변, snapshot·actual·reason·trace_refs |
| 반복 | regression 3, capability 5 | 잘못된 반복 값은 model 0회 preparation error |
| 시간 | fixture timeout_ms 기본 600000, 양의 정수 | start deadline·제품 종료/runner 중단 원인 |
| 집계 | planned=satisfied+unsatisfied+errors+insufficient+missing | 미시행도 분모에서 제거하지 않음 |
| rate/passed | 불완전이면 null; 완전 regression은 전부 satisfied여야 true | 개별 결과는 항상 표시 |
| judge | axis별 strict 세 답, invalid 답 최대 1회 재질문 | rule/model 판, 입력 근거 hash, raw 답은 안전한 개발 결과로 제한 |
| calibration | uncalibrated→collecting→calibrated; model/rule 변경 또는 review 불일치로 invalidated | 축별 정확 30 sample/24 match, 10 suite마다 5개/2개 불일치 |
| promotion | 같은 조건의 최근 capability 3 suite 모두 5/5 | 사람 후보만; 채택 전 suite 이동 0회 |

### 판정 오류 표

| 상황 | outcome/처리 |
|---|---|
| 중복 이름·시작 자료/기준 누락·잘못된 반복/timeout | evaluation_error, actual/judge model 0회 |
| agent output format/인자 오류·필수 상태 없음·금지 변경 | unsatisfied, content judge 호출 0회 |
| fixture predicate throw·예상 밖 provider 장애·runner 중단·replay 오류 | evaluation_error, 첫 결과 보존 |
| judge undecidable·근거 문서 없음·미보정·두 번째 invalid | insufficient_evidence |
| 필요한 검사 모두 만족 | satisfied |
| 예정됐지만 결과 파일 없음 | suite missing; 성공/실패로 추정하지 않음 |

`[추측]` 결과 파일은 `suite snapshot → fixture/version → repetition` key를 갖고 exclusive create/atomic rename으로 쓴다. crash 복구는 planned task와 result를 비교해 missing을 보고하며, 완료된 시행을 retry하여 덮지 않는다. fake clock은 deadline·review count·결과 metadata 테스트에 주입한다. 실제 live timer는 monotonic clock이어야 한다.

### 필수 경계 테스트

- 이름 중복/fixture path escape/자료 hash mismatch에서 model 0회; 상태 초기화 실패 뒤 run 시작 0회.
- 첫 시행 문서 변경·승인·세션이 둘째 fresh DB/home에 나타나지 않음; 운영 root/keychain/MCP read 0회.
- 최종 문서가 같은 두 tool 순서가 같은 판정; '성공' 답만 있고 산출물 없으면 unsatisfied.
- format 실패와 predicate 결함의 outcome 차이; intentionally injected provider 오류 복구는 실제 복구 상태로 판정.
- 9 satisfied+1 error/missing/insufficient이면 rate와 전후 delta null; 재실행 만족 뒤에도 첫 오류 존재.
- invalid judge→valid 1회 재질문, invalid 두 번/undecidable/근거 없음/23-of-30은 insufficient; 24-of-30은 calibrated.
- review 5개 중 1개 mismatch 유지, 2개 mismatch 해당 축만 invalid; model/rule 변경은 즉시 invalid.
- 3회 비교 전후/후전/전후, 조건 2개 변경 preflight 거절; duplicate paired observation은 불완전.
- capability 15회 중 1개 error/실패/부족이면 promotion 후보 아님; 15/15도 사람 채택 전 이동 0회.
- 실제 model suite는 명시 사람 gate 없이 call 0회. fake provider 테스트 결과를 실제 eval 결과로 등록하지 않음.

### 확인하지 못한 것

Pi가 호출하는 vitest-evals dependency의 judge 구현과 GitHub 자동 eval 주기, 세 프로젝트의 사람이 판정한 calibration 자료·최근 suite promotion 구현은 확인하지 못했다. Hermes environment를 위 benchmark에 강제 연결하는 설정과 complete fresh DB 보장도 미확인이다. 어떤 프로젝트도 이 조사에서 lophn 두 축·strict 세 답·30/24·10/5/2 규칙 전체의 선례로 확인되지는 않았다. 실제 model은 호출하지 않았으며 품질 점수를 새로 측정한 조사가 아니다.
