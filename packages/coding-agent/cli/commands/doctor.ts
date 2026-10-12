// `lophn doctor` command다(coding-agent/cli#R10, harnesses#R3·R10,
// connection#R13·R14, T32). daemon·인증·설정과 harnesses의 네 loading 단계를
// 서로 섞지 않고 각각 성공·실패·확인 못함, 이유, 다음 확인으로 낸다. 읽기만
// 한다. 파일·workspace·trust·권한·credential을 바꾸거나 넓히지 않고
// credential 원문은 받지도 내지도 않는다(R12). daemon 상태·connection 읽기·
// credential 사용 가능 여부·파일·MCP probe는 port로 받고(daemon.ts와 같은
// 모양) 조립이 실제 구현을 끼운다.
import { err, ok, type Result } from "../../../base/mod.ts";
import {
  cliDoctorSchema,
  type ComponentObservation,
  type CredentialDeliveryFailure,
  type HarnessIntegrationObservation,
  type IntegrationTarget,
  type LoadingResult,
} from "../../../protocol/coding-agent/mod.ts";
import {
  catalogOf,
  environmentSupported,
  inspectIntegration,
  type InspectPorts,
  type LoadingConnection,
  type LoadingReport,
  type LoadingTrust,
  LOPHN_SKILL_NAMES,
  unobservedLoading,
} from "../../harnesses/mod.ts";
import type { RootInputs } from "../../harnesses/mod.ts";
import type { CommandEntry } from "./types.ts";

export const DOCTOR_COMMANDS: readonly CommandEntry[] = [
  { name: "doctor", input: cliDoctorSchema },
];

export type DoctorPorts = InspectPorts & {
  // `H/run` metadata와 lock 판정이다(daemon.ts DaemonPort.status와 같은 값).
  daemon: {
    status(): Promise<
      Result<{
        state: "absent" | "running" | "conflict";
        metadata: "present" | "absent";
      }>
    >;
  };
  // connection 읽기다(C-연결). 상태만 받고 credential은 받지 않는다.
  connections: {
    read(id: string): Promise<Result<{ state: "active" | "revoked" }>>;
  };
  // credential 사용 가능 여부다(platform 인증). 원문은 이 port 밖으로 나오지
  // 않고 여기서는 사용 가능 여부와 실패 이유만 받는다.
  credential: {
    available(id: string): Promise<"available" | CredentialDeliveryFailure>;
  };
};

export type DoctorInput = {
  target?: IntegrationTarget;
  // 사람이 고른 connection 참조다. 없으면 인증은 검사하지 않는다.
  connection: string | null;
  roots: RootInputs;
  denoExecutable: string;
  now: string;
  expectedTools: readonly string[];
  expectedSkills?: readonly string[];
  trust?: LoadingTrust;
  workspace?: string | null;
  cliFallback?: LoadingResult;
};

type Section = { result: LoadingResult; reason: string; next: string };

export type DoctorReport = {
  daemon: Section & { state: "absent" | "running" | "conflict" | "unknown" };
  auth: Section & {
    connection: string | null;
    connection_state: "active" | "revoked" | "unknown" | "not_selected";
    credential:
      | "available"
      | CredentialDeliveryFailure
      | "unknown"
      | "not_checked";
  };
  config: {
    receipt: "present" | "absent" | "not_selected";
    components: ComponentObservation[];
    reason: string;
    next: string;
  };
  loading: LoadingReport[];
  observation: HarnessIntegrationObservation | null;
};

async function daemonSection(
  ports: DoctorPorts,
): Promise<DoctorReport["daemon"]> {
  const status = await ports.daemon.status();
  if (!status.ok) {
    return {
      result: "unknown",
      state: "unknown",
      reason: "daemon 상태를 읽지 못했다",
      next: "`lophn daemon status`를 다시 실행한다",
    };
  }
  if (status.value.state === "running") {
    return {
      result: "success",
      state: "running",
      reason: "daemon이 실행 중이다",
      next: "",
    };
  }
  return {
    result: "failure",
    state: status.value.state,
    reason: status.value.state === "absent"
      ? "daemon이 실행 중이 아니다"
      : "daemon lock이 충돌 상태다",
    next: status.value.state === "absent"
      ? "사람이 `lophn daemon start`로 시작한다"
      : "`lophn daemon logs`를 보고 사람이 정리한다",
  };
}

