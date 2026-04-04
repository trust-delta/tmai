import { describe, expect, it } from "vitest";
import type { AgentSnapshot } from "@/lib/api-http";

// Helper to create a minimal agent snapshot for testing
function makeAgent(overrides: Partial<AgentSnapshot> = {}): AgentSnapshot {
  return {
    id: "agent-1",
    target: "test-agent",
    cwd: "/tmp",
    agent_type: "ClaudeCode",
    status: "Processing",
    is_orchestrator: false,
    ...overrides,
  } as AgentSnapshot;
}

describe("orchestrator running detection", () => {
  it("should detect when an orchestrator is running", () => {
    const agents = [
      makeAgent({ id: "a1", is_orchestrator: false }),
      makeAgent({ id: "a2", is_orchestrator: true }),
    ];
    const running = agents.some((a) => a.is_orchestrator);
    expect(running).toBe(true);
  });

  it("should return false when no orchestrator is running", () => {
    const agents = [
      makeAgent({ id: "a1", is_orchestrator: false }),
      makeAgent({ id: "a2", is_orchestrator: false }),
    ];
    const running = agents.some((a) => a.is_orchestrator);
    expect(running).toBe(false);
  });

  it("should return false for empty agent list", () => {
    const agents: AgentSnapshot[] = [];
    const running = agents.some((a) => a.is_orchestrator);
    expect(running).toBe(false);
  });

  it("should handle agents with undefined is_orchestrator", () => {
    const agents = [makeAgent({ id: "a1" })];
    // is_orchestrator is optional — undefined should be falsy
    const agent = { ...agents[0], is_orchestrator: undefined };
    const running = [agent].some((a) => a.is_orchestrator);
    expect(running).toBe(false);
  });
});
