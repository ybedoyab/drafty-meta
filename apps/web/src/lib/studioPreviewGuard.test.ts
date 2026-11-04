import { describe, expect, it, vi } from "vitest";
import { StudioPreviewGuard } from "./studioPreviewGuard";

describe("StudioPreviewGuard", () => {
  it("accepts an explicit preview for the current generation", () => {
    const revoked: string[] = [];
    const guard = new StudioPreviewGuard((url) => revoked.push(url));
    const token = guard.begin();
    expect(guard.accept(token, "blob:ok")).toBe("blob:ok");
    expect(guard.peekUrl()).toBe("blob:ok");
    expect(revoked).toEqual([]);
  });

  it("revokes a stale blob when the scenario or specification changes", () => {
    const revoked: string[] = [];
    const guard = new StudioPreviewGuard((url) => revoked.push(url));
    const first = guard.begin();
    guard.invalidate();
    expect(guard.accept(first, "blob:stale")).toBeNull();
    expect(revoked).toEqual(["blob:stale"]);
    expect(guard.peekUrl()).toBeNull();
  });

  it("revokes the prior URL when a newer request succeeds", () => {
    const revoked: string[] = [];
    const guard = new StudioPreviewGuard((url) => revoked.push(url));
    const first = guard.begin();
    expect(guard.accept(first, "blob:old")).toBe("blob:old");
    const second = guard.begin();
    expect(guard.accept(second, "blob:new")).toBe("blob:new");
    expect(revoked).toEqual(["blob:old"]);
    expect(guard.peekUrl()).toBe("blob:new");
  });

  it("cleanup invalidation releases the held blob URL", () => {
    const revoked: string[] = [];
    const guard = new StudioPreviewGuard((url) => revoked.push(url));
    const token = guard.begin();
    guard.accept(token, "blob:held");
    guard.invalidate();
    expect(revoked).toEqual(["blob:held"]);
    expect(guard.peekUrl()).toBeNull();
    expect(guard.isCurrent(token)).toBe(false);
  });

  it("does not treat a late response as current after invalidate", () => {
    const guard = new StudioPreviewGuard(vi.fn());
    const token = guard.begin();
    expect(guard.isCurrent(token)).toBe(true);
    guard.invalidate();
    expect(guard.isCurrent(token)).toBe(false);
  });
});
