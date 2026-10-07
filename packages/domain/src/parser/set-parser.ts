import type { LoadSemantics, WeightUnit } from "../../../contracts/src/index.js";
import { DomainError } from "../../../persistence/src/index.js";

export type ParsedSet = {
  loadValue: number;
  weightUnit?: WeightUnit;
  loadSemantics: LoadSemantics;
  reps: number;
  usesSame: boolean;
};

export type PreviousSetContext = {
  loadValue: number;
  weightUnit: WeightUnit;
  loadSemantics: LoadSemantics;
};

export type ParseSetOptions = {
  preferredWeightUnit: WeightUnit;
  exerciseDefaultLoadSemantics: LoadSemantics;
  previousSet?: PreviousSetContext;
};

const setPattern =
  /(?:(?<load>\d+(?:\.\d+)?)\s*(?<unit>kg|lb)?\s*(?<each>each)?\s*(?:(?:x|for)\s*)?(?<reps>\d+))|(?:(?<same>same)\s*x\s*(?<sameReps>\d+))/gi;

export function hasSetNotation(input: string): boolean {
  return input.match(setPattern) !== null;
}

export function parseSetMessage(input: string, options: ParseSetOptions): ParsedSet[] {
  const sets: ParsedSet[] = [];
  const lower = input.toLowerCase();

  for (const match of lower.matchAll(setPattern)) {
    const groups = match.groups ?? {};
    if (groups.same) {
      if (!options.previousSet) {
        throw new DomainError("Cannot resolve same without a previous set", "AMBIGUOUS_SAME");
      }
      sets.push({
        loadValue: options.previousSet.loadValue,
        weightUnit: options.previousSet.weightUnit,
        loadSemantics: options.previousSet.loadSemantics,
        reps: Number(groups.sameReps),
        usesSame: true
      });
      continue;
    }

    const loadValue = Number(groups.load);
    const reps = Number(groups.reps);
    if (!Number.isFinite(loadValue) || !Number.isInteger(reps)) {
      throw new DomainError("Missing required numeric values", "MISSING_NUMERIC_VALUES");
    }
    const explicitUnit = groups.unit?.toUpperCase() as WeightUnit | undefined;
    const weightUnit = explicitUnit ?? options.preferredWeightUnit;
    const loadSemantics = groups.each
      ? "PER_HAND_PER_SIDE"
      : options.exerciseDefaultLoadSemantics;

    sets.push({
      loadValue,
      weightUnit,
      loadSemantics,
      reps,
      usesSame: false
    });
  }

  if (sets.length === 0) {
    throw new DomainError("Message does not contain deterministic set notation", "NO_SET_NOTATION");
  }

  return sets;
}
