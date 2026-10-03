---
type: research
concerns: [lophn-agent/harness/prompt-assemble, lophn-agent/conversation]
---
# prompt 조립과 compaction

## 질문

고정 prefix·tool schema·turn context를 어디에 놓고 실제 전송 크기를 어떻게 제한할 것인가.
compaction에서 tool 짝·현재 요청·원문을 보호하고 summary 실패·overflow·resume를 어디서 끊을 것인가.
다섯 프로젝트의 코드·숫자·fake 테스트로 lophn 구현 경계를 정한다.

조사일 2026-10-04. `[확인]`은 해당 revision 소스·테스트에서 본 사실, `[미확인]`은 조사 범위에서 근거를 찾지 못한 사실이다. 경로는 `프로젝트:저장소 상대 경로`다. provider wire·cache usage는 `docs/research/provider-adapters.md`를 참고하고 여기서는 조립·budget 판정에 집중한다. 테스트 snapshot은 근거로 쓰지 않았다.

## 프로젝트별

### Codex (3a69ec3ef8fb)

- `[확인]` base instructions·tools는 독립 request 필드, 이력은 input이다. initial context는 developer instructions·extension fragments·world state를 developer와 contextual-user bundle로 나눈다. model-switch 지시는 developer 앞, 사용자 지침·환경은 contextual-user 흐름에 들어간다. 환경 변화는 history delta로 append한다. compaction 뒤 initial context는 pre-turn/manual이면 다음 정상 turn, mid-turn이면 마지막 실제 user message **앞**에 재주입한다. lophn의 최신 메시지 **끝** context와 다르다. 근거: `codex:codex-rs/core/src/client.rs` Responses 요청 구성; `core/src/session/mod.rs` `build_initial_context_with_world_state`(4206–4490); `core/src/compact.rs` `InitialContextInjection`.
- `[확인]` code-mode tools는 comparator sort, namespace tools는 이름 sort·map은 BTreeMap. Responses `prompt_cache_key`는 session ID 또는 internal source+parent thread, override 우선이다. **content hash가 아니라 affinity**다. 전체 JSON canonicalization·층별 hash는 `[미확인]`; compaction-model metadata hash와 prompt hash를 혼동하지 않는다. 근거: `codex:codex-rs/core/src/tools/spec_plan.rs` `compare_code_mode_tools`, `merge_into_namespaces`; `core/src/client.rs` `prompt_cache_key`(580–590).
- `[확인]` auto-compact 기본 raw context90%, 명시 값은 그보다 작게 clamp. usable context는 effective percent(기본95)를 적용하며 total/body-after-prefix scope·post-turn threshold가 별도다. estimator는 base instructions+history, **ceil(UTF-8 bytes/4), coarse lower bound**라고 명시한다. AdditionalTools/ToolSearchOutput JSON은 세지만 별도 Prompt.tools 전체 포함은 미확인. lophn model#R14 안전 상한이 아니다. 근거: `codex:codex-rs/protocol/src/openai_models.rs` `usable_context_window`, `auto_compact_token_limit`; `core/src/session/context_window.rs` `context_window_token_status_with_config`; `core/src/context_manager/history.rs` `estimate_token_count_with_base_instructions`; `utils/string/src/truncate.rs` `approx_token_count`.
- `[확인]` local summary는 같은 turn model·tools 없는 요청, checkpoint prompt의 네 내용(progress/decisions, constraints/preferences, next steps, critical references), 고정 section은 아니다. replacement는 최근 **user text 총20,000 approximate token** 선택+summary이며 straddler middle truncate·media text fallback. 최신 요청 전문·assistant/tool tail 보호는 아니다. summary overflow면 oldest item을 제거하고 대응 call/output도 함께 제거, item 수>1 동안 반복하며 stream retry counter reset. 일반 stream retry는 provider 설정, abort/budget 오류 종료. 전 구간 chunk/merge 대신 summary 입력 일부를 버릴 수 있다. 근거: `codex:codex-rs/core/src/compact.rs` `run_compact_task_inner_impl`, `COMPACT_USER_MESSAGE_MAX_TOKENS`, `build_compacted_history_with_limit`; `context_manager/history.rs` `remove_first_item`; `prompts/templates/compact/prompt.md`.
- `[확인]` post-turn empty는 실패지만 다른 local phase는 unwrap_or_default. local output cap·six-parts·50%·strict shrink 검사는 미확인이다. remote v2는 별도 opaque output 경로, tools/CompactionTrigger를 보낼 수 있어 local prompt를 일반화하지 않는다. 정상 Responses drain overflow는 return error, guardian 특수 경로만 model step당 compact/retry1회다. 근거: `codex:codex-rs/core/src/compact.rs`(349–364); `compact_remote_v2_attempt.rs` `run_remote_compact_v2_attempt`; `session/turn.rs` Responses drain(1714–1720), guardian recovery(759–793).
- `[확인]` rollout의 replacement history를 resume/fork model view로 복원한다. mock SSE는 turn→compact→resume→fork의 input prefix·metadata를 검증한다. 400-token continuation이 아니다. deferred tools/ToolSearchOutput는 schema lazy read이며 lophn 자료 관점별 outline 규약은 미확인이다. 근거: `codex:codex-rs/core/tests/suite/compact_resume_fork.rs` `compact_resume_and_fork_preserve_model_history_view`; `core/src/tools/spec_plan.rs` deferred specs.

