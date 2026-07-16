import type { Tool } from "./types";
import { TOOLS_A } from "./tools-data-a";
import { TOOLS_B } from "./tools-data-b";

export const TOOLS: readonly Tool[] = [...TOOLS_A, ...TOOLS_B] as const;
