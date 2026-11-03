import { describe, expect, it } from "vitest";
import { createHistory, historyShortcut, recordHistory, redoHistory, undoHistory } from "./history";

describe("form history", () => {
  it("steps back and forward through recorded stages", () => {
    let history = createHistory("a");
    history = recordHistory(history, "b");
    history = recordHistory(history, "c");
    expect(history.present).toBe("c");

    history = undoHistory(history);
    expect(history.present).toBe("b");
    history = undoHistory(history);
    expect(history.present).toBe("a");

    history = redoHistory(history);
    expect(history.present).toBe("b");
    history = redoHistory(history);
    expect(history.present).toBe("c");
  });

  it("is a no-op at either end of the history", () => {
    const start = createHistory("a");
    expect(undoHistory(start)).toBe(start);
    expect(redoHistory(start)).toBe(start);
  });

  it("drops the redo branch when a new edit is recorded after undoing", () => {
    let history = recordHistory(createHistory("a"), "b");
    history = undoHistory(history);
    history = recordHistory(history, "x");
    expect(history.present).toBe("x");
    expect(history.future).toEqual([]);
    expect(redoHistory(history)).toBe(history);
  });

  it("ignores re-recording the current stage and caps the past", () => {
    const start = createHistory("a");
    expect(recordHistory(start, "a")).toBe(start);

    let history = start;
    for (const next of ["b", "c", "d", "e"]) history = recordHistory(history, next, 2);
    expect(history.past).toEqual(["c", "d"]);
    expect(history.present).toBe("e");
  });
});

describe("history shortcuts", () => {
  const key = (overrides: Partial<KeyboardEvent>) => ({
    key: "z",
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    altKey: false,
    ...overrides,
  });

  it("maps the usual undo and redo chords", () => {
    expect(historyShortcut(key({ key: "z", ctrlKey: true }))).toBe("undo");
    expect(historyShortcut(key({ key: "Z", metaKey: true }))).toBe("undo");
    expect(historyShortcut(key({ key: "y", ctrlKey: true }))).toBe("redo");
    expect(historyShortcut(key({ key: "Z", ctrlKey: true, shiftKey: true }))).toBe("redo");
    expect(historyShortcut(key({ key: "Z", metaKey: true, shiftKey: true }))).toBe("redo");
  });

  it("leaves plain keys and other chords alone", () => {
    expect(historyShortcut(key({ key: "z" }))).toBeNull();
    expect(historyShortcut(key({ key: "y" }))).toBeNull();
    expect(historyShortcut(key({ key: "z", ctrlKey: true, altKey: true }))).toBeNull();
    expect(historyShortcut(key({ key: "x", ctrlKey: true }))).toBeNull();
  });
});
