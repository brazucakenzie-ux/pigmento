import type { RGBA } from '../core/color';
import type { Point, Rect } from '../core/geometry';
import type { PaintDocument, Layer, VectorLayer } from '../doc/Document';
import type { VectorNode } from '../vector/model';
import type { ShapeStyle } from '../live/ShapeObject';
import type { Selection, SelectionMode } from '../doc/Selection';
import type { History } from '../history/History';
import type { LiveObject } from '../live/LiveObject';
import type { Overlay } from '../render/Overlay';
import type { View } from '../render/View';
import type { LayerFilter } from '../render/Renderer';
import type { TileDelta } from '../raster/Surface';
import type { I18nKey } from '../../i18n';

/** Where a tool's button goes in the ribbon. */
export type ToolGroup = 'selection' | 'tools' | 'brushes' | 'shapes';

interface OptionBase {
  key: string;
  labelKey: I18nKey;
  /** Hide this option unless the predicate on current values holds. */
  visibleIf?: (values: Record<string, unknown>) => boolean;
}

export type OptionSpec =
  | (OptionBase & {
      type: 'slider';
      min: number;
      max: number;
      step?: number;
      unit?: 'px' | '%' | 'pt' | '×';
      default: number;
      /** Quick-pick values shown as chips (Paint-style size picker). */
      presets?: number[];
      /** Logarithmic slider for wide ranges such as brush size. */
      log?: boolean;
    })
  | (OptionBase & { type: 'toggle'; default: boolean; icon?: string })
  | (OptionBase & {
      type: 'segmented';
      default: string;
      choices: { value: string; labelKey: I18nKey; icon?: string }[];
      iconsOnly?: boolean;
    })
  | (OptionBase & { type: 'font'; default: string })
  /** Gradient colours: a list of stops, or null for primary → secondary colour. */
  | (OptionBase & { type: 'gradient'; default: GradientStopValue[] | null })
  /** A fill pattern id (built-in or saved). */
  | (OptionBase & { type: 'pattern'; default: string })
  /** A shape from the shape library (its id). */
  | (OptionBase & { type: 'shape'; default: string })
  /** Slider values per library shape: { shapeId: { param: value } }; `shapeKey` names the shape option. */
  | (OptionBase & { type: 'shapeParams'; shapeKey: string; default: Record<string, Record<string, number>> })
  | (OptionBase & { type: 'hint' });

export type ToolOptions = Record<string, unknown>;

/** How gradient stops are kept in tool options (and settings): colour as #rrggbbaa. */
export interface GradientStopValue {
  pos: number;
  color: string;
}

/** Pattern paint for the Fill tool. */
export interface FillPattern {
  pattern: string;
  /** Pattern colours for built-in patterns (saved patterns keep their own). */
  fg: RGBA;
  bg: RGBA | null;
  /** Whole-number zoom of the tile, 1–8. */
  scale: number;
}

export interface ToolPointerEvent {
  /** Document coordinates (fractional). */
  x: number;
  y: number;
  /** Screen coordinates in CSS px relative to the canvas viewport. */
  sx: number;
  sy: number;
  pressure: number;
  tiltX: number;
  tiltY: number;
  pointerType: 'mouse' | 'pen' | 'touch';
  /** 0 = primary (left/pen tip), 2 = secondary (right/barrel). */
  button: 0 | 2;
  shift: boolean;
  alt: boolean;
  ctrl: boolean;
  /** Pen held with the eraser end. */
  eraser: boolean;
  /** Click count (2 = double-click). */
  detail: number;
  timeStamp: number;
}

