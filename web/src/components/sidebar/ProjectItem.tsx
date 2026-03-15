import { useState } from "react";
import { useAgentsStore } from "../../stores/agents";
import type { ProjectGroup } from "../../types/agent";
import { AgentTreeItem } from "./AgentTreeItem";

interface ProjectItemProps {
  group: ProjectGroup;
}

export function ProjectItem({ group }: ProjectItemProps) {
  const [expanded, setExpanded] = useState(true);
  const selectedProject = useAgentsStore((s) => s.selectedProject);
  const selectProject = useAgentsStore((s) => s.selectProject);

  const isSelected = selectedProject === group.project;
  const attentionCount = group.agents.filter((a) => a.needs_attention).length;

  return (
    <div>
      <div
        className={`flex w-full items-center gap-0.5 text-sm ${
          isSelected
            ? "bg-neutral-300 text-neutral-900 dark:bg-neutral-800 dark:text-white"
            : ""
        }`}
      >
        {/* Toggle expand/collapse */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            setExpanded(!expanded);
          }}
          className="shrink-0 px-1.5 py-1.5 text-xs text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300"
        >
          {expanded ? "▼" : "▶"}
        </button>
        {/* Select project */}
        <button
          onClick={() => selectProject(group.project)}
          className="flex min-w-0 flex-1 items-center gap-1.5 py-1.5 pr-3 text-left hover:bg-neutral-200 dark:hover:bg-neutral-700"
        >
          <span className="truncate flex-1">{group.displayName}</span>
          {attentionCount > 0 && (
            <span className="rounded-full bg-yellow-600 px-1.5 text-xs font-medium text-white">
              {attentionCount}
            </span>
          )}
        </button>
      </div>
      {expanded && (
        <div className="ml-2">
          {group.agents.map((agent) => (
            <AgentTreeItem key={agent.id} agent={agent} />
          ))}
        </div>
      )}
    </div>
  );
}
