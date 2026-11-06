import { BLACK, WHITE, colorEquals, type RGBA } from './core/color';
import { Emitter } from './core/emitter';
import { rectCorners, rectEquals, rectIntersect, rectUnion, type Point, type Rect } from './core/geometry';
import { matApplyPoints, matAround, matRotate, matSkew, matTranslate, matChain } from './core/matrix';
import { PaintDocument, RasterLayer, type Layer } from './doc/Document';
import { LayerController, type LayersInfo } from './doc/LayerController';
import { compositeLayers } from './raster/blend';
import { Selection } from './doc/Selection';
import { History, type HistoryEntry } from './history/History';
import { DocStateCommand, PixelCommand, captureDocState, type CommandHost, type DocState } from './history/commands';
import { LosslessCommand, applyLossless } from './history/TransformCommand';
import { CodecClient, type DecodedImage } from './io/CodecClient';
import { MAX_DIMENSION, MAX_PIXELS } from './io/protocol';
import { FloatObject, rectOutline } from './live/FloatObject';
import type { LiveKind, LiveObject } from './live/LiveObject';
import type { TextObject } from './live/TextObject';
import { alphaBounds, flattenOnto, hasTransparency, invertView, type MaskView } from './raster/pixels';
import { Surface } from './raster/Surface';
import { affineTransform, placeImage, resample, type ImageBuf, type Resample } from './raster/transform';
import { Overlay } from './render/Overlay';
import { Renderer, type LayerFilter, type Theme } from './render/Renderer';
import { View, type ViewState } from './render/View';
import { InputController } from './input/InputController';
import {
  defaultOptions,
  type TextEditState,
  type Tool,
  type ToolContext,
  type ToolOptions,
} from './tools/Tool';
import { toolRegistry, type ToolRegistry } from './tools/ToolRegistry';
import type { I18nKey, I18nParams } from '../i18n';
import type { TileDelta } from './raster/Surface';
import type { OverlayTheme } from './render/Overlay';

export interface DocInfo {
  width: number;
  height: number;
  dpi: number;
  paper: RGBA | null;
}

export interface HistoryInfo {
  index: number;
  length: number;
  canUndo: boolean;
  canRedo: boolean;
  dirty: boolean;
  entries: HistoryEntry[];
  initialLabel: I18nKey;
}

export interface SelectionInfo {
  bounds: Rect | null;
  floating: boolean;
}

export interface Notice {
  kind: 'info' | 'error';
  key: I18nKey;
  params?: I18nParams;
}

export interface EngineEvents {
  doc: DocInfo;
  history: HistoryInfo;
  view: ViewState;
  cursor: Point | null;
  selection: SelectionInfo;
  tool: { id: string };
  toolOptions: { toolId: string; values: ToolOptions };
  colors: { primary: RGBA; secondary: RGBA };
  live: { kind: LiveKind | null };
  text: TextEditState | null;
  hint: { key: I18nKey | null };
  notice: Notice;
  /** Pixels changed (throttle before doing expensive work such as thumbnails). */
  pixels: null;
  /** A canvas-resize drag is in progress (preview size), or ended (null). */
  canvasDrag: { w: number; h: number } | null;
  /** Layer tree, properties or the active layer changed. */
  layers: LayersInfo;
}

export type Anchor = 'nw' | 'n' | 'ne' | 'w' | 'c' | 'e' | 'sw' | 's' | 'se';

export interface ViewOptions {
  pixelGrid: boolean;
  gridlines: boolean;
  gridSize: number;
}

export class EngineError extends Error {
  constructor(
    readonly key: I18nKey,
    readonly params?: I18nParams,
  ) {
    super(key);
  }
}

export function sizeAllowed(w: number, h: number): boolean {
  return w >= 1 && h >= 1 && w <= MAX_DIMENSION && h <= MAX_DIMENSION && w * h <= MAX_PIXELS;
}

function checkSize(w: number, h: number): void {
  if (!sizeAllowed(w, h)) {
    throw new EngineError('error.tooLarge', { w, h, max: Math.round(MAX_PIXELS / 1e6) });
  }
}

/** What to render for an export or "copy image". */
export interface ExportOptions {
  /** Export one layer (or group) on its own instead of the whole image. */
  layerId: string | null;
  /** Leave the paper out. When false the result is opaque (paper, or white without paper). */
  transparent: boolean;
  /** Output scale (1 = actual size). */
  scale: number;
  method: Resample;
}

/**
 * The drawing engine facade. The UI talks only to this class: it owns the document, history,
 * rendering, input and tools, and reports state through typed events.
 */
export class Engine extends Emitter<EngineEvents> implements ToolContext, CommandHost {
  doc: PaintDocument;
  readonly history = new History();
  readonly view = new View();
  readonly renderer: Renderer;
  readonly overlay: Overlay;
  readonly codecs = new CodecClient();
  readonly tools: ToolRegistry = toolRegistry;
  /** Layer operations (add, delete, reorder, merge, properties…). */
  readonly layers = new LayerController(this);
  private input: InputController | null = null;
  private host: HTMLElement | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private dprQuery: MediaQueryList | null = null;

  private activeToolId = 'pencil';
  private previousToolId = 'pencil';
  private toolValues: Record<string, ToolOptions> = {};
  private _primary: RGBA = { ...BLACK };
  private _secondary: RGBA = { ...WHITE };
  private _live: LiveObject | null = null;
  private _transparentSelection = false;
  private viewOptions: ViewOptions = { pixelGrid: true, gridlines: false, gridSize: 16 };
  private frame = 0;
  private antsTimer = 0;
  private pixelsTimer = 0;
  private fillBusy = false;
  reducedMotion = false;
  hover: Point | null = null;

