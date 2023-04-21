import { Location } from "vscode";

export type Selection = {
  filePath: string;
  fromLine: number;
  fromColumn: number;
  toLine: number;
  toColumn: number;
};

export type Operation = {
  selection: Selection;
  name: string;
};

export type Entity = {
  selection: Selection;
  name: string;
  operations: Operation[];
};

export type AnalyzeResult =
  | {
      entities: Map<string, Entity>;
      unknowns: Map<string, Entity>;
    }
  | string;

function replacer(key: string, value: any) {
  if (value instanceof Map) {
    return {
      dataType: "Map",
      value: [...value],
    };
  } else {
    return value;
  }
}

function reviver(key: string, value: any) {
  if (typeof value === "object" && value !== null) {
    if (value.dataType === "Map") {
      return new Map(value.value);
    }
  }
  return value;
}

export function serializeAnalyzeResult(result: AnalyzeResult): string {
  return JSON.stringify(result, replacer);
}

export function deserializeAnalyzeResult(
  result: string
): AnalyzeResult | undefined {
  try {
    return JSON.parse(result, reviver);
  } catch (e) {
    return undefined;
  }
}
