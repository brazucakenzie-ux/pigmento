import type { I18nKey } from '../../i18n';
import type { RGBA } from '../core/color';
import { rectIntersect, rectUnion, type Rect } from '../core/geometry';
import type { RasterLayer } from '../doc/Document';
import type { MaskView } from '../raster/pixels';
import { Surface } from '../raster/Surface';
import type { LayerFilter } from '../render/Renderer';
import { compositeStroke } from '../tools/brushTool';
import type { ToolContext } from '../tools/Tool';
import { BrushStroke, strokeSeed } from './BrushStroke';
import { dabShapeOf, paintDabInto } from './dab';
import type { BrushSettings } from './types';

/** The brush a stroke from given points paints with. */
export interface ScriptedBrush {
  settings: BrushSettings;
  /** Diameter in px. */
  size: number;
  opacity: number;
  color: RGBA;
  /** Takes paint away instead (the eraser). */
  erase: boolean;
}

/** A point of the stroke, in document pixels, with pen pressure (1 if not given). */
export interface StrokePoint {
  x: number;
  y: number;
  pressure?: number;
}

/**
 * A brush stroke painted from given points instead of the pointer (an AI assistant's): shown over
 * the layer as points are added, like a stroke being drawn, and painted into the layer, inside the
 * selection, as one command when it ends. The tool, its options and the colours aren't touched.
 */
export class ScriptedStroke {
  private readonly surface: Surface;
  private readonly stroke: BrushStroke;
  private readonly filter: LayerFilter;
  private readonly clip: MaskView | null;
  private bounds: Rect | null = null;
  private started = false;
  private over = false;

  constructor(
    private readonly ctx: ToolContext,
    private readonly layer: RasterLayer,
    private readonly brush: ScriptedBrush,
    first: StrokePoint,
  ) {
    this.surface = new Surface(layer.surface.width, layer.surface.height);
    const clip = ctx.doc.selection?.maskView() ?? null;
    const shape = dabShapeOf(brush.settings);
    this.stroke = new BrushStroke({
      settings: brush.settings,
      size: brush.size,
      color: brush.color,
      seed: strokeSeed(first.x, first.y),
      pickColor: (x, y) => layer.surface.getPixel(Math.floor(x), Math.floor(y)),
      emit: (d) => paintDabInto(this.surface, d, shape),
    });
    const op = brush.erase ? 'erase' : 'over';
    this.filter = (view, r) => {
      const area = this.bounds ? rectIntersect(r, this.bounds) : null;
      if (area) compositeStroke(view, area, this.surface, op, brush.opacity, clip);
    };
    ctx.addLayerFilter(this.filter);
    this.clip = clip;
  }

  /** Carry the stroke on through these points, showing what they paint. */
  add(points: readonly StrokePoint[]): void {
    if (this.over) return;
    let dirty: Rect | null = null;
    for (const p of points) {
      const s = { x: p.x, y: p.y, pressure: Math.min(1, Math.max(0, p.pressure ?? 1)), tilt: 0, speed: 0.4 };
      dirty = rectUnion(dirty, this.started ? this.stroke.to(s) : this.stroke.begin(s));
      this.started = true;
    }
    this.bounds = rectUnion(this.bounds, dirty);
    if (dirty) this.ctx.syncActiveLayer(dirty);
  }

  /** Paint it into the layer as one command named `label`. Returns the area it painted. */
  end(label: I18nKey): Rect | null {
    if (this.over) return null;
    this.over = true;
    this.ctx.removeLayerFilter(this.filter);
    const b = this.bounds ? rectIntersect(this.bounds, this.ctx.doc.bounds) : null;
    if (!b) return null;
    const surf = this.layer.surface;
    surf.beginEdit();
    this.surface.forEachTile(b, (sv, sub) => surf.compositeImage(sub, sv, this.brush.erase ? 'erase' : 'over', this.brush.opacity, this.clip), false, true);
    this.ctx.pushPixels(label, this.layer, surf.endEdit());
    this.ctx.syncActiveLayer(b);
    return b;
  }

  /** Stop showing it, painting nothing. */
  cancel(): void {
    if (this.over) return;
    this.over = true;
    this.ctx.removeLayerFilter(this.filter);
    if (this.bounds) this.ctx.syncActiveLayer(this.bounds);
  }
}