### OpenCode (907b3bc518fa)

기존 `packages/opencode` session과 새 `packages/core` runner가 공존한다. 수치를 섞지 않는다.

- `[확인]` 기존 system은 provider/agent→env→instructions→MCP→skills→user custom system. env 날짜/cwd/platform은 history 앞, plan/build reminders는 마지막 user에 synthetic text append다. references는 이름 sort. 근거: `opencode:packages/opencode/src/session/prompt.ts`(1257–1282); `session/system.ts` `environment`; `session/llm/request.ts` `prepare`; `session/reminders.ts` `apply`.
- `[확인]` 기존 gate는 usage total 또는 input+output+cache read/write≥usable. input limit 있으면 input−reserved, 없으면 context−maxOutput; reserved 기본 min(20,000,maxOutput). recent usable25% clamp2,000~15,000, user-turn 경계에서 선택·oversized는 assistant 경계 split. ToolPart에 call/result가 함께 있다. prune은 최근2 user turns·tool output40,000·skill 보호, 이전 제거량20,000 초과면 timestamp; 원문 유지/wire placeholder. summary result는 앞2,000 **UTF-16 units**+[truncated]. 근거: `opencode:packages/opencode/src/session/overflow.ts` `usable`, `isOverflow`; `session/compaction.ts` `preserveRecentBudget`, `turns`, `splitTurn`, `select`, `prune`, `truncate`.
- `[확인]` 기존 compaction agent 지정 model 또는 마지막 user model, prior completed summary+새 head update, tools={},system=[]. summary도 overflow면 stop. 성공은 processor finish/error이지 six-parts/50% 검사가 아니다. overflow 후 최신 user를 새 ID로 replay하거나 attachment 설명 synthetic continuation을 만든다. conversation R9의 발언 복제0과 다르다. 근거: `opencode:packages/opencode/src/session/compaction.ts` `processCompaction`(340–556).
- `[확인]` core는 buffer20,000/recent8,000/output4,096, whole `{system,messages,tools}` JSON을 round(JS length/4)로 추정해 context−max(output,buffer) **초과** 시 compact. summary input>context−summaryOutput이면 시도0, chunk 아님. 같은 model/tools0, nonempty/no provider error이면 commit; length 전용 거부는 미확인. template는 Objective/Important Details/Work State(Completed,Active,Blocked)/Next Move/Relevant Files, exact paths/errors·빈 sections 유지, newer conversation wins. 기존 session도 buildPrompt 공유. 근거: `opencode:packages/core/src/session/compaction.ts` `settings`, `select`, `compactAfterOverflow`, `buildPrompt`, `compactIfNeeded`; `core/src/util/token.ts` `estimate`.
- `[확인]` core는 첫 provider attempt에만 recovery를 넘겨 compact-and-retry **1회**. promptCacheKey는 session ID affinity다. common cache auto는 마지막 tool/마지막 system/최신 user text **3곳**; latest-assistant/tail-N도 가능해 경계가 이동한다. 전역 canonical JSON/층 hash는 미확인이다. 근거: `opencode:packages/core/src/session/runner/llm.ts` `runTurnAttempt`, `runAfterOverflowCompaction`, `runTurn`; `packages/llm/src/cache-policy.ts` `DEFAULT_POLICY`, `applyCachePolicy`.
- `[확인]` filterCompacted는 latest summary+tail+후속 messages, fork는 raw messages/parts를 새 ID로 복사·parentID/tail_start_id remap. summary.ts는 file diff stats로 대화 요약과 별개. fake ProviderTest/model limits/LLMEvents/Usage/Effect layers로 compaction을 테스트한다. skill index→tool 본문은 lazy 전략. 근거: `opencode:packages/opencode/src/session/message-v2.ts` `filterCompacted`; `session/session.ts` `fork`; `session/summary.ts` `summarize`; `test/session/compaction.test.ts` `createModel`, `wide`, fake services; `session/system.ts` `skills`.

