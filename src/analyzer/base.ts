import { OutputChannel } from "vscode";
import { AnalyzeResult, AnalyzeResultGroup, CDA_TRAN, NON_EQ, NON_TRIVIAL, appendNote, Entity, Operation, FULL_SCAN } from "../model";

/**
 * Contract for language/ORM analyzers.
 *
 * Implementations are responsible for scanning a workspace, discovering ORM
 * entities and operations, and populating the shared AnalyzeResult instance
 * with recognized and unknown entities. See existing analyzers under
 * `src/analyzer/` for reference implementations.
 */
export interface Analyzer {
  /**
   * Run the analysis for the current workspace.
   *
   * Requirements and expectations:
   * - Should be cancelable via `cancel()` (e.g., terminate child process, stop timers).
   * - Must populate the `AnalyzeResult` groups, typically by:
   *   - Ensuring recognized entities exist in `AnalyzeResultGroup.recognized`
   *   - Adding operations to the corresponding entity, or to
   *     `AnalyzeResultGroup.unknown` if the entity cannot be resolved
   * - Should stream human-readable progress messages via `onMessage` for the
   *   VS Code progress UI.
   * - Return `true` on success and `false` on failure. On success, the
   *   extension will save results and may trigger auto-annotation.
   *
   * Typical implementation details:
   * - Existing analyzers spawn an external script, parse its output, then
   *   call helper methods like `collectEntities` and `collectOperations`.
   */
  analyze: (onMessage: (msg: string) => void) => Promise<boolean>;

  /**
   * Cancel any in-flight analysis work and clean up resources.
   *
   * This should make subsequent calls to `analyze()` safe (idempotent cleanup),
   * and is expected to interrupt long-running operations such as child
   * processes or filesystem scans.
   */
  cancel: () => void;

  /**
   * Return a stable, lowercase name for this analyzer (e.g., "typeorm",
   * "django").
   *
   * This value is used in UI messages ("Analyzing <name> project") and to
   * form the persisted result file name under `.vscode/` as
   * `<name>-results.json`.
   */
  getName: () => string;

  /**
   * Apply automatic annotations for a supported tag across collected results.
   *
   * Guidelines:
   * - Only annotate with auto tags using the `(a)` suffix (e.g., `tag(a)`).
   * - Prefer using helpers like `autoAnnotateCdaTran` where appropriate.
   * - After mutating operations/entities, consider calling
   *   `updateEntityAnnotation(result)` so entity-level summaries remain in sync.
   * - For unsupported tags, surface a user-visible error message.
   */
  autoAnnotate: (tag: string) => void;

  /**
   * Return the list of tag identifiers that this analyzer knows how to
   * auto-annotate.
   *
   * The extension presents these tags in a Quick Pick for users to select.
   * Examples include `FULL_SCAN`, `CDA_TRAN`, `NON_EQ`, `NON_TRIVIAL`.
   */
  supportedAutoAnnotateTags: () => string[];

  /**
   * Suggest bulk moves of operations from unknown entities into recognized
   * entities.
   *
   * Return value format:
   * - An array of "steps". Each step is a tuple of:
   *   - The destination recognized `Entity`
   *   - A list of candidate operations, each expressed as `[sourceUnknownEntity, operation]`
   *
   * How the extension uses this:
   * - The extension iterates steps and shows a Quick Pick of operations per
   *   destination entity. Confirmed items are moved via `moveOperations` from
   *   the `unknown` group to the chosen recognized entity.
   *
   * If the analyzer does not provide suggestions, return an empty array.
   */
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

    // Start from the longest CDAs
    cdas.sort((a, b) => b.size - a.size);
    // Add all CDAs to the tree such that the parent of a CDA is the smallest superset 
    // of the CDA
    for (const cda of cdas) {
      addChild(graph.children, cda);
    }

    function findBestPath(node: GraphNode): [string[], number] {
      let path: string[] = [];
      // value counts the number of operations covered by the path
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

    // Find the path that covers the most operations
    const [bestPath] = findBestPath(graph);
    if (bestPath.length > 0) {
      // The longest CDA is the last element in the path
      const maxLen = bestPath[bestPath.length - 1].split(",").length;
      for (const cdaKey of bestPath) {
        const len = cdaKey.split(",").length;
        if (cdaIndex.has(cdaKey)) {
          // These operations have matching CDAs
          for (const operation of cdaIndex.get(cdaKey)!) {
            if (operation.note.includes(CDA_TRAN)) {
              outputChannel.appendLine(`Double-check tag "${CDA_TRAN}" that was manually added for ${operation.name}`);
            }
            operation.note = appendNote(operation.note, `cda[${len}/${maxLen}](a)`);
          }
        }
        cdaIndex.delete(cdaKey);
      }
    }
    for (const ops of cdaIndex.values()) {
      for (const op of ops) {
        remainingOperations.push(op);
      }
    }
    for (const op of remainingOperations) {
      if (!op.note.includes(CDA_TRAN) && !op.note.includes(FULL_SCAN)) {
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