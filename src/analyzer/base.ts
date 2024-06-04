import { OutputChannel } from "vscode";
import { AnalyzeResult, AnalyzeResultGroup, CDA_TRAN, NON_EQ, NON_TRIVIAL, FULL_SCAN, appendNote } from "../model";

export interface Analyzer {
  analyze: (onMessage: (msg: string) => void) => Promise<boolean>;
  cancel: () => void;
  getName: () => string;

  autoAnnotate: (tag: string) => void;
  supportedAutoAnnotateTags: () => string[];
}

export function autoAnnotateFullScan(result: AnalyzeResult, outputChannel: OutputChannel) {
  const entities = result.getGroup(AnalyzeResultGroup.recognized);
  for (const entity of entities.values()) {
    let hasFullScan = false;
    for (const operation of entity.operations) {
      if (operation.name.endsWith(".all")) {
        hasFullScan = true;
        break;
      }
    }
    if (!entity.note.includes(FULL_SCAN)) {
      if (hasFullScan) {
        entity.note = appendNote(entity.note, `${FULL_SCAN}(a)`);
      }
    } else if (!hasFullScan) {
      outputChannel.appendLine(`Double-check tag "${FULL_SCAN}" that was manually added for ${entity.name}`);
    }
  }
}

export function autoAnnotateCdaTran(result: AnalyzeResult, outputChannel: OutputChannel) {
  const covers = (bigger: string[], smaller: string[]) => {
    if (bigger.length < smaller.length) {
      [bigger, smaller] = [smaller, bigger];
    }
    for (const column of smaller) {
      if (!bigger.includes(column)) {
        return false;
      }
    }
    return true;
  };

  const entities = result.getGroup(AnalyzeResultGroup.recognized);
  for (const entity of entities.values()) {
    // Collect all CDAs on the entity
    const cdas: string[][] = [];
    for (const operation of entity.operations) {
      const cda: string[] = [];
      for (const arg of operation.arguments) {
        const parts = arg.name.split("__");
        if (0 < parts.length && parts.length <= 2) {
          cda.push(parts[0]);
        }
      }
      if (cda.length > 0) {
        cdas.push(cda);
      }
    }
    // Check if all CDAs are covered by each other
    let cdaTran = false;
    for (let i = 0; i < cdas.length; i++) {
      for (let j = 0; j < cdas.length; j++) {
        if (i === j) {
          continue;
        }
        if (!covers(cdas[i], cdas[j])) {
          cdaTran = true;
          break;
        }
      }
    }
    if (!entity.note.includes(CDA_TRAN)) {
      if (cdaTran) {
        entity.note = appendNote(entity.note, `${CDA_TRAN}(a)`);
      }
    } else if (!cdaTran) {
      outputChannel.appendLine(`Double-check tag "${CDA_TRAN}" that was manually added for ${entity.name}`);
    }
  }
}