  constructor() {
    super();
    this.doc = new PaintDocument({ width: 1280, height: 800 });
    this.view.setDocSize(this.doc.width, this.doc.height);
    this.renderer = new Renderer(this.doc, this.view);
    this.overlay = new Overlay(this.view);
    this.history.on('change', () => this.emitHistory());
  }

  // ---- lifecycle ------------------------------------------------------------------------

  /** Mount the view and overlay canvases into `el` and start handling input. */
  attach(el: HTMLElement): void {
    this.host = el;
    el.appendChild(this.renderer.viewCanvas);
    el.appendChild(this.overlay.canvas);
    this.input = new InputController(this, this.overlay.canvas);
    this.resizeObserver = new ResizeObserver(() => this.layout());
    this.resizeObserver.observe(el);
    this.watchDpr();
    this.layout();
    this.view.fit();
    this.emitView();
    this.requestRender();
  }

  detach(): void {
    this.input?.dispose();
    this.input = null;
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    cancelAnimationFrame(this.frame);
    window.clearInterval(this.antsTimer);
    this.renderer.viewCanvas.remove();
    this.overlay.canvas.remove();
    this.host = null;
  }

  private watchDpr(): void {
    this.dprQuery?.removeEventListener('change', this.onDprChange);
    this.dprQuery = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
    this.dprQuery.addEventListener('change', this.onDprChange);
  }

  private onDprChange = (): void => {
    // Moving to a monitor with a different scale: re-create backing stores for sharpness.
    this.watchDpr();
    this.layout();
  };

  private layout(): void {
    if (!this.host) return;
    const r = this.host.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.renderer.resizeView(r.width, r.height, dpr);
    this.overlay.resize(r.width, r.height, dpr);
    this.view.setViewport(r.width, r.height);
    this.emitView();
    this.requestRender();
  }

  setTheme(theme: Partial<Theme>, overlay: Partial<OverlayTheme>): void {
    this.renderer.theme = { ...this.renderer.theme, ...theme };
    this.overlay.theme = { ...this.overlay.theme, ...overlay };
    this.requestRender();
  }

  // ---- rendering ------------------------------------------------------------------------