### Gemini CLI (fb972b2f87fe)

아래는 `src/context/chatCompressionService.ts` **legacy chat**다. enabled context-management는 별도 경로라 수치를 일반화하지 않는다(`core/client.ts`656–705).

- `[확인]` systemInstruction(global memory)/function declarations는 독립 필드, env+extension/project memory는 첫 user session_context. date/platform/temp dir·옵션 tree, subdirectory 지침은 JIT tool output. IDE full/delta(active file,cursor,selection,other paths)는 요청 앞 user history, pending call이면 functionResponse 짝을 위해 defer, compaction 뒤 full resend. env stable ID로 중복 방지. 8KiB/20tabs·전역 schema/key canonical sort·prompt hash는 미확인. Google 경로의 implicit cache는 이 코드로 단정하지 않는다. 근거: `gemini-cli:packages/core/src/utils/environmentContext.ts` `getEnvironmentContext`, `getInitialChatHistory`; `core/client.ts` `startChat`, `getIdeContextParts`, `tryCompressChat`.
- `[확인]` context 기본1,048,576/Gemma4 256,000, unknown도 default. text ASCII/4·nonASCII1.5/char, >100,000chars는 /4 fast path. media만 countTokens, 실패 heuristic(image3,000/PDF25,800). trigger last prompt usage(없으면 estimate) raw context **50% 이상**, output reserve 없음. tail serialized chars30%, user non-functionResponse split으로 tool 짝 유지. 근거: `gemini-cli:packages/core/src/core/tokenLimits.ts` `tokenLimit`; `utils/tokenCalculation.ts` `estimateTokenCountSync`, `calculateRequestTokenCount`; `context/chatCompressionService.ts` constants, `findCompressSplitPoint`, `compress`.
- `[확인]` collapse helper는 최근 tool3turn/retrieval tools 보호, 오래된 각 string 앞2,048 UTF-8 bytes를 grapheme-safe+omitted marker(전체 cap 아님). compress 직접 truncation은 response 합계50,000token 역순 budget, 초과 원문 파일+tail30줄/reread pointer. alias main Pro→Pro/Flash→Flash/Lite→Lite, unknown→Gemini3 Pro preview, alias 별도 output cap 미지정. 근거: 위 `collapseOlderFunctionResponses`, `truncateHistoryToBudget`, `modelStringToModelConfigAlias`; `config/defaultModelConfigs.ts` chat-compression aliases.
- `[확인]` XML state_snapshot7 sections(overall_goal,active_constraints,key_knowledge,artifact_trail,file_system_state,recent_actions,task_state), DATA 실행0/prior snapshot carry. private scratchpad 요청은 lophn R24와 불일치. summary 뒤 **verification LLM call1**; omissions 개선/동일 반복, empty verification이면 첫 summary. final empty failure, new count>old failure(같음 성공). section/complete-stop 검사는 미확인. failed flag면 truncate only지만 client는 INFLATED에만 flag, startChat reset. head fitting이면 원문/아니면 truncate, full-range chunk 아님. 근거: `gemini-cli:packages/core/src/prompts/snippets.ts` compression(910–976); `context/chatCompressionService.ts` `compress`(576–718); `core/client.ts` `tryCompressChat`.
- `[확인]` request>remaining은 ContextWindowWillOverflow+API0; provider 응답 뒤 compact retry 횟수 미확인. resume disk user/gemini history, hot restart 명시 in-memory 우선. mock generateContent Initial/Verified Summary·countTokens·usage로 two calls/empty fallback/prior snapshot/inflation/split 테스트. 근거: `gemini-cli:packages/core/src/core/client.ts`710–729; `core/geminiChat.ts` constructor; `context/chatCompressionService.test.ts` setup(165–208), 관련 `it`.

