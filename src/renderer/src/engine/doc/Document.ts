import type { RGBA } from '../core/color';
import { Surface } from '../raster/Surface';
import type { Selection } from './Selection';

/** Canvas 2D composite operation names (Milestone 2 exposes these in the Layers panel). */
export type BlendMode =
  | 'normal'
  | 'multiply'
  | 'screen'
  | 'overlay'
  | 'darken'
  | 'lighten'
  | 'color-dodge'
  | 'color-burn'
  | 'difference'
  | 'soft-light'
  | 'hard-light'
  | 'hue'
  | 'saturation'
  | 'color'
  | 'luminosity';

let nextId = 1;
export function newId(prefix: string): string {
  return `${prefix}-${(nextId++).toString(36)}-${Date.now().toString(36)}`;
}

export class RasterLayer {
  readonly kind = 'raster' as const;
  readonly id: string;
  name: string;
  surface: Surface;
  opacity = 1;
  blend: BlendMode = 'normal';
  visible = true;
  locked = false;

  constructor(name: string, surface: Surface, id?: string) {
    this.id = id ?? newId('layer');
    this.name = name;
    this.surface = surface;
  }
}

export type Layer = RasterLayer;

export interface DocumentInit {
  width: number;
  height: number;
  dpi?: number;
  paper?: RGBA | null;
}

/**
 * The image being edited. `paper` is the canvas colour shown under all layers (null means
 * transparent). Layers are bottom-to-top.
 */
export class PaintDocument {
  width: number;
  height: number;
  dpi: number;
  paper: RGBA | null;
  layers: Layer[];
  activeIndex = 0;
  selection: Selection | null = null;

  constructor(init: DocumentInit, layers?: Layer[]) {
    this.width = init.width;
    this.height = init.height;
    this.dpi = init.dpi ?? 96;
    this.paper = init.paper === undefined ? { r: 255, g: 255, b: 255, a: 255 } : init.paper;
    // Layer names are user content; '' means "unnamed" and the UI shows a localised default.
    this.layers = layers ?? [new RasterLayer('', new Surface(init.width, init.height))];
  }

  get activeLayer(): Layer {
    return this.layers[Math.min(this.activeIndex, this.layers.length - 1)];
  }

  layerById(id: string): Layer | undefined {
    return this.layers.find((l) => l.id === id);
  }

  get bounds() {
    return { x: 0, y: 0, w: this.width, h: this.height };
  }
}