  requestRender(): void {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.renderer.interactive = this.input?.isBusy ?? false;
      this.renderer.render();
      this.renderOverlay();
      // After interaction ends, redraw once at full downscale quality.
      window.clearTimeout(this.settleTimer);
      if (this.renderer.interactive) this.settleTimer = window.setTimeout(() => this.requestRender(), 160);
    });
  }

  private settleTimer = 0;

  invalidate(r: Rect | null): void {
    this.renderer.invalidate(r);
    this.requestRender();
    this.notifyPixels();
  }

  invalidateOverlay(): void {
    this.requestRender();
  }

  private renderOverlay(): void {
    const ov = this.overlay;
    ov.begin();
    if (this.viewOptions.gridlines) ov.gridlines(this.viewOptions.gridSize);
    const sel = this.doc.selection;
    if (sel && this._live?.kind !== 'float') for (const o of sel.outlines) ov.ants(o, true);
    this._live?.drawOverlay(ov);
    this.activeTool.drawOverlay?.(this, ov, this.hover);
    this.input?.drawOverlay(ov);
    this.updateAntsTimer();
  }

  private updateAntsTimer(): void {
    const need = !this.reducedMotion && (this.doc.selection !== null || this._live?.kind === 'float');
    if (need && !this.antsTimer) {
      this.antsTimer = window.setInterval(() => {
        this.overlay.antsOffset = (this.overlay.antsOffset + 1) % 8;
        this.requestRender();
      }, 110);
    } else if (!need && this.antsTimer) {
      window.clearInterval(this.antsTimer);
      this.antsTimer = 0;
    }
  }

  private notifyPixels(): void {
    if (this.pixelsTimer) return;
    this.pixelsTimer = window.setTimeout(() => {
      this.pixelsTimer = 0;
      this.emit('pixels', null);
    }, 200);
  }

  setViewOptions(o: Partial<ViewOptions>): void {
    this.viewOptions = { ...this.viewOptions, ...o };
    this.renderer.showPixelGrid = this.viewOptions.pixelGrid;
    this.requestRender();
  }

  // ---- events ---------------------------------------------------------------------------

  private emitHistory(): void {
    this.emit('history', this.historyInfo());
  }

  historyInfo(): HistoryInfo {
    return {
      index: this.history.index,
      length: this.history.length,
      canUndo: this.history.canUndo || this._live !== null,
      canRedo: this.history.canRedo && this._live === null,
      dirty: this.history.isDirty,
      entries: this.history.entries(),
      initialLabel: this.history.initialLabel,
    };
  }

  docInfo(): DocInfo {
    return { width: this.doc.width, height: this.doc.height, dpi: this.doc.dpi, paper: this.doc.paper };
  }

  emitView(): void {
    this.emit('view', this.view.state());
  }

  emitSelectionInfo(): void {
    const live = this._live;
    let bounds: Rect | null = this.doc.selection?.bounds ?? null;
    if (live?.kind === 'float') bounds = (live as FloatObject).bounds();
    this.emit('selection', { bounds, floating: live?.kind === 'float' });
  }

  notify(kind: Notice['kind'], key: I18nKey, params?: I18nParams): void {
    this.emit('notice', { kind, key, params });
  }

  // ---- CommandHost ----------------------------------------------------------------------

  layerChanged(layer: RasterLayer, r: Rect | null): void {
    this.renderer.syncLayer(layer, r);
    this.requestRender();
    this.notifyPixels();
  }

  structureChanged(): void {
    this.view.setDocSize(this.doc.width, this.doc.height);
    this.renderer.resetDocument(this.doc);
    this.emit('doc', this.docInfo());
    this.emitView();
    this.emitSelectionInfo();
    this.emit('layers', this.layers.info());
    this.requestRender();
    this.notifyPixels();
  }

  layersChanged(): void {
    if (!this.doc.layerById(this.doc.activeId)) this.doc.activeId = this.doc.layers[this.doc.layers.length - 1].id;
    this.renderer.syncTree();
    this.emit('layers', this.layers.info());
    this.requestRender();
    this.notifyPixels();
  }

  setSelection(sel: Selection | null): void {
    this.doc.selection = sel;
    this.emitSelectionInfo();
    this.requestRender();
  }

  // ---- colours --------------------------------------------------------------------------

  get primary(): RGBA {
    return this._primary;
  }

  get secondary(): RGBA {
    return this._secondary;
  }

  setPrimary(c: RGBA): void {
    if (colorEquals(c, this._primary)) return;
    this._primary = { ...c };
    this.colorsChanged();
  }

  setSecondary(c: RGBA): void {
    if (colorEquals(c, this._secondary)) return;
    this._secondary = { ...c };
    this.colorsChanged();
  }

  swapColors(): void {
    [this._primary, this._secondary] = [this._secondary, this._primary];
    this.colorsChanged();
  }

  resetColors(): void {
    this._primary = { ...BLACK };
    this._secondary = { ...WHITE };
    this.colorsChanged();
  }

  private colorsChanged(): void {
    this.emit('colors', { primary: this._primary, secondary: this._secondary });
    this.activeTool.colorsChanged?.(this);
    if (this._live?.kind === 'float' && this._transparentSelection) {
      (this._live as FloatObject).setKeyColor(this._secondary);
      this.invalidate(this._live.bounds());
    }
  }

  get transparentSelection(): boolean {
    return this._transparentSelection;
  }

  setTransparentSelection(on: boolean): void {
    this._transparentSelection = on;
    if (this._live?.kind === 'float') {
      (this._live as FloatObject).setKeyColor(on ? this._secondary : null);
      this.invalidate(this._live.bounds());
    }
  }

  // ---- tools ----------------------------------------------------------------------------

  get activeTool(): Tool {
    return this.tools.get(this.activeToolId) ?? this.tools.all()[0];
  }

  get activeToolIdValue(): string {
    return this.activeToolId;
  }

  options(toolId: string): ToolOptions {
    const tool = this.tools.get(toolId);
    if (!tool) return {};
    const saved = this.toolValues[toolId];
    if (!saved) {
      this.toolValues[toolId] = defaultOptions(tool);
      return this.toolValues[toolId];
    }
    return saved;
  }

  /** Restore saved option values (from settings), ignoring unknown keys. */
  loadToolOptions(values: Record<string, Record<string, unknown>>): void {
    for (const tool of this.tools.all()) {
      const saved = values[tool.id];
      const merged = defaultOptions(tool);
      if (saved) {
        for (const spec of tool.options) {
          if (spec.type === 'hint') continue;
          const v = saved[spec.key];
          if (spec.type === 'slider' && typeof v === 'number' && Number.isFinite(v)) {
            merged[spec.key] = Math.min(spec.max, Math.max(spec.min, v));
          } else if (spec.type === 'toggle' && typeof v === 'boolean') merged[spec.key] = v;
          else if (spec.type === 'segmented' && typeof v === 'string' && spec.choices.some((c) => c.value === v)) {
            merged[spec.key] = v;
          } else if (spec.type === 'font' && typeof v === 'string' && v.length < 200) merged[spec.key] = v;
        }
      }
      this.toolValues[tool.id] = merged;
    }
  }

  allToolOptions(): Record<string, ToolOptions> {
    return this.toolValues;
  }

  setToolOption(toolId: string, key: string, value: unknown): void {
    const o = { ...this.options(toolId), [key]: value };
    this.toolValues[toolId] = o;
    this.emit('toolOptions', { toolId, values: o });
    if (toolId === this.activeToolId) {
      this.activeTool.optionsChanged?.(this);
      this.requestRender();
    }
  }

  setTool(id: string): void {
    if (!this.tools.has(id) || id === this.activeToolId) return;
    const old = this.activeTool;
    this.commitLive();
    old.deactivate?.(this);
    const next = this.tools.get(id)!;
    if (old.group === 'selection' && next.group !== 'selection') this.setSelection(null);
    if (old.id !== 'picker' && old.id !== 'zoom') this.previousToolId = old.id;
    this.activeToolId = id;
    next.activate?.(this);
    this.emit('tool', { id });
    this.emit('hint', { key: null });
    this.input?.refreshCursor();
    this.requestRender();
  }

  restorePreviousTool(): void {
    this.setTool(this.previousToolId);
  }

  setCursor(css: string): void {
    this.overlay.canvas.style.cursor = css;
  }

  setHint(key: I18nKey | null): void {
    this.emit('hint', { key });
  }

  setTextEditing(state: TextEditState | null): void {
    this.emit('text', state);
  }

  /** The UI's in-place text editor reports typed text here. */
  updateText(text: string): void {
    const live = this._live;
    if (live?.kind !== 'text') return;
    const t = live as TextObject;
    const before = t.bounds();
    t.setText(text);
    this.invalidate(rectUnion(before, t.bounds()));
    this.emit('text', t.editState());
  }

  /** Forward a key to the active tool (from the canvas or the text editor). */
  handleKey(e: KeyboardEvent): boolean {
    return this.activeTool.keyDown?.(this, e) ?? false;
  }

  // ---- live objects ---------------------------------------------------------------------

  get live(): LiveObject | null {
    return this._live;
  }

  setLive(obj: LiveObject | null): void {
    if (this._live && this._live !== obj) this.detachLive();
    if (!obj) {
      this.emitLive();
      return;
    }
    this._live = obj;
    this.renderer.liveDrawer = (ctx, r) => obj.draw(ctx, r);
    if (obj.layerFilter) {
      this.addLayerFilter(obj.layerFilter);
      this.syncActiveLayer(obj.filterBounds?.() ?? null);
    }
    this.invalidate(obj.bounds());
    this.emitLive();
  }

  private emitLive(): void {
    this.emit('live', { kind: this._live?.kind ?? null });
    this.emitSelectionInfo();
    this.emitHistory();
    this.requestRender();
  }

  /** Remove the live object from rendering without rasterising it. */
  private detachLive(): LiveObject | null {
    const obj = this._live;
    if (!obj) return null;
    this._live = null;
    this.renderer.liveDrawer = null;
    this.invalidate(obj.bounds());
    if (obj.layerFilter) {
      this.removeLayerFilter(obj.layerFilter);
      this.syncActiveLayer(obj.filterBounds?.() ?? null);
    }
    if (obj.kind === 'text') this.emit('text', null);
    return obj;
  }

  commitLive(keepSelection = false): void {
    const obj = this._live;
    if (!obj) return;
    const float = obj.kind === 'float' ? (obj as FloatObject) : null;
    const text = obj.kind === 'text' ? (obj as TextObject) : null;
    const selAfter = float ? (keepSelection ? obj.selectionAfterCommit?.() ?? null : null) : this.doc.selection;
    const skip = (text && text.isEmpty) || (float && float.isIdentityPlacement);
    const layer = this.doc.activeRaster;
    if (skip || !layer || layer.locked) {
      this.detachLive();
      obj.dispose();
      if (float) this.setSelection(selAfter);
      if (!skip) this.notify('info', layer ? 'notice.layerLocked' : 'notice.notRaster');
      this.emitLive();
      return;
    }
    const selBefore = this.doc.selection;
    // Detach first so the layer display no longer applies the floating hole.
    this.detachLive();
    const s = layer.surface;
    s.beginEdit();
    try {
      obj.rasterize(s, float ? null : this.doc.selection);
    } catch (err) {
      s.abortEdit();
      throw err;
    }
    const delta = s.endEdit();
    this.doc.selection = selAfter;
    this.pushPixels(obj.historyLabel, layer, delta, selBefore, selAfter);
    this.layerChanged(layer, rectUnion(obj.bounds(), obj.filterBounds?.() ?? null));
    obj.dispose();
    this.emitLive();
  }

  cancelLive(): void {
    const obj = this.detachLive();
    if (!obj) return;
    obj.dispose();
    this.emitLive();
  }

  addLayerFilter(f: LayerFilter): void {
    if (!this.renderer.activeFilters.includes(f)) this.renderer.activeFilters.push(f);
  }

  removeLayerFilter(f: LayerFilter): void {
    this.renderer.activeFilters = this.renderer.activeFilters.filter((g) => g !== f);
  }

  syncActiveLayer(r: Rect | null): void {
    const layer = this.doc.activeRaster;
    if (layer) this.renderer.syncLayer(layer, r);
    this.requestRender();
    this.notifyPixels();
  }

  // ---- history --------------------------------------------------------------------------

  pushPixels(
    label: I18nKey,
    layer: RasterLayer,
    delta: TileDelta | null,
    selBefore: Selection | null = this.doc.selection,
    selAfter: Selection | null = this.doc.selection,
  ): void {
    if (!delta) return;
    this.history.push(new PixelCommand(label, this, layer, delta, selBefore, selAfter));
  }

  private pushDocState(label: I18nKey, before: DocState): void {
    this.history.push(new DocStateCommand(label, this, before, captureDocState(this.doc)));
    this.structureChanged();
  }

  canPaint(): boolean {
    const l = this.doc.activeRaster;
    if (!l) {
      this.notify('info', 'notice.notRaster');
      return false;
    }
    if (l.locked) {
      this.notify('info', 'notice.layerLocked');
      return false;
    }
    if (!this.doc.isEffectivelyVisible(l.id)) {
      this.notify('info', 'notice.layerHidden');
      return false;
    }
    return true;
  }

  undo(): void {
    if (this._live) {
      // Undo while editing discards the live object (it isn't in the history yet).
      this.cancelLive();
      return;
    }
    this.history.undo();
  }

  redo(): void {
    if (this._live) return;
    this.history.redo();
  }

  jumpTo(index: number): void {
    this.cancelLive();
    this.history.jumpTo(index);
  }

  markSaved(): void {
    this.history.markSaved();
  }

  markUnsaved(): void {
    this.history.markUnsaved();
  }

  // ---- documents ------------------------------------------------------------------------

  private replaceDocument(doc: PaintDocument, initial: I18nKey): void {
    this.cancelLive();
    this.activeTool.deactivate?.(this);
    for (const l of doc.layers) if (l.name === '') l.name = this.layers.namer('layer', 1);
    this.doc = doc;
    this.history.reset(initial);
    this.view.setDocSize(doc.width, doc.height);
    this.renderer.resetDocument(doc);
    this.view.fit();
    this.activeTool.activate?.(this);
    this.emit('doc', this.docInfo());
    this.emitView();
    this.emitSelectionInfo();
    this.emitHistory();
    this.emit('layers', this.layers.info());
    this.requestRender();
    this.notifyPixels();
  }

  newDocument(width: number, height: number, paper: RGBA | null, dpi = 96): void {
    checkSize(width, height);
    this.replaceDocument(new PaintDocument({ width, height, dpi, paper }), 'history.initial.new');
  }

  /** Replace the document with one read from a project file. */
  loadDocument(doc: PaintDocument): void {
    checkSize(doc.width, doc.height);
    this.replaceDocument(doc, 'history.initial.open');
  }

  /** Open decoded pixels as a new document. Opaque images get white paper. */
  loadImage(img: DecodedImage): void {
    checkSize(img.w, img.h);
    const paper = hasTransparency(img.data) ? null : { ...WHITE };
    const layer = new RasterLayer('', Surface.fromRGBA(img.w, img.h, img.data));
    this.replaceDocument(new PaintDocument({ width: img.w, height: img.h, dpi: img.dpi ?? 96, paper }, [layer]), 'history.initial.open');
  }

  /**
   * Flattened pixels of r (default: the whole image): paper, then visible layers with their
   * blend modes. `opaque` composites onto the paper or white (for JPEG/BMP).
   */
  flatten(opaque = false, r: Rect = this.doc.bounds, withPaper = true): ImageBuf {
    const out = new Uint8ClampedArray(r.w * r.h * 4);
    const view = { data: out, stride: r.w, ox: r.x, oy: r.y };
    const p = this.doc.paper;
    if (p && withPaper) {
      for (let i = 0; i < out.length; i += 4) {
        out[i] = p.r;
        out[i + 1] = p.g;
        out[i + 2] = p.b;
        out[i + 3] = p.a;
      }
    }
    compositeLayers(this.doc.layers, r, view);
    if (opaque) flattenOnto(out, p && p.a === 255 ? p : WHITE);
    return { w: r.w, h: r.h, data: out };
  }

  /** One layer (or group) composited on its own, shown even if it's hidden. */
  private renderLayerAlone(layer: Layer): ImageBuf {
    const r = this.doc.bounds;
    const out = new Uint8ClampedArray(r.w * r.h * 4);
    const wasVisible = layer.visible;
    layer.visible = true;
    try {
      compositeLayers([layer], r, { data: out, stride: r.w, ox: 0, oy: 0 });
    } finally {
      layer.visible = wasVisible;
    }
    return { w: r.w, h: r.h, data: out };
  }

  /** Output size of an export at `scale`. */
  exportSize(scale: number): { w: number; h: number } {
    return { w: Math.max(1, Math.round(this.doc.width * scale)), h: Math.max(1, Math.round(this.doc.height * scale)) };
  }

  /** Pixels for an export or "copy image" (live objects are included once committed by the caller). */
  exportPixels(o: ExportOptions): ImageBuf {
    const layer = o.layerId ? this.doc.layerById(o.layerId) : null;
    let img = layer ? this.renderLayerAlone(layer) : this.flatten(false, this.doc.bounds, !o.transparent);
    if (!o.transparent) {
      const p = this.doc.paper;
      flattenOnto(img.data, p && p.a === 255 ? p : WHITE);
    }
    if (o.scale !== 1) {
      const { w, h } = this.exportSize(o.scale);
      checkSize(w, h);
      img = resample(img, w, h, o.method);
    }
    return img;
  }

  sampleColor(x: number, y: number): RGBA {
    const px = Math.floor(x);
    const py = Math.floor(y);
    if (px < 0 || py < 0 || px >= this.doc.width || py >= this.doc.height) return { ...this._primary };
    const d = this.flatten(false, { x: px, y: py, w: 1, h: 1 }).data;
    return { r: d[0], g: d[1], b: d[2], a: d[3] };
  }

  async floodFill(x: number, y: number, color: RGBA, tolerance: number, contiguous: boolean): Promise<void> {
    if (this.fillBusy || !this.canPaint()) return;
    const px = Math.floor(x);
    const py = Math.floor(y);
    const { width: w, height: h } = this.doc;
    if (px < 0 || py < 0 || px >= w || py >= h) return;
    const layer = this.doc.activeRaster;
    if (!layer) return;
    this.fillBusy = true;
    try {
      const sel = this.doc.selection;
      let clip: Uint8Array | null = null;
      if (sel) {
        clip = new Uint8Array(w * h);
        const b = sel.bounds;
        for (let yy = 0; yy < b.h; yy++) clip.set(sel.mask.subarray(yy * b.w, (yy + 1) * b.w), (b.y + yy) * w + b.x);
      }
      const { mask, bounds } = await this.codecs.fill(layer.surface.toRGBA(), w, h, px, py, tolerance, contiguous, clip);
      if (!bounds || layer !== this.doc.activeRaster) return;
      const s = layer.surface;
      s.beginEdit();
      s.compositeColor(bounds, color, { data: mask, stride: w, ox: 0, oy: 0, w, h }, 'over', 1);
      this.pushPixels('history.fill', layer, s.endEdit());
      this.layerChanged(layer, bounds);
    } finally {
      this.fillBusy = false;
    }
  }

  // ---- view -----------------------------------------------------------------------------

  zoomAt(zoom: number, sx: number, sy: number): void {
    this.view.zoomAt(zoom, sx, sy);
    this.afterViewChange();
  }

  zoomTo(zoom: number): void {
    this.view.zoomCentered(zoom);
    this.afterViewChange();
  }

  zoomStep(dir: 1 | -1, at?: Point): void {
    const z = this.view.nextZoom(dir);
    if (at) this.view.zoomAt(z, at.x, at.y);
    else this.view.zoomCentered(z);
    this.afterViewChange();
  }

  zoomToRect(r: Rect): void {
    this.view.zoomToRect(r);
    this.afterViewChange();
  }

  fit(): void {
    this.view.fit(true);
    this.afterViewChange();
  }

  actualSize(): void {
    this.view.zoomCentered(1);
    this.afterViewChange();
  }

  panBy(dx: number, dy: number): void {
    this.view.panBy(dx, dy);
    this.afterViewChange();
  }

  scrollTo(axis: 'x' | 'y', offset: number): void {
    this.view.scrollTo(axis, offset);
    this.afterViewChange();
  }

  /** Centre the view on a document point (navigator). */
  centerOn(x: number, y: number): void {
    this.view.panBy(this.view.width / 2 - this.view.toScreen(x, y).x, this.view.height / 2 - this.view.toScreen(x, y).y);
    this.afterViewChange();
  }

  private afterViewChange(): void {
    this.emitView();
    if (this._live?.kind === 'text') this.emit('text', (this._live as TextObject).editState());
    this.requestRender();
  }

  // ---- selection & clipboard ------------------------------------------------------------

  /** Pixels inside the selection (alpha masked), relative to its bounds. */
  private selectionPixels(sel: Selection): ImageBuf {
    const b = sel.bounds;
    const layer = this.doc.activeRaster;
    const data = layer ? layer.surface.readRect(b) : new Uint8ClampedArray(b.w * b.h * 4);
    for (let p = 0; p < sel.mask.length; p++) {
      const m = sel.mask[p];
      if (m !== 255) data[p * 4 + 3] = (data[p * 4 + 3] * m) / 255;
    }
    return { w: b.w, h: b.h, data };
  }

  liftSelection(copy: boolean): FloatObject | null {
    const sel = this.doc.selection;
    if (!sel) return null;
    if (this._live?.kind === 'float') return this._live as FloatObject;
    this.commitLive();
    if (!this.canPaint()) return null;
    const b = sel.bounds;
    const img = this.selectionPixels(sel);
    const outline = sel.outlines.map((o) => o.map((p) => ({ x: p.x - b.x, y: p.y - b.y })));
    const hole: MaskView | null = copy ? null : sel.maskView();
    const f = new FloatObject(img, { x: b.x, y: b.y }, outline, hole, 'history.move', this.doc.width, this.doc.height);
    if (this._transparentSelection) f.setKeyColor(this._secondary);
    this.setLive(f);
    return f;
  }

  get floating(): FloatObject | null {
    return this._live?.kind === 'float' ? (this._live as FloatObject) : null;
  }

  hasSelection(): boolean {
    return this.doc.selection !== null || this.floating !== null;
  }

  selectAll(): void {
    this.commitLive();
    if (this.activeTool.group !== 'selection') this.setTool('select');
    this.setSelection(Selection.all(this.doc.width, this.doc.height));
  }

  deselect(): void {
    this.commitLive();
    this.setSelection(null);
  }

  invertSelection(): void {
    this.commitLive(true);
    const sel = this.doc.selection;
    if (this.activeTool.group !== 'selection') this.setTool('select');
    this.setSelection(sel ? sel.inverted(this.doc.width, this.doc.height) : Selection.all(this.doc.width, this.doc.height));
  }

  /** Copy the selection (or floating pixels). Returns null when nothing is selected. */
  copyImage(): ImageBuf | null {
    const f = this.floating;
    if (f) {
      const img = f.rendered(false);
      return { w: img.w, h: img.h, data: img.data.slice() };
    }
    const sel = this.doc.selection;
    return sel ? this.selectionPixels(sel) : null;
  }

  cut(): ImageBuf | null {
    const img = this.copyImage();
    if (img) this.deleteSelection('history.cut');
    return img;
  }

  deleteSelection(label: I18nKey = 'history.delete'): void {
    const f = this.floating;
    const layer = this.doc.activeRaster;
    if (f) {
      this.detachLive();
      const selBefore = this.doc.selection;
      if (f.hole && layer && !layer.locked) {
        const s = layer.surface;
        s.beginEdit();
        s.clearRect({ x: f.hole.ox, y: f.hole.oy, w: f.hole.w, h: f.hole.h }, f.hole);
        this.pushPixels(label, layer, s.endEdit(), selBefore, null);
        this.layerChanged(layer, f.filterBounds());
      }
      f.dispose();
      this.doc.selection = null;
      this.emitLive();
      return;
    }
    const sel = this.doc.selection;
    if (!sel || !layer || !this.canPaint()) return;
    const s = layer.surface;
    s.beginEdit();
    s.clearRect(sel.bounds, sel.maskView());
    this.pushPixels(label, layer, s.endEdit(), sel, null);
    this.layerChanged(layer, sel.bounds);
    this.setSelection(null);
  }

  /** Paste pixels as a floating selection at the top-left of the visible area. */
  pasteImage(img: ImageBuf): void {
    this.commitLive();
    if (this.activeTool.group !== 'selection') this.setTool('select');
    const vis = this.view.visibleDocRect();
    const x = vis ? Math.max(0, Math.min(vis.x, this.doc.width - 1)) : 0;
    const y = vis ? Math.max(0, Math.min(vis.y, this.doc.height - 1)) : 0;
    this.doc.selection = null;
    const f = new FloatObject(img, { x, y }, rectOutline(img.w, img.h), null, 'history.paste', this.doc.width, this.doc.height);
    if (this._transparentSelection) f.setKeyColor(this._secondary);
    this.setLive(f);
  }

  nudgeSelection(dx: number, dy: number): boolean {
    let f = this.floating;
    if (!f && this.doc.selection) f = this.liftSelection(false);
    if (!f) return false;
    const before = f.bounds();
    f.nudge(dx, dy);
    this.invalidate(rectUnion(before, f.bounds()));
    this.emitSelectionInfo();
    return true;
  }

  // ---- image operations -----------------------------------------------------------------

  /** Selection-aware target: returns the floating object if there's a selection. */
  private selectionTarget(): FloatObject | null {
    if (this.floating) return this.floating;
    if (this.doc.selection) return this.liftSelection(false);
    return null;
  }

  private refreshFloat(f: FloatObject, before: Rect | null): void {
    this.invalidate(rectUnion(before, f.bounds()));
    this.emitSelectionInfo();
  }

  flip(axis: 'h' | 'v'): void {
    const f = this.selectionTarget();
    if (f) {
      const before = f.bounds();
      f.flip(axis);
      this.refreshFloat(f, before);
      return;
    }
    this.commitLive();
    const op = { kind: 'flip' as const, axis };
    applyLossless(this.doc, op, false);
    this.history.push(new LosslessCommand('history.flip', this, op));
    this.structureChanged();
  }

  /** Rotate by quarter turns clockwise (1 = 90°, 2 = 180°, 3 = 270°). */
  rotate(quarterTurns: number): void {
    const f = this.selectionTarget();
    if (f) {
      const before = f.bounds();
      f.rotateQuarter(quarterTurns);
      this.refreshFloat(f, before);
      return;
    }
    this.commitLive();
    const op = { kind: 'rotate' as const, quarterTurns };
    if (quarterTurns % 2 !== 0) checkSize(this.doc.height, this.doc.width);
    applyLossless(this.doc, op, false);
    this.history.push(new LosslessCommand('history.rotate', this, op));
    this.structureChanged();
  }

  /** Free rotation (degrees, clockwise). The whole image grows to fit; selections rotate live. */
  rotateFree(degrees: number): void {
    const rad = (degrees * Math.PI) / 180;
    const f = this.selectionTarget();
    if (f) {
      const before = f.bounds();
      f.geom = { ...f.geom, angle: f.geom.angle + rad };
      f.forceCommit = true;
      this.refreshFloat(f, before);
      return;
    }
    this.transformWholeImage('history.rotate', matRotate(rad));
  }

  /** Skew by angles in degrees (horizontal, vertical). */
  skew(degX: number, degY: number): void {
    if (degX === 0 && degY === 0) return;
    const m = matSkew((degX * Math.PI) / 180, (degY * Math.PI) / 180);
    const f = this.selectionTarget();
    if (f) {
      const before = f.bounds();
      const img = f.rendered(false);
      const c = { x: img.x + img.w / 2, y: img.y + img.h / 2 };
      const around = matAround(m, c);
      const warped = affineTransform(img, matChain(matTranslate(img.x, img.y), around), true);
      const outline = f.transformedOutline().map((poly) => matApplyPoints(around, poly));
      f.resetTo(warped, outline);
      this.refreshFloat(f, before);
      return;
    }
    this.transformWholeImage('history.skew', m);
  }

  private transformWholeImage(label: I18nKey, m: ReturnType<typeof matRotate>): void {
    this.commitLive();
    const before = captureDocState(this.doc);
    const { width: w, height: h } = this.doc;
    const centered = matAround(m, { x: w / 2, y: h / 2 });
    // Every layer has the same size, so they share the warped bounds (the new canvas).
    const rasters = this.doc.rasterLayers();
    const results = rasters.map((layer) =>
      affineTransform({ w, h, data: layer.surface.toRGBA() }, centered, true),
    );
    const nw = results[0].w;
    const nh = results[0].h;
    checkSize(nw, nh);
    rasters.forEach((layer, i) => {
      layer.surface = Surface.fromRGBA(nw, nh, results[i].data);
    });
    this.doc.width = nw;
    this.doc.height = nh;
    this.doc.selection = null;
    this.pushDocState(label, before);
  }

  /** Resize the image (or the selection) to w×h pixels. */
  resize(w: number, h: number, method: Resample): void {
    w = Math.max(1, Math.round(w));
    h = Math.max(1, Math.round(h));
    const f = this.selectionTarget();
    if (f) {
      const before = f.bounds();
      f.replacePixels(resample(f.src, w, h, method));
      this.refreshFloat(f, before);
      return;
    }
    if (w === this.doc.width && h === this.doc.height) return;
    checkSize(w, h);
    this.commitLive();
    const before = captureDocState(this.doc);
    for (const layer of this.doc.rasterLayers()) {
      const s = layer.surface;
      const out = resample({ w: s.width, h: s.height, data: s.toRGBA() }, w, h, method);
      layer.surface = Surface.fromRGBA(w, h, out.data);
    }
    this.doc.width = w;
    this.doc.height = h;
    this.doc.selection = null;
    this.pushDocState('history.resize', before);
  }

  /** Change the canvas size, keeping pixels anchored (new area shows the paper). */
  canvasSize(w: number, h: number, anchor: Anchor = 'nw'): void {
    w = Math.max(1, Math.round(w));
    h = Math.max(1, Math.round(h));
    if (w === this.doc.width && h === this.doc.height) return;
    checkSize(w, h);
    this.commitLive();
    const dx = w - this.doc.width;
    const dy = h - this.doc.height;
    const ax = anchor.includes('w') ? 0 : anchor.includes('e') ? dx : Math.round(dx / 2);
    const ay = anchor.startsWith('n') ? 0 : anchor.startsWith('s') ? dy : Math.round(dy / 2);
    this.reframe({ x: -ax, y: -ay, w, h }, 'history.canvasSize');
  }

  /**
   * Make `r` (in current document coordinates, may reach outside) the new canvas: every
   * raster layer is cut or padded to it. One undoable step.
   */
  private reframe(r: Rect, label: I18nKey): void {
    checkSize(r.w, r.h);
    const before = captureDocState(this.doc);
    for (const layer of this.doc.rasterLayers()) {
      const s = layer.surface;
      const out = placeImage({ w: s.width, h: s.height, data: s.toRGBA() }, r.w, r.h, -r.x, -r.y);
      layer.surface = Surface.fromRGBA(r.w, r.h, out.data);
    }
    this.doc.width = r.w;
    this.doc.height = r.h;
    this.doc.selection = null;
    this.pushDocState(label, before);
  }

  /** Crop away edges where no visible layer has pixels (the paper doesn't count). */
  trimTransparentEdges(): void {
    this.commitLive();
    const img = this.flatten(false, this.doc.bounds, false);
    const b = alphaBounds(img.data, img.w, img.h);
    if (!b) {
      this.notify('info', 'notice.trimEmpty');
      return;
    }
    if (rectEquals(b, this.doc.bounds)) {
      this.notify('info', 'notice.trimNothing');
      return;
    }
    this.reframe(b, 'history.trim');
  }

  /**
   * Grow or shrink the canvas to exactly hold every layer's pixels (hidden layers too) and a
   * floating selection that hangs off the edge. The floating selection stays editable.
   */
  fitCanvasToContents(): void {
    if (this._live && this._live.kind !== 'float') this.commitLive(true);
    const float = this.floating;
    let u: Rect | null = null;
    for (const l of this.doc.rasterLayers()) u = rectUnion(u, l.surface.contentBounds());
    if (float) u = rectUnion(u, float.extent());
    if (!u) {
      this.notify('info', 'notice.trimEmpty');
      return;
    }
    if (rectEquals(u, this.doc.bounds)) {
      this.notify('info', 'notice.fitNothing');
      return;
    }
    checkSize(u.w, u.h);
    if (float) this.detachLive();
    let done = false;
    try {
      this.reframe(u, 'history.fitCanvas');
      done = true;
    } finally {
      if (float) {
        if (done) float.reframe(-u.x, -u.y, this.doc.width, this.doc.height);
        this.setLive(float);
      }
    }
  }

  /** Crop the canvas to the selection bounds (pixels outside a free-form selection clear). */
  crop(): void {
    if (this.floating) this.commitLive(true);
    const sel = this.doc.selection;
    if (!sel) return;
    const b = rectIntersect(sel.bounds, this.doc.bounds);
    if (!b) return;
    const before = captureDocState(this.doc);
    for (const layer of this.doc.rasterLayers()) {
      const data = layer.surface.readRect(b);
      if (!sel.isRect) {
        for (let p = 0; p < sel.mask.length; p++) data[p * 4 + 3] = (data[p * 4 + 3] * sel.mask[p]) / 255;
      }
      layer.surface = Surface.fromRGBA(b.w, b.h, data);
    }
    this.doc.width = b.w;
    this.doc.height = b.h;
    this.doc.selection = null;
    this.pushDocState('history.crop', before);
  }

  invertColors(): void {
    const f = this.floating;
    if (f) {
      invertView({ data: f.src.data, stride: f.src.w, ox: 0, oy: 0 }, { x: 0, y: 0, w: f.src.w, h: f.src.h });
      f.setKeyColor(this._transparentSelection ? this._secondary : null);
      f.forceCommit = true;
      this.invalidate(f.bounds());
      return;
    }
    const layer = this.doc.activeRaster;
    if (!layer || !this.canPaint()) return;
    const sel = this.doc.selection;
    const area = sel ? sel.bounds : this.doc.bounds;
    const s = layer.surface;
    s.beginEdit();
    s.invert(area, sel?.maskView() ?? null);
    this.pushPixels('history.invert', layer, s.endEdit());
    this.layerChanged(layer, area);
  }

  /** Image properties: DPI and paper (size changes go through canvasSize). */
  setProperties(p: { dpi?: number; paper?: RGBA | null }): void {
    const before = captureDocState(this.doc);
    let changed = false;
    if (p.dpi !== undefined && p.dpi > 0 && p.dpi !== this.doc.dpi) {
      this.doc.dpi = p.dpi;
      changed = true;
    }
    if (p.paper !== undefined) {
      const cur = this.doc.paper;
      const same = (cur === null && p.paper === null) || (cur && p.paper && colorEquals(cur, p.paper));
      if (!same) {
        this.doc.paper = p.paper ? { ...p.paper } : null;
        changed = true;
      }
    }
    if (changed) this.pushDocState('history.properties', before);
  }

  /** Paste target bigger than canvas? Grow canvas (used by the paste prompt). */
  ensureCanvasFits(w: number, h: number): void {
    const nw = Math.max(this.doc.width, w);
    const nh = Math.max(this.doc.height, h);
    if (nw !== this.doc.width || nh !== this.doc.height) this.canvasSize(nw, nh, 'nw');
  }

  dispose(): void {
    this.detach();
    this.codecs.dispose();
    this.clear();
  }

  /** Test/diagnostic helpers (used by e2e tests through window.__pigmentoTest). */
  debugPixel(x: number, y: number): RGBA {
    return this.sampleColor(x, y);
  }

  debugSelectionOutline(): Point[] | null {
    const s = this.doc.selection;
    return s ? rectCorners(s.bounds) : null;
  }
}