### Pi (83692682f095)

- `[확인]` system: preamble→tool snippets→rules→docs 주소→addendum→project files 전문→skill index→cwd→custom, changed section만 patch. docs/skills eager0. selectedTools/contextFiles 배열 순서 보존, 전역 canonical keys/층 hash 미확인. Anthropic system/last tool/last user(system) **보통3**, OAuth identity block 추가면 **4**. history marker 이동, initial tools pin+tool_addition/removal 경로도 있다. summary cacheRetention none. 근거: `pi:packages/coding-agent/src/core/system-prompt.ts` `buildSystemPromptSections`, `diffSystemPromptSections`; `core/skills.ts` `formatSkillsForPrompt`; `packages/ai/src/api/anthropic-messages.ts` `buildParams`, `convertMessages`, `convertTools`.
- `[확인]` reserve16,384/recent20,000, contextTokens **>context−reserve**, equality no trigger. usage(input/output/cache)+trailing estimate, error/abort/zero usage 제외·edit/compact 뒤 baseline invalidate. ceil(chars/4), image1,200상당/toolsAdded JSON 포함, wire 상한 아님. cut은 user/assistant만·toolResult 앞 금지·parent call까지 포함. split-turn history/current-prefix 별도 요약이라 Original Request 전문 대신 summary 가능. 근거: `pi:packages/coding-agent/src/core/compaction/compaction.ts` `DEFAULT_COMPACTION_SETTINGS`, `estimateProjectedContextTokens`, `shouldCompact`, `estimateTokens`, `findValidCutPoints`, `findCutPoint`, `prepareCompaction`.
- `[확인]` six headings Goal/Constraints & Preferences/Progress(Done,In Progress,Blocked)/Key Decisions/Next Steps/Critical Context. previous summary update·relevant carry·obsolete 제거·exact paths/errors, conversation data frame, reviewer0, read/modified file lists sort/carry. same model, main cap min(reserve×.8,model max)=13,107·split-prefix .5=8,192, merged cap 미지정. branch cap4,096/context−reserve 최신 suffix. full-range chunk 아님. error/length/toolCall 실패, transient는 retry policy; empty/sections/50% 검사는 미확인. 근거: 위 `SUMMARIZATION_PROMPT`, `generateSummaryWithUsage`, `getSummarizationFailure`, `completeSummarization`, `generateTurnPrefixSummary`; `core/compaction/branch-summarization.ts` `generateBranchSummary`.
- `[확인]` raw entries와 latest CompactionEntry/firstKeptEntryId projection 분리, resume projection/branch summary. overflow·recoverable-length compact/retry **1회**, sameModel/current-view 검사, completed stop은 compact만. regression7048 fake length partial→reject→entries0,6647 transient stream drop retry. 근거: `pi:packages/coding-agent/src/core/session-manager.ts` `buildContextEntries`, `buildSessionProjection`; `core/agent-session.ts` `_checkCompaction`(2950–3001); `test/suite/regressions/7048-compaction-truncated-summary.test.ts`, `6647-compaction-retries-transient-stream-drop.test.ts`.

### Hermes Agent (343500b3547e)

