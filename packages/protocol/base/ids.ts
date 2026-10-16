import { z } from "zod";

// domain-model/platform/ledger.md의 ID 접두사 표. 접두사 목록은 여기만 갖는다.
const ID_PREFIXES = {
  prj: "Project",
  doc: "Document",
  ver: "Version",
  ctx: "Context",
  cbn: "ContextBundle",
  chk: "ContextCheck",
  trm: "GlossaryEntry",
  ser: "Series",
  viw: "SavedView",
  app: "App",
  rel: "Release",
  grt: "Grant",
  inv: "Invocation",
  pkg: "Package",
  rpt: "Report",
  prb: "Problem",
  snp: "Snapshot",
  vrf: "Verification",
  apr: "ApprovalRequest",
  qgr: "QuestionGroup",
  qst: "Question",
  rvt: "Revert",
  pst: "Preset",
  asg: "Assignment",
  ses: "Session",
  msg: "Message",
  mcl: "ModelCall",
  tcl: "ToolCall",
  pvd: "Provider",
  tkt: "Ticket",
  cac: "CodingAgentConnection",
  agt: "Agent",
  trn: "Turn",
  cal: "Call",
  act: "ActivationAttempt",
  rwd: "Rewind",
  ann: "Annotation",
  anb: "AnnotationBatch",
} as const;

export type IdPrefix = keyof typeof ID_PREFIXES;

// 소문자 Crockford base32. 첫 글자는 시각 48bit의 상위 bit라 0~7만 된다.
const ULID = "[0-7][0-9a-hjkmnp-tv-z]{25}";

export function idSchema<P extends IdPrefix>(prefix: P) {
  return z.string().regex(new RegExp(`^${prefix}_${ULID}$`));
}

// port와 값 type이 쓰는 id 모양이다. 값 검사는 `idSchema(prefix)`가 한다.
export type Id<P extends IdPrefix> = `${P}_${string}`;

function isIdPrefix(prefix: string): prefix is IdPrefix {
  return Object.hasOwn(ID_PREFIXES, prefix);
}

// 접두사 표의 어느 id든 받는다.
export const anyIdSchema = z.string().refine(
  (value) => {
    const prefix = value.slice(0, value.indexOf("_"));
    return isIdPrefix(prefix) && idSchema(prefix).safeParse(value).success;
  },
  { message: "invalid id" },
);

export const turnIdSchema = idSchema("trn");

