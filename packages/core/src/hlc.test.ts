import { describe, expect, it } from "vitest";
import { hlc } from "./hlc";

describe("hlc", () => {
  it("ticks strictly upward even when the wall clock stands still", () => {
    const clock = hlc("a", () => 1000);
    const [x, y, z] = [clock.now(), clock.now(), clock.now()];
    expect(x < y && y < z).toBe(true);
  });

  it("orders by wall time first", () => {
    let t = 1000;
    const clock = hlc("a", () => t);
    const early = clock.now();
    t = 2000;
    expect(early < clock.now()).toBe(true);
  });

  it("moves past a remote stamp from a device with a faster clock", () => {
    const fast = hlc("b", () => 9_000_000).now();
    const slow = hlc("a", () => 1000);
    slow.observe(fast);
    expect(slow.now() > fast).toBe(true);
  });

  it("breaks exact ties by node id so two devices never produce equal stamps", () => {
    expect(hlc("a", () => 5).now()).not.toBe(hlc("b", () => 5).now());
  });
});
