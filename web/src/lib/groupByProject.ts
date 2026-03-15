import type { Agent, ProjectGroup } from "../types/agent";

/** Extract display name from git_common_dir or cwd */
function displayName(path: string): string {
  // Strip trailing slashes and /.git suffix (git_common_dir typically ends with /.git)
  const cleaned = path.replace(/\/+$/, "").replace(/\/\.git$/, "");
  const parts = cleaned.split("/");
  return parts[parts.length - 1] || path;
}

/** Group agents by git_common_dir, falling back to cwd */
export function groupByProject(agents: Agent[]): ProjectGroup[] {
  const map = new Map<string, Agent[]>();

  for (const agent of agents) {
    const key = agent.git_common_dir ?? agent.cwd;
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
