// lophn-agent의 정의 쪽(질문 글, trace export, provider login, agent profile). 쓰기 앞 처리기가 세 자리라
// wiring이 셋이다(assembly.ts의 순서가 접는 순서다).
import { ok } from "../../../../base/mod.ts";
import {
  agentProfilesRead,
  agentProfilesUpload,
} from "../../../../protocol/lophn-agent/mod.ts";
import { agentProfileHandlers } from "../../../lophn-agent/register.ts";
import {
  type TraceExportWriterDeps,
  withTraceExport,
} from "../../../lophn-agent/observability/trace-export.ts";
import { withProviderLogin } from "../../../lophn-agent/providers/login.ts";
import {
  createQuestionTextPreparer,
  withQuestionText,
} from "../../../lophn-agent/tools/questions/text-prepare.ts";
import type { WiringFactory } from "./context.ts";

// 질문 글(본문·이유·설명·자유 답·취소 이유)도 message body와 같은 길로 redaction해 blob으로 준비한다.
export const lophnAgentWiring: WiringFactory = () => ({
  name: "lophn-agent",
  build(ctx) {
    const profiles = agentProfileHandlers(ctx.runtime.readers, ctx.root.path);
    return ok({
      writer: (inner) =>
        withQuestionText(
          inner,
          createQuestionTextPreparer({ relay: () => ctx.bodyPrepare }),
        ),
      // profile 이미지 올리기: 자리·역할은 reader가 보고 파일은 core가 비동기로 쓴다.
      uploads: [[
        `${agentProfilesUpload.resource}/${agentProfilesUpload.method}`,
        profiles.upload,
      ]],
      // 큰 파일을 core 메모리에 모으지 않고 창 단위로 흘리는 file route.
      // profile 이미지 읽기: 정의의 profile이 가리키는 파일을 실제 형식의 Content-Type으로 흘린다.
      fileStreams: [[
        `${agentProfilesRead.resource}/${agentProfilesRead.method}`,
        profiles.file,
      ]],
    });
  },
});

// trace export는 writer queue 앞에서 로컬 파일에 쓴다. ledger 경로와 blob 읽기 통로만 쓰고 계기 기록이 없다.
export const lophnAgentTraceExportWiring: WiringFactory = () => ({
  name: "lophn-agent-trace-export",
  build(ctx) {
    const deps: TraceExportWriterDeps = {
      ledgerPath: ctx.ledgerPath,
      readBlob: (hash, offset, length) =>
        ctx.blobRead.deps.read(hash, offset, length),
      known: () => ctx.knownSecrets,
    };
    return ok({ writer: (inner) => withTraceExport(inner, deps) });
  },
});

// OAuth 로그인도 writer queue 앞에서 listener와 network를 기다린다. login 세션은 처리기 메모리에만 있다.
export const lophnAgentProviderLoginWiring: WiringFactory = () => ({
  name: "lophn-agent-provider-login",
  build: () => ok({ writer: (inner) => withProviderLogin(inner) }),
});
