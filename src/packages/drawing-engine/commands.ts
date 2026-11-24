import type { DrawingLine } from "./model.ts";

export type DrawingCommand =
  | { kind: "add"; drawing: DrawingLine }
  | { kind: "update"; before: DrawingLine; after: DrawingLine }
  | { kind: "remove"; drawing: DrawingLine }
  | { kind: "clear"; drawings: DrawingLine[] }
  | { kind: "replace"; before: DrawingLine[]; after: DrawingLine[] }
  | { kind: "batch"; commands: DrawingCommand[] };

function cloneDrawing(drawing: DrawingLine): DrawingLine {
  return {
    ...drawing,
    ...(drawing.fibLevels ? { fibLevels: [...drawing.fibLevels] } : {}),
  };
}

function cloneCommand(command: DrawingCommand): DrawingCommand {
  switch (command.kind) {
    case "add":
    case "remove":
      return { ...command, drawing: cloneDrawing(command.drawing) };
    case "update":
      return { ...command, before: cloneDrawing(command.before), after: cloneDrawing(command.after) };
    case "clear":
      return { ...command, drawings: command.drawings.map(cloneDrawing) };
    case "replace":
      return {
        ...command,
        before: command.before.map(cloneDrawing),
        after: command.after.map(cloneDrawing),
      };
    case "batch":
      return { ...command, commands: command.commands.map(cloneCommand) };
  }
}

function sortByZ(drawings: readonly DrawingLine[]): DrawingLine[] {
  return drawings
    .map(cloneDrawing)
    .sort((a, b) => (a.zIndex ?? 0) - (b.zIndex ?? 0));
}

function applyForward(drawings: readonly DrawingLine[], command: DrawingCommand): DrawingLine[] {
  if (command.kind === "batch") {
    return command.commands.reduce<DrawingLine[]>(
      (current, child) => applyForward(current, child),
      sortByZ(drawings),
    );
  }
  if (command.kind === "add") return sortByZ([...drawings, command.drawing]);
  if (command.kind === "update") {
    return sortByZ(drawings.map((item) => (item.id === command.after.id ? command.after : item)));
  }
  if (command.kind === "remove") return drawings.filter((item) => item.id !== command.drawing.id);
  if (command.kind === "clear") return [];
  return sortByZ(command.after);
}

function applyBackward(drawings: readonly DrawingLine[], command: DrawingCommand): DrawingLine[] {
  if (command.kind === "batch") {
    return [...command.commands].reverse().reduce<DrawingLine[]>(
      (current, child) => applyBackward(current, child),
      sortByZ(drawings),
    );
  }
  if (command.kind === "add") return drawings.filter((item) => item.id !== command.drawing.id);
  if (command.kind === "update") {
    return sortByZ(drawings.map((item) => (item.id === command.before.id ? command.before : item)));
  }
  if (command.kind === "remove") return sortByZ([...drawings, command.drawing]);
  if (command.kind === "clear") return sortByZ(command.drawings);
  return sortByZ(command.before);
}

/** Framework-independent bounded command history for drawings. */
export class DrawingCommandStore {
  private drawings: DrawingLine[];
  private readonly undoStack: DrawingCommand[] = [];
  private readonly redoStack: DrawingCommand[] = [];

  constructor(initial: readonly DrawingLine[] = [], private readonly limit = 100) {
    this.drawings = sortByZ(initial);
  }

  snapshot(): DrawingLine[] {
    return this.drawings.map(cloneDrawing);
  }

  reset(drawings: readonly DrawingLine[]): void {
    this.drawings = sortByZ(drawings);
    this.undoStack.length = 0;
    this.redoStack.length = 0;
  }

  execute(command: DrawingCommand): DrawingLine[] {
    const stored = cloneCommand(command);
    this.drawings = applyForward(this.drawings, stored);
    this.undoStack.push(stored);
    if (this.undoStack.length > this.limit) this.undoStack.shift();
    this.redoStack.length = 0;
    return this.snapshot();
  }

  /** Executes several mutations as one atomic undo/redo step. */
  executeBatch(commands: readonly DrawingCommand[]): DrawingLine[] {
    if (commands.length === 0) return this.snapshot();
    return this.execute({ kind: "batch", commands: [...commands] });
  }

  undo(): DrawingLine[] | null {
    const command = this.undoStack.pop();
    if (!command) return null;
    this.drawings = applyBackward(this.drawings, command);
    this.redoStack.push(command);
    return this.snapshot();
  }

  redo(): DrawingLine[] | null {
    const command = this.redoStack.pop();
    if (!command) return null;
    this.drawings = applyForward(this.drawings, command);
    this.undoStack.push(command);
    return this.snapshot();
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }
}