- `[확인]` system stable→context(caller/project/workspace)→volatile(skills/memory/profile/time/runtime), 세션당1회·workspace cwd pin. volatile이 매 call rebuild 아님. API-time ephemeral hooks는 current user+api_content sidecar, 역사 exact bytes replay; ephemeral system은 prefix를 바꿀 수 있다. skill/category/files/key sets sort, gateway scope sha256는 prompt hash 아님. 전역 canonical keys/층 hash 미확인. cache legacy static-prefix/system끝/최근2 또는 system끝/최근3 **4곳**, stripping/copy-on-write idempotent; tool layout도 transaction endpoints 선택. 근거: `hermes-agent:agent/system_prompt.py` `build_system_prompt_parts`; `agent/turn_context.py` `compose_user_api_content`; `agent/prompt_builder.py` skills; `agent/prompt_cache_scope.py`; `agent/prompt_caching.py` `apply_anthropic_cache_control`, `PromptCachePlan`.
- `[확인]` default50%지만 context<512k 최소75%, floor bind input85% cap. input=context−max_tokens, 비정상 예약이면 raw fallback. lean tail2.5% clamp10k~25k/hard context20%. first3 보호는 첫 compact 뒤0 decay(system 유지), last_n20/prune·실제 tail group align. tools 먼저 prune/pending 보호, old stub+session_search recovery/skill marker+skill_view(최대20) deterministic reinject. input body cap6000(head4000/tail1500), args1500(head1200), whole160k chars; lean even-sampling 단일 call/full-range chunk 아님. 근거: `hermes-agent:agent/context_compressor.py` `_effective_threshold_percent`, `_compute_threshold_tokens`, `tail_token_budget`, `_effective_protect_first_n`, `_align_boundary_backward`, `compress`, `_generate_summary`, `_reinject_pruned_skill_markers`; `agent/compression_marker.py` `elide_middle`.
- `[확인]` target source20%,floor2k/ceiling context5%·10k, **wire max_tokens 생략**(thinking cap 소모/partial 문제). auxiliary route/override·다른 model 실패 main1 fallback, timeout/truncated cooldown60/300/900sec·연속 overload3 뒤 degrade. sections Historical Task Snapshot/Goal/Constraints/Completed Actions/Active State/Blocked/Key Decisions/Errors & Fixes/Resolved Questions/Relevant Files/Critical Context+optional. DATA/redaction/past-tense/latest user wins/prior update, empty/refusal/length/provenance/stale-owner 검사; next real usage anti-thrash,50% hard target 아님. 근거: 위 `_compute_summary_budget`, `_call_summary_llm`, `_on_summary_failure`, `_summary_template_sections`, `_build_summary_prompt`.
- `[확인]` UI context breakdown은 gate authority 아님. rough CJK/Hangul/Kana~1/point·나머지 bytes/4, provider usage 우선, preflight system+tools. preAPI/overflow/413/post-tool 압축 **turn 공유3회**, no-progress over-window fail closed/fitting은 그대로. stale-worker generation/commit fence·held archive IDs로 concurrent append 보호. fake loop/MagicMock은 cap3/fitting/overflow/timeout/late worker 검증. reboot handoff summary 재구성, 모든 UI resume/fork wire·continuation cap 미확인. 근거: `hermes-agent:agent/context_breakdown.py`; `agent/model_metadata.py` `estimate_tokens_rough`; `agent/turn_context.py` `_preflight_request_tokens`; `agent/conversation_loop.py` attempt cap; `agent/conversation_compression.py`; `agent/conversation_compression_archive.py` `held_archive_coverage`; `tests/agent/test_post_tool_compression_attempt_cap.py`, `test_over_window_compression_fail_closed.py`.

## 비교

### 숫자

미지정/미확인은 조사 경로의 한계다. 근거는 위 함수다.