/** Engine services available to tools. The Engine implements this interface. */
export interface ToolContext {
  readonly doc: PaintDocument;
  readonly view: View;
  readonly history: History;
  readonly primary: RGBA;
  readonly secondary: RGBA;
  readonly live: LiveObject | null;
  readonly transparentSelection: boolean;
  setPrimary(c: RGBA): void;
  setSecondary(c: RGBA): void;
  /** Options of the given tool (defaults merged with saved values). */
  options(toolId: string): ToolOptions;
  /** Composite area changed (live objects). */
  invalidate(r: Rect | null): void;
  invalidateOverlay(): void;
  /** Re-upload the active layer inside r through any display filters. */
  syncActiveLayer(r: Rect | null): void;
  addLayerFilter(f: LayerFilter): void;
  removeLayerFilter(f: LayerFilter): void;
  setLive(obj: LiveObject | null): void;
  /** Rasterise the live object; `keepSelection` keeps a moved floating selection selected. */
  commitLive(keepSelection?: boolean): void;
  cancelLive(): void;
  /** Record a pixel change of `layer` as an undoable step. */
  pushPixels(label: I18nKey, layer: Layer, delta: TileDelta | null, selBefore?: Selection | null, selAfter?: Selection | null): void;
  /** True if the active layer can be painted (visible and unlocked); notifies otherwise. */
  canPaint(): boolean;
  /** Show a selection without recording it (e.g. while a new one is being drawn). */
  setSelection(sel: Selection | null): void;
  /** Change the selection as an undoable step. */
  changeSelection(sel: Selection | null, label: I18nKey): void;
  /** Combine a new selection with the current one by `mode`, as an undoable step. */
  applySelection(next: Selection | null, mode: SelectionMode, label: I18nKey): void;
  /** Select similar colour around (x, y). */
  magicWand(x: number, y: number, o: { tolerance: number; contiguous: boolean; sampleAll: boolean }, mode: SelectionMode): Promise<void>;
  /** Re-report selection size/position (after moving a floating selection). */
  emitSelectionInfo(): void;
  /** Lift the current selection into a floating object (copy = leave the original). */
  liftSelection(copy: boolean): LiveObject | null;
  setTool(id: string): void;
  restorePreviousTool(): void;
  /** Colour of the composited image (paper included) at a document pixel. */
  sampleColor(x: number, y: number): RGBA;
  /** Snap a document point to the grid, guides, canvas and objects (when snapping is on). */
  snapPoint(p: Point): Point;
  /** Shift that lines a moving box up with the snap targets (shows alignment lines). */
  snapMove(r: Rect): Point;
  /** Shape layers: the active one, and its selected objects (by id). */
  readonly activeVector: VectorLayer | null;
  readonly vectorSelection: readonly string[];
  setVectorSelection(ids: readonly string[]): void;
  selectedVectorNodes(): VectorNode[];
  /** Topmost object under a document point on the active shape layer. */
  vectorHit(p: Point): string | null;
  vectorIdsIn(r: Rect): string[];
  /** Show objects during a drag; record the drag as one step at the end. */
  previewVector(layer: VectorLayer, objects: readonly VectorNode[]): void;
  recordVector(label: I18nKey, layer: VectorLayer, before: readonly VectorNode[]): void;
  /** Edit an object's corners and handles as a live shape. */
  editVectorShape(id: string): boolean;
  restyleVector(change: Partial<ShapeStyle>): void;
  /** Delete the selected objects (or selected pixels). */
  deleteSelection(): void;
  selectedVectorStyle(): ShapeStyle | null;
  /** Fill the area of similar colour with a colour or a pattern. */
  floodFill(x: number, y: number, paint: RGBA | FillPattern, tolerance: number, contiguous: boolean): Promise<void>;
  zoomAt(zoom: number, sx: number, sy: number): void;
  zoomToRect(r: Rect): void;
  setCursor(css: string): void;
  /** Report the tool's hint text override (null restores the default hint). */
  setHint(key: I18nKey | null): void;
  /** Text-editing state for the UI's in-place editor. */
  setTextEditing(state: TextEditState | null): void;
}

export interface TextEditState {
  text: string;
  /** Document-space top-left and size of the text box. */
  x: number;
  y: number;
  w: number;
  h: number;
  fontCss: string;
  fontPx: number;
  lineHeightPx: number;
  align: 'left' | 'center' | 'right';
  color: string;
  underline: boolean;
  strike: boolean;
  /** Bumped when the editor should re-focus/re-read (new box). */
  session: number;
}

export interface Tool {
  readonly id: string;
  readonly labelKey: I18nKey;
  readonly hintKey: I18nKey;
  /** Icon id resolved by the UI's icon map. */
  readonly icon: string;
  readonly shortcut?: string;
  readonly group: ToolGroup;
  readonly order: number;
  /** Not shown in the ribbon or menus (a mode entered by a command, like free transform). */
  readonly hidden?: boolean;
  readonly options: OptionSpec[];
  /** Tool records a history step and benefits from the pen's eraser end override. */
  readonly paints?: boolean;
  cursor(ctx: ToolContext, p: Point | null): string;
  activate?(ctx: ToolContext): void;
  deactivate?(ctx: ToolContext): void;
  pointerDown(ctx: ToolContext, e: ToolPointerEvent): void;
  pointerMove(ctx: ToolContext, e: ToolPointerEvent): void;
  pointerUp(ctx: ToolContext, e: ToolPointerEvent): void;
  hover?(ctx: ToolContext, e: ToolPointerEvent): void;
  /** Return true if the key was handled. */
  keyDown?(ctx: ToolContext, e: KeyboardEvent): boolean;
  drawOverlay?(ctx: ToolContext, ov: Overlay, hover: Point | null): void;
  optionsChanged?(ctx: ToolContext): void;
  colorsChanged?(ctx: ToolContext): void;
}

export function defaultOptions(tool: Tool): ToolOptions {
  const o: ToolOptions = {};
  for (const spec of tool.options) if (spec.type !== 'hint') o[spec.key] = spec.default;
  return o;
}
