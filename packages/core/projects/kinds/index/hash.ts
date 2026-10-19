import { createHash } from "node:crypto";

export const sha256Text = (text: string): string =>
  createHash("sha256").update(text).digest("hex");