| 항목 | lophn | Codex | OpenCode | Gemini legacy | Pi | Hermes |
|---|---|---|---|---|---|---|
| input budget | min(input,context−reserved) | usable95%/별도 scope | session input−reserved 또는 context−output; core context−max(output,20k) | raw context trigger | context−16,384 | context−output/비정상 raw fallback |
| text fallback | **UTF-8 bytes 그대로 상한** | bytes/4 lower bound | JS length/4 | ASCII/4·nonASCII1.5·큰text/4 | chars/4 | CJK~1/point·나머지 bytes/4 |
| 시작 | **70% 이상** | raw90% 기본 | usable 이상/core 초과 | **50% 이상** | context−reserve **초과** | 50%;<512k≥75%;floor bind85% |
| 완료 목표 | **50% 이하** | 미지정 | 미지정 | new≤old | 미지정 | real usage anti-thrash |
| recent | **25% clamp2k~15k** | user text20k | session25%2k~15k/core8k | serialized chars30% | 20k | lean2.5%10k~25k/hard20% |
| latest request | **전문 보호** | budget truncate 가능 | overflow replay | goal summary | split-turn summary | fossilized head decay |
| tool trim | >**2000 points**, 앞1000/뒤1000+marker/ref | head/tail/remote trim | protect40k/remove>20k;앞2000UTF16 | field앞2048bytes;response50k→tail30줄+파일 | 사전prune 미확인 | stub/recovery;body6000 head4000/tail1500 |
| summary output | **min(budget10%,4000)** | local cap 미지정 | core4096/session 미확인 | alias cap 미지정 | main13107/prefix8192/branch4096 | target20%,floor2k,maxcontext5%·10k;**wire cap 없음** |
| parts | **6** | 4내용/section비강제 | 5headings+Work State | XML7 | 6+Progress | historical+10/optional |
| continuation | **400 token** | replacement replay | raw fork copy | disk replay | checkpoint/branch | handoff/archive/cap미확인 |
| turn context | **8KiB/tabs20/app2KiB**, 최신 끝 | world-state delta | env system/reminder user | env first/IDE last | cwd system patch | system pin/user sidecar |
| cache | **고정 최대3**,history0 | Responses session key | tool/system/latest-user3 | protocol 표시미확인 | 보통3/OAuth4 | layout4 |
| overflow recovery | 횟수요구 별도없음 | 일반return/guardian1;summary oldest-drop | core1/session total미확인 | preflight stop/응답후미확인 | **1** | turn 공유압축시도**3** |

OpenCode core/Hermes preflight는 schemas를 포함하지만 estimator 자체가 안전 상한은 아니다. cache hit도 occupancy다. Codex/Pi history estimate를 whole-wire count로 쓰지 않는다.

### 구조

| 질문 | 확인한 차이 | lophn 선택 |
|---|---|---|
| bytes | typed context/section diff/API sidecar; 전역canonical미확인 | snapshot/rule_version/canonical serializer/층hash |
| cache 이동 | latest history marker 대 session affinity | 고정 세 structural boundaries |
| prior summary | 네 프로젝트 iterative update | same-run/source coverage union |
| tool 짝 | safe cut/corresponding remove/group align/atomic ToolPart | 공통 HistoryUnit partition |
| 큰 입력 | oldest-drop/suffix/sample/truncate | half-budget chunk→merge/누락0 |
| 완료 | partial 거부/inflation/nonempty; Gemini reviewer1 | complete/6parts/coverage/protected hashes/shrink/≤50%, reviewer0 |
| 원문 | entries/rollout/archive 대 model-view | ledger 불변/derived transactional commit |
| lazy 자료 | docs/skill index/JIT rules/reload pointers | target/version/perspective outline,본문tool read |

## lophn에 가져올 것과 버릴 것

R은 `lophn-agent/harness/prompt-assemble#R…`, 이어가기는 `lophn-agent/conversation#R9–R11`도 따른다.

