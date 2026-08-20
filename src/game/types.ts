export const RULE_IDS = ["lava", "water", "ghosts", "freeze", "chickens", "pianos", "frog"] as const;
export type RuleId = (typeof RULE_IDS)[number];

export const MODIFIERS = ["tiny", "backwards", "jumpOnly", "speed", "extraChickens", "lowGravity"] as const;
export type Modifier = (typeof MODIFIERS)[number];

export type Accessory = "crown" | "party" | "leaf" | "none";

export interface PlayerStyle {
  color: string;
  accessory: Accessory;
}

export interface CustomChallenge {
  version: 1;
  name: string;
  modifiers: Modifier[];
  seed: number;
}

export interface RunConfig {
  style: PlayerStyle;
  challenge: CustomChallenge | null;
}

export interface RuleSummary {
  id: RuleId;
  name: string;
  emoji: string;
  description: string;
}
