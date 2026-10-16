import type { ProblemsPart } from "../register.ts";
import { releaseLookupOf } from "../../apps/releases/store.ts";
import { defineTxPort } from "../../storage/ledger/mod.ts";
import { ReleaseLookupPort } from "../reporting/mod.ts";
import { problemMoreRead } from "./more.ts";

// release 사실은 releases 표에서 읽는다. 접수 transaction(writer)과 reader가 같은 key로 받는다.
export const repairsPart = {
  reads: [problemMoreRead],
  readerReads: [problemMoreRead],
  ports: [defineTxPort(ReleaseLookupPort, () => releaseLookupOf)],
  readerPorts: [[ReleaseLookupPort, releaseLookupOf]],
} satisfies ProblemsPart;
