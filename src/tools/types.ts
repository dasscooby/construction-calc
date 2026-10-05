// A "tool" is one calculator screen: a list of input boxes and a compute() that turns
// them into result rows. The screen (src/screens/ToolScreen.tsx) draws any tool from this.

export interface Option {
  value: string;
  label: string;
}

interface FieldBase {
  key: string;
  label: string;
  /** Small gray hint under the label */
  help?: string;
  /** Blank is allowed (compute gets 0 and has(key) is false) */
  optional?: boolean;
  /** Clear leaves this box alone (things like what you own, not the job) */
  sticky?: boolean;
  /** Only shown (and only used) when these switches are on */
  showIf?: string[];
  /** Only shown when at least one of these switches is on */
  showIfAny?: string[];
}

/** Feet + inches boxes. compute() receives FEET. Boxes accept 6, 6.5, 6 1/2, 6-1/2, 1/2. */
export interface LengthField extends FieldBase {
  kind: 'length';
  default?: { ft?: string; in?: string };
}

/** One number box (accepts 12, 0.25, 1/4, 1 1/2). */
export interface NumberField extends FieldBase {
  kind: 'number';
  /** Shown after the box: "%", "psf", "kips", "in", "ft" ... */
  unit?: string;
  default?: string;
  allowNegative?: boolean;
}

/** Whole number box. */
export interface CountField extends FieldBase {
  kind: 'count';
  default?: string;
}

/** A row of buttons; exactly one is picked. */
export interface ChoiceField extends FieldBase {
  kind: 'choice';
  options: Option[];
  default: string;
}

/** A row of buttons; any number can be picked. compute() reads the picked values with picks(). */
export interface MultiChoiceField extends FieldBase {
  kind: 'multi';
  options: Option[];
  default: string[];
}

/** What a slab edge butts against. */
export type EdgeKind = 'form' | 'house' | 'dowels' | 'slab' | 'slabDowels';

/** The sides of a slab, walked clockwise: length, turn at the end, corner radius, what the edge is. */
export interface OutlineField extends FieldBase {
  kind: 'outline';
}

export interface OutlineRow {
  length: number; // feet, corner to corner (as if square)
  turn: 'R' | 'L';
  /** Corner radius at the end of this side, feet; 0 = square */
  radius: number;
  edge: EdgeKind;
}

/** A finger sketch: points tapped on a pad, lines between them, and a measurement on any line. */
export interface PadField extends FieldBase {
  kind: 'pad';
}

export interface PadValue {
  /** Where each point was tapped on the pad (pad units) */
  points: { x: number; y: number }[];
  /** Lines between points; length in feet, null = not measured */
  edges: { a: number; b: number; length: number | null }[];
}

/** An on/off switch, like "Exterior footing". Other fields can hang off it with showIf. */
export interface ToggleField extends FieldBase {
  kind: 'toggle';
  default?: boolean;
}

/** Rows of sizes (inches) and how many you own. Blank "how many" = plenty. */
export interface StockField extends FieldBase {
  kind: 'stock';
  /** Rows shown at first: sizes in inches */
  defaultSizes: string[];
}

/** Any number of length × width rectangles (odd-shaped slabs). compute() receives feet. */
export interface AreasField extends FieldBase {
  kind: 'areas';
}

/** Rows of rebar marks: bar size, how many, cut length. compute() receives feet. */
export interface BarListField extends FieldBase {
  kind: 'barlist';
  /** Bar sizes offered as buttons, e.g. ['3', '4', '5'] */
  sizes: string[];
  defaultSize: string;
}

/** Rows of walls: length (outside) and what kind of corner is at each end. compute() receives feet. */
export interface WallsField extends FieldBase {
  kind: 'walls';
}

export type Field =
  | LengthField
  | NumberField
  | CountField
  | ChoiceField
  | MultiChoiceField
  | AreasField
  | BarListField
  | WallsField
  | StockField
  | ToggleField
  | OutlineField
  | PadField;

export interface Rect {
  length: number; // feet
  width: number; // feet
}

export interface BarRow {
  size: string; // '5' for #5
  qty: number;
  length: number; // feet
}

/** What's at the two ends of a wall: 'oo' both outside corners, 'oi' one of each, 'ii' both inside corners. */
export type WallEnds = 'oo' | 'oi' | 'ii';

export interface WallRow {
  length: number; // feet, measured on the outside
  ends: WallEnds;
}

export interface StockRow {
  size: number; // inches
  /** How many you own; null = plenty */
  qty: number | null;
}

/** What compute() reads. Required fields are always filled in and valid before compute() runs. */
export interface Inputs {
  /** Length field, in feet (0 if an optional field is blank). */
  len(key: string): number;
  /** Number field (0 if an optional field is blank). */
  num(key: string): number;
  /** Count field (0 if an optional field is blank). */
  count(key: string): number;
  /** Choice field: the picked option's value. */
  choice(key: string): string;
  /** Multi-choice field: the picked values, in the order of the options. */
  picks(key: string): string[];
  /** Areas field: the filled-in rectangles. */
  areas(key: string): Rect[];
  /** Bar list field: the filled-in rows. */
  bars(key: string): BarRow[];
  /** Walls field: the filled-in rows. */
  walls(key: string): WallRow[];
  /** Stock field: the filled-in rows. */
  stock(key: string): StockRow[];
  /** Outline field: the filled-in sides. */
  outline(key: string): OutlineRow[];
  /** Pad field: the sketch and its measurements (null if nothing drawn). */
  pad(key: string): PadValue | null;
  /** True if the field was filled in (a switch: true if it's on). */
  has(key: string): boolean;
  /** Switch field: on or off. */
  on(key: string): boolean;
}

export interface ResultRow {
  label: string;
  value: string;
  /** Main answers are shown bigger */
  big?: boolean;
  /** Small text under the row */
  note?: string;
}

export interface ToolResult {
  rows: ResultRow[];
  /** Plain-English cautions shown in a yellow box */
  warnings?: string[];
  /** Hand these numbers to another tool (a button under the answers opens it filled in) */
  send?: { toolId: string; label: string; raw: Record<string, unknown> };
}

/** Return { error } for values that don't make sense (e.g. cover bigger than the slab). */
export type ComputeOutput = ToolResult | { error: string };

export interface Tool {
  /** Unique, kebab-case: "slab-rebar" */
  id: string;
  title: string;
  /** One short line for the menu */
  blurb: string;
  fields: Field[];
  compute(inp: Inputs): ComputeOutput;
  /** Assumptions / how it works, shown under the results */
  notes?: string[];
}