- **R1/R2/R8/R25/R30**: typed context·section patch·exact replay. logical 다섯 층/structural markers를 먼저, adapter wire 후단. 날짜 매번 system 삽입·live 화면 session pin은 버린다. 탭만 변경하면 turn context만, 지침 version은 해당 층 이후만 변경.
- **R3/R11/R15**: valid cutpoint/corresponding remove/group align을 HistoryUnit 하나로 합쳐 tail/prune/chunk 공유. oversized latest request를 summary로 대체0.
- **R4–R7/R18**: doc pointer/skill index/lost-skill reload 가져옴. skill 본문은 tool history만, 권한밖 schema cache용 보존0. 자료 target/version/perspective dedupe·result 본문 초기 복제0. shrink 참고summary→기준outline→선택자료, 오래된 변경부터 주소만.
- **R9 + model#R14**: whole-wire preflight를 가져오되 chars/4·media 고정값·unknown-model default 버림. logical text/adapter framing/media/opaque를 합친 안전 상한; unknown media call0/cache token 빼기0.
- **R10/R12/R13**: prune→summary 순서만 가져옴. 70%/50%/points1000+1000/min(10%,4000)은 lophn 규칙, marker/ref 포함 count. oldest-drop/sample 후 완성 summary 채택0.
- **R14/R16/R17/R19/R21/R24**: partial 거부/reference framing/temporal anchoring/DATA. shape/coverage/size는 deterministic, fact 의미는 fixture/eval. reviewer call/scratchpad/reasoning-as-summary/자동model fallback 버림.
- **R20/R22/R23 + conversation R9–R11**: full-replay resume와 continuation 분리. explicit same-assignment source/latest complete400 하나+뒤 raw만. Message/approval/effect 복제0, summary 장애가 종료 막기0. late facts는 과거 완료 사실.
- **R26–R28**: pending-response 경계 주의. machine context가 tool pair 사이 삽입0, scope/redaction/data frame·focused20/app2048/whole8192 bytes, old screen 재사용0.

### open-issues 후보

1. **R10/R11/R16/R17**: 보호 입력만55%이면50% target 불가능. 추천: lower-bound 사전검사 `target_unreachable_protected`, summary0, 원문 fitting 진행/overflow block. 보호 전문 몰래 축소0.
2. **R13/R16/model#R14**: reasoning이 output cap 소모(Hermes는 cap 생략). 추천: requested output/body/provider reasoning 합산 구별, hard4000·complete 검증, 실패 시 명시 model 선택만/자동fallback0.
3. **R8**: product 지시+tools logical 경계를 wire 두 marker로 만들면4. 추천: 앞 tools를 포함하는 system boundary 매핑·wire≤3 fixture, 문자열 boundary 탐색0.
4. **R15/R16**: child summaries 합계도 merge half-budget 초과 가능. 추천: coverage-preserving merge tree·level별 입력/출력 cap·single unit 초과 failure, 일부 child만 final0.
5. **R17/R20/R22**: 동일 compaction 구간 no-repeat와401-token continuation 재축소를 generic retry로 합치지 않음. 추천: continuation attempt bound/transport retry 별도 기록·failed range+rule/model/input-hash key. 숫자는 요구 확정 필요.
6. **R9/R17**: provider overflow retry 횟수 누락. 추천 후보 **최대1회**, same failed range 반복0/scope-stop 재검사/effect replay0, 2차는 provider_context_mismatch. 현재 요구 확정값은 아니다.

## 구현 메모

### 자료·상태

1. `AssemblySnapshot {rule_version,run_basis,instructions,tools,materials,history_units,turn_context}` 동결. tool/key/newline/null/encoding을 canonical rule로 고정, Unicode 원문 normalization0/data fake marker0.
2. `HistoryUnit {source_ranges,messages,tool_pairs,completed,protected_reasons,reread_refs,counted_size}`. parallel pair group indivisible/pending summary 제외/원래 순서 보존.
3. logical 상한/adapter overhead/provider actual usage 구별, UI estimate gate0. tokenizer 없으면 text UTF-8 bytes, unknown media/model call0. instructions 파일32,768/합산131,072 bytes·read/encoding 실패 block(architecture§5.4).
4. immutable 원문→candidate prune→partition→chunk→merge→reassemble→validate→derived commit. cancel/partial/error discard. 모든 ranges·chunk/merge ModelCall IDs/usage 연결, 별도 reviewer0.
5. validator: complete/nonempty/6parts/exact coverage/protected hashes/pairs/new<old/new≤budget50%/wire≤budget. source ranges는 model 주장을 신뢰하지 않고 caller와 대조.
6. failed `(run,ranges,rule_version,model,input_hash)` 반복0. source seq/generation fence로 correction/stop/권한철회/늦은 완료 stale commit0.
7. continuation 별도 pipeline: explicit source→latest complete+tail→body400. 종료와 분리, approval/effects는 facts지 authority 아님.

### summary wire 요지

