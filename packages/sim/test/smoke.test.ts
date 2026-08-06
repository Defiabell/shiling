import { describe, expect, it } from "vitest";
import { createSim } from "../src/index.js";

describe("workspace smoke", () => {
  it("resolves sim package", () => {
    expect(typeof createSim).toBe("function");
  });
});
