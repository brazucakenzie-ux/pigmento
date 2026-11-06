import type { Point, Rect } from '../core/geometry';
import type { Overlay } from '../render/Overlay';
import type { Surface } from '../raster/Surface';
import type { PixelView } from '../raster/pixels';
import type { Selection } from '../doc/Selection';
import type { I18nKey } from '../../i18n';

export type LiveKind = 'shape' | 'text' | 'float' | 'transform' | 'gradient';

/**
 * Something being edited above the active layer that hasn't been rasterised yet: a shape with
 * handles, a text box, or a floating selection. Committing rasterises it as one history step.
 */
export interface LiveObject {
  readonly kind: LiveKind;
  readonly historyLabel: I18nKey;
  /** Pixels lifted off the layer (floating selection, free transform): applying replaces the selection. */
  readonly lifted?: boolean;
  /** Applying would change nothing (skipped, no history step). */
  readonly isIdentityPlacement?: boolean;
  /** Area of the document currently covered (for invalidation). */
  bounds(): Rect | null;
  /** Draw into the composite context (document coordinates), limited to r. */
  draw(ctx: OffscreenCanvasRenderingContext2D, r: Rect): void;
  /** Handles, outlines and guides (screen space). */
  drawOverlay(ov: Overlay): void;
  /** Optional display filter on the active layer (e.g. the hole left by a lifted selection). */
  layerFilter?: (view: PixelView, r: Rect) => void;
  /** Area the layer filter affects. */
  filterBounds?(): Rect | null;
  /** Rasterise into `surface` (called inside a surface edit). */
  rasterize(surface: Surface, clip: Selection | null): void;
  /** Selection to keep after committing (floating selections keep a moved selection). */
  selectionAfterCommit?(): Selection | null;
  /** CSS cursor when hovering at doc point p (screen point sp), or null to defer to the tool. */
  cursorAt?(p: Point, sp: Point): string | null;
  dispose(): void;
}
