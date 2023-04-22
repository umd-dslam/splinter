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
  type: "read" | "write" | "other" | "transaction";
};

export type Entity = {
  selection?: Selection;
  name: string;
  operations: Operation[];
};

export type AnalyzeResult = {
  entities: Map<string, Entity>;
  unknowns: Map<string, Entity>;
};

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

export function countOperationTypes(
  operations: Operation[],
  start?: { [key: string]: number }
): { [key: string]: number } {
  if (start === undefined) {
    start = {};
  }

  return operations.reduce((acc, operation) => {
    acc[operation.type] = acc[operation.type] ? acc[operation.type] + 1 : 1;
    return acc;
  }, start);
}
