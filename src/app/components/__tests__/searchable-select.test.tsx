import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { SearchableSelect, type SearchableOption } from "../searchable-select";

const CLIENTS: SearchableOption[] = [
  { id: "c1", name: "Acme" },
  { id: "c2", name: "Beta Ltd" },
  { id: "c3", name: "Zebra Corp" },
];

function Harness({ options = CLIENTS, onPick }: { options?: SearchableOption[]; onPick?: (id: string) => void }) {
  const [value, setValue] = useState<string | null>(null);
  return (
    <SearchableSelect
      label="Client"
      value={value}
      onChange={(next) => { setValue(next); onPick?.(next); }}
      options={options}
      placeholder="Select client"
      searchPlaceholder="Search clients"
      emptyText="No clients loaded yet."
    />
  );
}

function open() {
  fireEvent.click(screen.getByLabelText("Client"));
}

describe("SearchableSelect", () => {
  it("turns the trigger itself into the search field — no second row", () => {
    render(<Harness />);
    expect(screen.queryByLabelText("Search clients")).not.toBeInTheDocument();

    open();
    // The trigger is replaced, not supplemented.
    expect(screen.queryByLabelText("Client")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Search clients")).toHaveFocus();
  });

  it("filters the list and keeps the trigger label after picking", async () => {
    const onPick = vi.fn();
    render(<Harness onPick={onPick} />);
    open();

    fireEvent.change(screen.getByLabelText("Search clients"), { target: { value: "zeb" } });
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual(["Zebra Corp"]);

    fireEvent.click(screen.getByRole("option", { name: "Zebra Corp" }));
    expect(onPick).toHaveBeenCalledWith("c3");
    await waitFor(() => expect(screen.getByLabelText("Client")).toHaveTextContent("Zebra Corp"));
  });

  it("picks with ArrowDown + Enter and closes on Escape", async () => {
    const onPick = vi.fn();
    render(<Harness onPick={onPick} />);
    open();
    const search = screen.getByLabelText("Search clients");

    fireEvent.keyDown(search, { key: "ArrowDown" });
    fireEvent.keyDown(search, { key: "Enter" });
    expect(onPick).toHaveBeenCalledWith("c2");

    await waitFor(() => expect(screen.getByLabelText("Client")).toHaveTextContent("Beta Ltd"));
    open();
    fireEvent.keyDown(screen.getByLabelText("Search clients"), { key: "Escape" });
    await waitFor(() => expect(screen.getByLabelText("Client")).toBeInTheDocument());
  });

  it("says the list is empty rather than reporting a failed search for a blank query", () => {
    render(<Harness options={[]} />);
    open();

    // `No match for “”` is what a naive empty state prints while the options are still loading.
    expect(screen.getByText("No clients loaded yet.")).toBeInTheDocument();
    expect(screen.queryByText(/No match for/)).not.toBeInTheDocument();
  });

  it("still reports a genuinely unmatched search", () => {
    render(<Harness />);
    open();

    fireEvent.change(screen.getByLabelText("Search clients"), { target: { value: "nope" } });
    expect(screen.getByText("No match for “nope”.")).toBeInTheDocument();
  });
});
