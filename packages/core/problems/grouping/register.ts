import type { ProblemsPart } from "../register.ts";
import { setProblemStateCommand } from "./commands.ts";
import { problemGetRead, problemListRead } from "./reads.ts";

export const groupingPart = {
  commands: [setProblemStateCommand],
  reads: [problemListRead, problemGetRead],
  readerReads: [problemListRead, problemGetRead],
} satisfies ProblemsPart;