async function authSection(
  input: DoctorInput,
  ports: DoctorPorts,
): Promise<{ section: DoctorReport["auth"]; connection: LoadingConnection }> {
  if (input.connection === null) {
    return {
      connection: null,
      section: {
        result: "unknown",
        connection: null,
        connection_state: "not_selected",
        credential: "not_checked",
        reason: "connection을 고르지 않아 인증을 검사하지 않았다",
        next: "`lophn connection list`에서 연결을 골라 `--connection`을 준다",
      },
    };
  }
  const id = input.connection;
  const read = await ports.connections.read(id);
  if (!read.ok) {
    return {
      connection: { id, state: "unknown" },
      section: {
        result: "unknown",
        connection: id,
        connection_state: "unknown",
        credential: "not_checked",
        reason: "connection 상태를 읽지 못했다",
        next: "`lophn connection show`로 다시 확인한다",
      },
    };
  }
  if (read.value.state === "revoked") {
    return {
      connection: { id, state: "revoked" },
      section: {
        result: "failure",
        connection: id,
        connection_state: "revoked",
        credential: "not_checked",
        reason: "연결이 회수되어 credential을 쓸 수 없다",
        next: "사람이 새 연결을 만든다. 회수한 연결은 되살리지 않는다",
      },
    };
  }
  const credential = await ports.credential.available(id);
  const available = credential === "available";
  return {
    connection: { id, state: "active" },
    section: {
      result: available ? "success" : "failure",
      connection: id,
      connection_state: "active",
      credential,
      reason: available
        ? "연결이 active이고 credential을 쓸 수 있다(설치나 loading 성공이 아니다)"
        : `연결은 active이나 credential을 쓸 수 없다(${credential})`,
      next: available
        ? ""
        : "keychain 잠금·Secret Service·시간 초과를 사람이 확인한다. 평문 fallback은 없다",
    },
  };
}

export async function doctorOf(
  input: DoctorInput,
  ports: DoctorPorts,
): Promise<Result<DoctorReport>> {
  const daemon = await daemonSection(ports);
  const auth = await authSection(input, ports);
  if (input.target === undefined) {
    return ok({
      daemon,
      auth: auth.section,
      config: {
        receipt: "not_selected",
        components: [],
        reason: "target을 고르지 않아 설정을 검사하지 않았다",
        next: "`--target`으로 제품을 골라 다시 실행한다",
      },
      loading: unobservedLoading(
        "target을 고르지 않아 loading을 검사하지 않았다",
        "`--target`으로 제품과 범위를 고른다",
      ),
      observation: null,
    });
  }
  const definition = catalogOf(input.target.harness_id);
  if (definition === undefined) {
    return err({ code: "invalid_input", message: "알 수 없는 제품이다" });
  }
  const supported = environmentSupported(definition, input.target.environment);
  if (!supported.ok) return supported;
  const inspection = await inspectIntegration({
    definition,
    target: input.target,
    roots: input.roots,
    denoExecutable: input.denoExecutable,
    expectedTools: input.expectedTools,
    expectedSkills: input.expectedSkills ?? LOPHN_SKILL_NAMES,
    connection: auth.connection,
    trust: input.trust,
    workspace: input.workspace,
    cliFallback: input.cliFallback,
    now: input.now,
  }, ports);
  const components = inspection.observation.components;
  return ok({
    daemon,
    auth: auth.section,
    config: {
      receipt: components.length > 0 ? "present" : "absent",
      components,
      reason: components.length > 0
        ? "receipt가 가리키는 resource의 현재 상태다(loading 성공을 뜻하지 않는다)"
        : "이 target의 설치 receipt가 없다",
      next: components.length === 0
        ? "설치는 사람이 고른 `lophn harness plan`으로만 한다"
        : components.every((item) => item.state === "current")
        ? ""
        : "modified·missing·error resource는 사람이 확인한다. lophn은 고치지 않는다",
    },
    loading: inspection.loading,
    observation: inspection.observation,
  });
}

// 사람이 읽는 요약과 다음 확인이다(output 공통 모양).
export function doctorSummary(
  report: DoctorReport,
): { summary: string; next: string[] } {
  const parts = [
    `daemon ${report.daemon.result}`,
    `auth ${report.auth.result}`,
    ...report.loading.map((item) => `${item.stage} ${item.result}`),
  ];
  const next = [
    report.daemon.next,
    report.auth.next,
    report.config.next,
    ...report.loading.filter((item) => item.result !== "success").map((
      item,
    ) => item.next),
  ].filter((item) => item !== "");
  return { summary: parts.join(" · "), next: [...new Set(next)] };
}
