import type { Agent, ProjectGroup } from "../types/agent";

/** Normalize project key by stripping trailing slashes and /.git suffix */
export function projectKey(agent: Agent): string {
  const raw = agent.git_common_dir ?? agent.cwd;
  return raw.replace(/\/+$/, "").replace(/\/\.git$/, "");
}

/** Extract display name from a normalized project key */
function displayName(key: string): string {
  const parts = key.split("/");
  return parts[parts.length - 1] || key;
}

/** Group agents by normalized project key */
export function groupByProject(agents: Agent[]): ProjectGroup[] {
  const map = new Map<string, Agent[]>();

  for (const agent of agents) {
    const key = projectKey(agent);
    const group = map.get(key);
    if (group) {
      group.push(agent);
    } else {
      map.set(key, [agent]);
    }
  }

  const groups: ProjectGroup[] = [];
  for (const [project, groupAgents] of map) {
    groups.push({
      project,
      displayName: displayName(project),
      agents: groupAgents,
    });
  }

  // Sort by project name
  groups.sort((a, b) => a.displayName.localeCompare(b.displayName));
  return groups;
}
