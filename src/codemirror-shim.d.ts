declare module "@codemirror/state" {
  export class StateEffect<A> {
    readonly value: A;
    is<T>(t: StateEffectType<T>): this is StateEffect<T>;
    static define<T = null>(): StateEffectType<T>;
  }
  export class StateEffectType<T> {
    of(value: T): StateEffect<T>;
  }
}

declare module "@codemirror/view" {
  export type DecorationSet = unknown;
  export class Decoration {
    static none: DecorationSet;
    static line(spec: { class: string }): { range: (from: number) => unknown };
    static set(deco: unknown[]): DecorationSet;
  }
  export class EditorView {
    dispatch(spec: unknown): void;
    state: {
      doc: {
        lines: number;
        line: (n: number) => { from: number; text: string };
        lineAt: (pos: number) => { from: number; number: number };
      };
      selection: { main: { head: number } };
    };
  }
  export class ViewUpdate {
    view: EditorView;
  }
  export class ViewPlugin {
    static fromClass(
      cls: new (view: EditorView) => { decorations: DecorationSet; update: (u: ViewUpdate) => void },
      spec: { decorations: (v: { decorations: DecorationSet }) => DecorationSet }
    ): unknown;
  }
}
