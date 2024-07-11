import { OutputChannel } from "vscode";
import { AnalyzeResult, AnalyzeResultGroup, CDA_TRAN, NON_EQ, NON_TRIVIAL, appendNote, Entity, Operation } from "../model";

export interface Analyzer {
  analyze: (onMessage: (msg: string) => void) => Promise<boolean>;
  cancel: () => void;
  getName: () => string;

  autoAnnotate: (tag: string) => void;
  supportedAutoAnnotateTags: () => string[];

  recognizeUnknownAggressively: () => [Entity, [Entity, Operation][]][];
}

export function autoAnnotateCdaTran(
  result: AnalyzeResult,
  getCda: (operation: Operation) => string[] | undefined,
  outputChannel: OutputChannel
) {
  const entities = result.getGroup(AnalyzeResultGroup.recognized);
  const remainingOperations: Operation[] = [];

  for (const entity of entities.values()) {
    const cdas: Set<string>[] = [];
    const cdaIndex: Map<string, Operation[]> = new Map();
    for (const op of entity.operations) {
      const cda = getCda(op);
      if (cda !== undefined) {
        const cda_set: Set<string> = new Set(getCda(op));
        if (cda_set.size > 0) {
          const cdaKey = Array.from(cda_set).sort().join(",");
          if (!cdaIndex.get(cdaKey)) {
            cdas.push(cda_set);
            cdaIndex.set(cdaKey, []);
          }
          cdaIndex.get(cdaKey)!.push(op);
        } else {
          remainingOperations.push(op);
        }
      }
    }

    type GraphNode = {
      cda: Set<string>;
      children: GraphNode[];
    };

    const graph: GraphNode = {
      cda: new Set(),
      children: []
    };

    function isSubset(subset: Set<string>, superset: Set<string>): boolean {
      for (const elem of subset) {
        if (!superset.has(elem)) {
          return false;
        }
      }
      return true;
    }

    function addChild(children: GraphNode[], c: Set<string>): void {
      let added = false;
      for (const child of children) {
        if (isSubset(c, child.cda)) {
          addChild(child.children, c);
          added = true;
          break;
        }
      }
      if (!added) {
        children.push({ cda: c, children: [] });
      }
    }

    cdas.sort((a, b) => b.size - a.size);
    for (const cda of cdas) {
      addChild(graph.children, cda);
    }

    function findBestPath(node: GraphNode): [string[], number] {
      let path: string[] = [];
      let value = 0;
      for (const child of node.children) {
        const [cpath, cvalue] = findBestPath(child);
        if (cvalue > value) {
          path = cpath;
          value = cvalue;
        }
      }
      const cdaKey = Array.from(node.cda).sort().join(",");
      if (node.cda.size > 0) {
        path.push(cdaKey);
        value += cdaIndex.has(cdaKey) ? cdaIndex.get(cdaKey)!.length : 0;
      }
      return [path, value];
    }

    const [bestPath] = findBestPath(graph);
    for (const cdaKey of bestPath) {
      if (cdaIndex.has(cdaKey)) {
        for (const operation of cdaIndex.get(cdaKey)!) {
          if (operation.note.includes(CDA_TRAN)) {
            outputChannel.appendLine(`Double-check tag "${CDA_TRAN}" that was manually added for ${operation.name}`);
          }
        }
      }
      cdaIndex.delete(cdaKey);
    }
    for (const ops of cdaIndex.values()) {
      for (const op of ops) {
        remainingOperations.push(op);
      }
    }
    for (const op of remainingOperations) {
      if (!op.note.includes(CDA_TRAN)) {
        op.note = appendNote(op.note, `${CDA_TRAN}(a)`);
      }
    }
    const bestCda = bestPath[bestPath.length - 1];
    if (bestCda) {
      if (!entity.note.includes("cda[")) {
        if (bestCda.length > 0) {
          entity.note = appendNote(entity.note, `cda[${bestCda}](a)`);
        }
      } else if (bestCda.length === 0) {
        outputChannel.appendLine(`Double-check cda list that was manually added for ${entity.name}`);
      }
    }
  }
}

export function updateEntityAnnotation(result: AnalyzeResult) {
  const entities = result.getGroup(AnalyzeResultGroup.recognized);

  const summarize = (entity: Entity, tag: string) => {
    const autoTag = `${tag}(a)`;
    let hasTag = false;
    for (const operation of entity.operations) {
      if (operation.note.includes(tag)) {
        hasTag = true;
        break;
      }
    }
    if (hasTag && !entity.note.includes(tag)) {
      entity.note = appendNote(entity.note, autoTag);
    } else if (!hasTag && entity.note.includes(autoTag)) {
      entity.note = entity.note.replace(` ${autoTag}`, "").replace(autoTag, "");
    }
  };

  for (const entity of entities.values()) {
    summarize(entity, NON_TRIVIAL);
    summarize(entity, NON_EQ);
    summarize(entity, CDA_TRAN);
  }
}