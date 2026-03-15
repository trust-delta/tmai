import { useMemo } from "react";
import { useAgentsStore } from "../../stores/agents";
import { groupByProject } from "../../lib/groupByProject";
import { ProjectTree } from "../sidebar/ProjectTree";

export function Sidebar() {
  const agents = useAgentsStore((s) => s.agents);
  const selectedProject = useAgentsStore((s) => s.selectedProject);
  const selectProject = useAgentsStore((s) => s.selectProject);
  const groups = useMemo(() => groupByProject(agents), [agents]);

  return (
    <aside className="flex w-56 shrink-0 flex-col overflow-y-auto border-r border-neutral-300 bg-neutral-200 dark:border-neutral-800 dark:bg-transparent">
      <button
        onClick={() => selectProject(null)}
        className={`w-full px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider hover:bg-neutral-300 dark:hover:bg-neutral-800 ${
          selectedProject === null
            ? "text-blue-600 dark:text-blue-400"
            : "text-neutral-500"
        }`}
      >
        All Projects
      </button>
      <ProjectTree groups={groups} />
    </aside>
  );
}
