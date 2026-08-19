import { describe, expect, it } from "vitest";
import { createChallenge, decodeChallenge, encodeChallenge, sanitizeChallengeName, seededRuleOrder } from "./customRules";

describe("custom challenge links", () => {
  it("round-trips a valid challenge", () => {
    const challenge = createChallenge("Tiny reverse party", ["tiny", "backwards"], 42);
    expect(decodeChallenge(encodeChallenge(challenge))).toEqual(challenge);
  });

  it("sanitizes names and rejects unsupported payloads", () => {
    expect(sanitizeChallengeName("  <b>Wild\u0000   Day</b>  ")).toBe("bWild Day/b");
    expect(() => createChallenge("Bad", ["teleport"], 1)).toThrow("unsupported");
    expect(() => decodeChallenge("not*base64")).toThrow("Invalid challenge link");
  });
});

describe("seeded rule selection", () => {
  it("is deterministic and contains no duplicates", () => {
    const first = seededRuleOrder(9284);
    expect(first).toEqual(seededRuleOrder(9284));
    expect(new Set(first).size).toBe(first.length);
    expect(first).toHaveLength(7);
  });

  it("changes order for different seeds", () => {
    expect(seededRuleOrder(2)).not.toEqual(seededRuleOrder(3));
  });
});
