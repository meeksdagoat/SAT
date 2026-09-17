export type ChoiceId = "A" | "B" | "C" | "D";
export type Difficulty = "Easy" | "Medium" | "Hard";

export interface Choice {
  id: ChoiceId;
  text: string;
}

export interface Question {
  id: string;
  assessment: string;
  test: string;
  domain: string;
  skill: string;
  difficulty: Difficulty;
  passage: string;
  prompt: string;
  choices: Choice[];
  correctAnswer: ChoiceId;
  explanations: Record<ChoiceId, string>;
}

export interface PracticeFilters {
  domains: string[];
  skills: string[];
  difficulties: Difficulty[];
}

export interface Attempt {
  questionId: string;
  selectedAnswer: ChoiceId | null;
  isCorrect: boolean;
  skipped?: boolean;
  timestamp: number;
  question: Question;
}

export type ExcludeMode = "answered" | "correct" | "none";
