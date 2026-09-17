import type { Difficulty } from "./types";

export const DOMAINS = [
  {
    name: "Craft and Structure",
    skills: [
      "Words in Context",
      "Text Structure and Purpose",
      "Cross-Text Connections",
    ],
  },
  {
    name: "Information and Ideas",
    skills: [
      "Central Ideas and Details",
      "Inferences",
      "Command of Evidence",
    ],
  },
  {
    name: "Standard English Conventions",
    skills: ["Boundaries", "Form, Structure, and Sense"],
  },
  {
    name: "Expression of Ideas",
    skills: ["Rhetorical Synthesis", "Transitions"],
  },
] as const;

export const DIFFICULTIES: Difficulty[] = ["Easy", "Medium", "Hard"];

export const ALL_SKILLS = DOMAINS.flatMap((domain) => [...domain.skills]);
