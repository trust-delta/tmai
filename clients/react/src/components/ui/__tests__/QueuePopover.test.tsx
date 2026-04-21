// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { QueuePopover } from "../QueuePopover";

interface Item {
  id: string;
  label: string;
}

const ITEMS: Item[] = [
  { id: "a", label: "First item" },
  { id: "b", label: "Second item" },
];

function renderItem(item: Item) {
  return <span>{item.label}</span>;
}

describe("QueuePopover", () => {
  it("renders nothing when isOpen is false", () => {
    const { container } = render(
      <QueuePopover
        items={ITEMS}
        renderItem={renderItem}
        isOpen={false}
        onClose={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing when items list is empty (even if open)", () => {
    const { container } = render(
      <QueuePopover
        items={[]}
        renderItem={renderItem}
        isOpen={true}
        onClose={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders all items when open", () => {
    render(
      <QueuePopover
        items={ITEMS}
        renderItem={renderItem}
        isOpen={true}
        onClose={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(screen.getByText("First item")).toBeTruthy();
    expect(screen.getByText("Second item")).toBeTruthy();
  });

  it("calls onCancel with the item id when Cancel is clicked", () => {
    const onCancel = vi.fn();
    render(
      <QueuePopover
        items={ITEMS}
        renderItem={renderItem}
        isOpen={true}
        onClose={() => {}}
        onCancel={onCancel}
      />,
    );
    // First Cancel button corresponds to ITEMS[0]
    const cancelButtons = screen.getAllByRole("button", { name: /cancel queued prompt/i });
    fireEvent.click(cancelButtons[0]);
    expect(onCancel).toHaveBeenCalledWith("a");
  });

  it("calls onClose when the close button is clicked", () => {
    const onClose = vi.fn();
    render(
      <QueuePopover
        items={ITEMS}
        renderItem={renderItem}
        isOpen={true}
        onClose={onClose}
        onCancel={() => {}}
      />,
    );
    fireEvent.click(screen.getByLabelText("Close"));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("displays custom title", () => {
    render(
      <QueuePopover
        items={ITEMS}
        renderItem={renderItem}
        isOpen={true}
        onClose={() => {}}
        onCancel={() => {}}
        title="Pending Prompts"
      />,
    );
    expect(screen.getByText("Pending Prompts")).toBeTruthy();
  });
});
