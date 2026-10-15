// session. message body, rewind. 쓰기 앞 처리기가 두 자리라 message body와
// rewind는 wiring이 따로다(assembly.ts의 순서가 접는 순서다).
import { ok } from "../../../../base/mod.ts";
import { sha256Hex } from "../../../../base/mod.ts";
import {
  createMessageBodyPreparer,
  messageBodyEnvironment,
  withMessageBody,
} from "../../../lophn-agent/session/message-body.ts";
import { createRewindStore } from "../../../lophn-agent/session/rewind/mod.ts";
import {
  amendInstall,
  ledgerSnapshot,
  REWIND_INSTALL_CONTEXT,
  withRewindFiles,
} from "../../../lophn-agent/session/rewind/files.ts";
import { answeredFacts } from "../../../lophn-agent/session/rewind/facts.ts";
import { projectRootOf } from "../../../lophn-agent/session/rewind/root.ts";
import { reconcileRewindInstalls } from "../../../lophn-agent/session/rewind/reconcile.ts";
import {
  REWIND_SWEEP_INTERVAL_MS,
  sweepRewind,
} from "../../../lophn-agent/session/rewind/sweep-core.ts";
import {
  createRewindSummaries,
  rewindSummaryTarget,
} from "../../../lophn-agent/session/rewind/summary.ts";
import {
  createProductRedactor,
  type RewindFilesDeps,
  type WiringFactory,
} from "./context.ts";

// 메시지 본문을 싣는 command는 writer 앞에서 값을 redaction해 blob으로 준비한다.
export const lophnAgentSessionWiring: WiringFactory = () => ({
  name: "lophn-agent-session",
  // 메시지 본문·질문 글·approval 설명 글을 읽는 통로. 참조 판정은 ledger snapshot, 바이트는 blob 읽기다.
  environment(ctx) {
    // 사람 화면이 run 본문을 볼 때 쓰는 지금의 redaction. 알려진 secret 값은 runtime이 열린 뒤에 채운다.
    // 채우기 전에 읽으면 알려진 값을 모른 채 내보내지 않도록 ready가 false다.
    const bodyRedactor = createProductRedactor({
      get ready() {
        return ctx.peek.knownSecrets?.ready ?? false;
      },
      match: (text: string) => ctx.peek.knownSecrets?.match(text),
    });
    return {
      // ReadMessageBody의 참조 판정과 blob 바이트 읽기 통로.
      messageBody: messageBodyEnvironment({
        ledgerPath: ctx.ledgerPath,
        read: (hash, offset, length) =>
          ctx.blobRead.deps.read(hash, offset, length),
      }),
      // ReadRunBodyView가 본문을 내보내기 전에 거치는 지금의 redaction.
      redactBody: (text: string) =>
        bodyRedactor(
          {
            concern: "lophn-agent/observability",
            revision: "1",
            scope: "run-body",
          },
          "text/plain",
          text,
        ),
    };
  },
  build: (ctx) =>
    ok({
      writer: (inner) =>
        withMessageBody(
          inner,
          createMessageBodyPreparer({
            relay: () => ctx.bodyPrepare,
            // 알려진 secret 값도 pattern과 함께 가린다. 값을 다 모르는 동안은 막는다.
            known: () => ctx.knownSecrets,
          }),
        ),
    }),
});

export const lophnAgentRewindWiring: WiringFactory = () => {
  let sweepTimer: ReturnType<typeof setInterval> | undefined;
  return {
    name: "lophn-agent-rewind",
    // 되돌리기 설치가 건너뛴 경로를 결과에 반영하는 core 내부 machine 자격 기록. 기록이 없으면 writer가
    // AmendRevertInstall을 거절해 복원하지 못한 파일이 복원됐다고 남으므로 기동을 여기서 멈춘다.
    records: () => [REWIND_INSTALL_CONTEXT],
    build(ctx) {
      const store = createRewindStore(ctx.root.path);
      // 되돌리기의 파일 일(관측·준비·설치)이 쓰는 통로다. 쓰기 앞 처리기와 앱 단계 이어 실행이 같이 쓴다.
      const files: RewindFilesDeps = {
        snapshot: <T>(read: Parameters<typeof ledgerSnapshot<T>>[1]) =>
          ledgerSnapshot(ctx.ledgerPath, read),
        rootOf: projectRootOf,
        answeredFacts,
        store,
        relay: () => ctx.bodyPrepare,
      };
      ctx.provide("rewindFiles", files);
      // "Summarize from here"의 요약 요청 대기열이다. 사람이 요청하면 runtime이 가져가 요약 call을 한다.
      const summaries = createRewindSummaries({
        resolve: rewindSummaryTarget(files.snapshot),
        newId: () => crypto.randomUUID(),
        now: () => ctx.clock.nowMs(),
      });
      return ok({
        writer: (inner) => withRewindFiles(inner, files),
        // 요약 요청(사람)과 가져가기·끝내기(runtime)의 입구다.
        memory: summaries.handlers,
      });
    },
    async start(ctx) {
      // 설치 전에 죽어 파일이 복원되지 않은 항목을 결과에 반영한다. 한 번만 돈다.
      await reconcileRewindInstalls({
        snapshot: (read) => ledgerSnapshot(ctx.ledgerPath, read),
        rootOf: projectRootOf,
        amend: async (revert, paths) =>
          await amendInstall(
            ctx.runtime.writer,
            revert,
            paths,
            `rewind-recover:${revert}:${await sha256Hex(paths.join("\n"))}`,
          ),
      }).catch(() => 0);
      // 되돌리기 저장소의 고아 저장물과 닫히거나 지워진 session의 디렉터리를 쓴다. 시작 때와 한 시간마다다.
      const sweep = () =>
        sweepRewind({
          ledgerPath: ctx.ledgerPath,
          store: ctx.rewindFiles.store,
          nowMs: ctx.clock.nowMs(),
        }).catch(() => undefined);
      sweepTimer = setInterval(sweep, REWIND_SWEEP_INTERVAL_MS);
      await sweep();
      return ok(undefined);
    },
    closeWork() {
      if (sweepTimer !== undefined) clearInterval(sweepTimer);
    },
  };
};
