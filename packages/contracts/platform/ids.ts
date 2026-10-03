import { z } from "zod";

// domain-model/platform/ledger.md의 ID 접두사 표. 접두사 목록은 여기만 갖는다.
export const ID_PREFIXES = {
  prj: "Project",
  doc: "Document",
  ver: "Version",
  ctx: "Context",
  trm: "Term",
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
  qst: "Question",
  ntf: "Notification",
  rvt: "Revert",
  pst: "Preset",
  asg: "Assignment",
  ses: "Session",
  msg: "Message",
  run: "Run",
  mcl: "ModelCall",
  tcl: "ToolCall",
  pvd: "Provider",
  tkt: "Ticket",
  cac: "CodingAgentConnection",
} as const;

export type IdPrefix = keyof typeof ID_PREFIXES;

// 소문자 Crockford base32. 첫 글자는 시각 48bit의 상위 bit라 0~7만 된다.
const ULID = "[0-7][0-9a-hjkmnp-tv-z]{25}";

export function idSchema<P extends IdPrefix>(prefix: P) {
  return z.string().regex(new RegExp(`^${prefix}_${ULID}$`));
}

export const runIdSchema = idSchema("run");

export type RunId = z.infer<typeof runIdSchema>;
