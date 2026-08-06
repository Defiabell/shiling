import { describe, expect, it } from "vitest";
import { VERSION } from "../src/index.js";

describe("workspace smoke", () => {
  it("resolves sim package", () => {
    expect(VERSION).toBe("0.0.1");
  });
});
