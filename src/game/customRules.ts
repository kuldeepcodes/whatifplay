import { MODIFIERS, RULE_IDS, type CustomChallenge, type Modifier, type RuleId } from "./types";

const MAX_NAME_LENGTH = 32;
const MAX_MODIFIERS = 3;

function toBase64Url(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

function fromBase64Url(value: string): string {
  if (!/^[A-Za-z0-9_-]{1,512}$/u.test(value)) throw new Error("Challenge code contains invalid characters.");
  const padded = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  return new TextDecoder().decode(Uint8Array.from(binary, (character) => character.charCodeAt(0)));
}

export function sanitizeChallengeName(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/[<>]/gu, "")
    .split("")
    .filter((character) => {
      const code = character.charCodeAt(0);
      return code > 31 && code !== 127;
    })
    .join("")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, MAX_NAME_LENGTH);
}

export function createChallenge(name: string, modifiers: readonly string[], seed = Date.now()): CustomChallenge {
  const safeName = sanitizeChallengeName(name);
  if (safeName.length < 3) throw new Error("Give your challenge a name with at least 3 characters.");

  const unique = [...new Set(modifiers)];
  if (unique.length === 0 || unique.length > MAX_MODIFIERS) {
    throw new Error(`Choose between 1 and ${MAX_MODIFIERS} modifiers.`);
  }
  if (!unique.every((modifier): modifier is Modifier => MODIFIERS.includes(modifier as Modifier))) {
    throw new Error("That challenge contains an unsupported modifier.");
  }

  return {
    version: 1,
    name: safeName,
    modifiers: unique,
    seed: Math.abs(Math.trunc(seed)) % 2_147_483_647,
  };
}

export function encodeChallenge(challenge: CustomChallenge): string {
  const validated = createChallenge(challenge.name, challenge.modifiers, challenge.seed);
  return toBase64Url(JSON.stringify([validated.version, validated.name, validated.modifiers, validated.seed]));
}

export function decodeChallenge(encoded: string): CustomChallenge {
  let parsed: unknown;
  try {
    parsed = JSON.parse(fromBase64Url(encoded));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown challenge decoding error.";
    throw new Error(`Invalid challenge link: ${message}`);
  }

  if (!Array.isArray(parsed) || parsed.length !== 4 || parsed[0] !== 1 || typeof parsed[1] !== "string" || !Array.isArray(parsed[2]) || typeof parsed[3] !== "number") {
    throw new Error("Invalid challenge link: unsupported challenge format.");
  }
  return createChallenge(parsed[1], parsed[2].filter((value): value is string => typeof value === "string"), parsed[3]);
}

export function seededRuleOrder(seed: number, count = RULE_IDS.length): RuleId[] {
  let state = Math.max(1, Math.abs(Math.trunc(seed)) | 0);
  const pool = [...RULE_IDS];
  const result: RuleId[] = [];
  while (pool.length > 0 && result.length < count) {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    const index = Math.abs(state) % pool.length;
    const [selected] = pool.splice(index, 1);
    if (selected) result.push(selected);
  }
  return result;
}

export function getChallengeFromLocation(search: string): CustomChallenge | null {
  const encoded = new URLSearchParams(search).get("challenge");
  if (!encoded) return null;
  return decodeChallenge(encoded);
}
