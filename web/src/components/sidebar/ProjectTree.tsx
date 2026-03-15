import type { ProjectGroup } from "../../types/agent";
import { ProjectItem } from "./ProjectItem";

interface ProjectTreeProps {
  groups: ProjectGroup[];
}

export function ProjectTree({ groups }: ProjectTreeProps) {
  if (groups.length === 0) {
    return (
      <div className="px-3 py-4 text-xs text-neutral-600">
        No projects found
      </div>
    );
  }

  return (
    <nav className="flex flex-col">
      {groups.map((g) => (
        <ProjectItem key={g.project} group={g} />
      ))}
    </nav>
  );
}
