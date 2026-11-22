import { defineProject } from "vitest/config";
import { unitProject } from "../../vitest.shared.ts";

export default defineProject(unitProject("@agentcontext/mcp-server"));
