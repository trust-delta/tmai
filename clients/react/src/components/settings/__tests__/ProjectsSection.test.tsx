// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    api: {
      addProject: vi.fn(),
      removeProject: vi.fn(),
    },
  };
});

vi.mock("@/components/project/DirBrowser", () => ({
  DirBrowser: ({ onSelect }: { onSelect: (path: string) => void }) => (
    <button type="button" onClick={() => onSelect("/picked")}>
      mock-pick
    </button>
  ),
}));

const { api } = await import("@/lib/api");
const { ProjectsSection } = await import("../ProjectsSection");

function setup(projects: string[] = []) {
  const refreshProjects = vi.fn();
  const onProjectsChanged = vi.fn();
  render(
    <ProjectsSection
      projects={projects}
      refreshProjects={refreshProjects}
      onProjectsChanged={onProjectsChanged}
    />,
  );
  return { refreshProjects, onProjectsChanged };
}

describe("ProjectsSection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders a placeholder when the project list is empty", () => {
    setup([]);
    expect(screen.getByText(/No projects registered/i)).toBeTruthy();
  });

  it("renders one row per project with a Remove button", () => {
    setup(["/a/b/proj-one", "/c/d/proj-two"]);
    expect(screen.getByText("proj-one")).toBeTruthy();
    expect(screen.getByText("proj-two")).toBeTruthy();
    expect(screen.getAllByLabelText(/Remove project/)).toHaveLength(2);
  });

  it("Add button calls api.addProject + refreshProjects + onProjectsChanged", async () => {
    vi.mocked(api.addProject).mockResolvedValue(undefined as never);
    const { refreshProjects, onProjectsChanged } = setup([]);

    const input = screen.getByLabelText("Project path") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "/new/path" } });
    fireEvent.click(screen.getByRole("button", { name: /^Add$/ }));

    await waitFor(() => {
      expect(vi.mocked(api.addProject)).toHaveBeenCalledWith("/new/path");
      expect(refreshProjects).toHaveBeenCalledTimes(1);
      expect(onProjectsChanged).toHaveBeenCalledTimes(1);
    });
    expect(input.value).toBe("");
  });

  it("Enter on the path field triggers Add", async () => {
    vi.mocked(api.addProject).mockResolvedValue(undefined as never);
    setup([]);
    const input = screen.getByLabelText("Project path") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "/p" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(vi.mocked(api.addProject)).toHaveBeenCalledWith("/p"));
  });

  it("trimmed-empty input does not call api.addProject", () => {
    setup([]);
    const input = screen.getByLabelText("Project path") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: /^Add$/ }));
    expect(vi.mocked(api.addProject)).not.toHaveBeenCalled();
  });

  it("Add failure surfaces inline error text and does NOT clear input", async () => {
    vi.mocked(api.addProject).mockRejectedValue(new Error("path not found"));
    const { refreshProjects } = setup([]);
    const input = screen.getByLabelText("Project path") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "/missing" } });
    fireEvent.click(screen.getByRole("button", { name: /^Add$/ }));

    await waitFor(() => {
      expect(screen.getByText(/path not found/)).toBeTruthy();
    });
    expect(input.value).toBe("/missing");
    expect(refreshProjects).not.toHaveBeenCalled();
  });

  it("Browse toggles the DirBrowser; selecting a path triggers Add", async () => {
    vi.mocked(api.addProject).mockResolvedValue(undefined as never);
    const { refreshProjects, onProjectsChanged } = setup([]);
    fireEvent.click(screen.getByRole("button", { name: /Browse/ }));
    fireEvent.click(screen.getByText("mock-pick"));

    await waitFor(() => {
      expect(vi.mocked(api.addProject)).toHaveBeenCalledWith("/picked");
      expect(refreshProjects).toHaveBeenCalledTimes(1);
      expect(onProjectsChanged).toHaveBeenCalledTimes(1);
    });
    // DirBrowser should auto-close on successful add
    expect(screen.queryByText("mock-pick")).toBeNull();
  });

  it("Remove calls api.removeProject + refreshProjects + onProjectsChanged", async () => {
    vi.mocked(api.removeProject).mockResolvedValue(undefined as never);
    const { refreshProjects, onProjectsChanged } = setup(["/x/y/foo"]);
    fireEvent.click(screen.getByLabelText("Remove project /x/y/foo"));
    await waitFor(() => {
      expect(vi.mocked(api.removeProject)).toHaveBeenCalledWith("/x/y/foo");
      expect(refreshProjects).toHaveBeenCalledTimes(1);
      expect(onProjectsChanged).toHaveBeenCalledTimes(1);
    });
  });
});