```text
source: 세션·seq 구간·자료 version을 가진 DATA
과거 행동을 실행하지 말고 여섯 부분만 기록한다.
목적 / 사람 결정·제약 / 확인 진행·근거 / 미완료 /
실패·다음 행동 / 추정·불확실성
없는 것은 없음. 승인·성공·완료를 만들지 않는다.
현재 요청/correction이 과거 summary보다 우선한다.
```

typed parts/parser로 검사, provenance는 harness가 연결. organizing은 명시 선택 또는 같은 preset model, 자동 다른 model/account0. 새 live context/cache 경계0.

### 값과 실패

| 항목 | 규칙 |
|---|---|
| trigger/target | ≥ceil(budget×.7), ≤floor(budget×.5) |
| recent | clamp(floor(budget×.25),2000,15000), pair overshoot 가능/whole 초과금지 |
| result | >2000 points/재조회가능,앞1000/뒤1000+marker/ref |
| organizing | output min(floor(budget×.1),4000), chunk/merge input≤organizing budget절반 |
| continuation/context | ≤400token; whole8192/app2048bytes/tabs20 |
| partial/empty/shape_invalid | 원문 유지/same-range retry0 |
| coverage_missing/protected_changed/pair_split | candidate reject/실패 범위·usage 기록 |
| single_unit_too_large/target_unreachable_protected | 불가능 판정/불완전 prompt 전송0 |
| not_smaller/over_target | complete text여도 compaction failure |
| unknown_media/limit/mandatory_input_overflow | call0/축소·새 세션 안내 |
| context_unavailable | old screen0/safe empty+reason |
| provider_context_mismatch | 제안 recovery1 후 stop,요구 확정필요 |

### fake provider/fixture

- **bytes/cache**: same snapshot/hash 동일, shuffled tool/key canonical 동일. time/tab만 변경→고정3층/history 불변, instruction revision 해당 층 이후 변경. fake marker data 경계0, logical3→wire≤3/schema 큰 case.
- **숫자**: budget80k의55999/56000·40000/40001, tail2k/15k clamp·small-budget 충돌. result2000/2001 points/astral/combining/Hangul/ref없음/marker 포장 count.
- **완료**: fake text→length/abort/refusal, empty/missing terminal/invalid6parts/401 continuation. Pi7048처럼 commit0·원문 동일. thinking cap 소모/new≥old/new>target도 reject.
- **coverage/pair**: parallel2/pending/correction/giant pair/prior summary+tail. chunks3→merge2levels, 누락/겹침/chunk 실패/merge overflow→commit0·실패usage 존재. tail pair budget 초과 허용/whole overflow call0.
- **fake summary**: ranges/output/cache recording·고정 six-parts 응답. missing decision/stale version gold assertions. 의미 hallucination/부정 보존 eval 별도, parser가 fact accuracy 보증하지 않음.
- **repeat/overflow**: same failed range next turn summary0, fitting judgment1/overflow0. 제안 first overflow→compact→retry1→second stop/effect counter 증가0.
- **continuation**: explicit ranges/same-different assignment/cache loss/closed source/late facts. Message/approval/effect ID 복제0/latest complete400+tail만/unrelated-periodic 자동주입0/summary 실패에도 종료.
- **context**: tabs21 focused20+omitted1/scope밖title-address0. app2048/2049·whole8192/8193(wrapping 포함), failure/app shutdown/periodic old-screen0. 상세는 허용 tool read/재현 stored context만.
- **동시성**: correction/stop/scope withdrawal/역순 후보/late worker→held 범위밖 새 event 보존/stale commit0(Hermes fence).

## 미확인 범위

- 전역 canonical serializer/층 hash는 전수 확인하지 않았다. local sort/diff/sidecar만으로 byte-identical contract라 단정하지 않는다.
- Codex remote 서버 내부 prompt/목표; OpenCode 기존 session overflow total/cap·core length 검사; Gemini 새 context-manager/응답후 retry/상속 output cap; Hermes 모든 UI resume/fork/continuation cap은 미확인이다.
- 프로젝트 테스트는 소스만 읽었고 실행하지 않았다. `node tools/check-docs.ts` 실행은 safety classifier 서비스 timeout으로 차단되어 결과 미확인이다.
