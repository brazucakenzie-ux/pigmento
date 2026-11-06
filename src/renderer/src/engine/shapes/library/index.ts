import { shapeRegistry } from '../ShapeRegistry';
import { STARS_ARROWS } from './arrows';
import { BASIC } from './basic';
import { FLOWCHART } from './flowchart';
import { NATURE } from './nature';
import { SYMBOLS } from './symbols';

/** Every built-in shape, registered in gallery order. */
export const BUILTIN_SHAPES = [...BASIC, ...STARS_ARROWS, ...FLOWCHART, ...SYMBOLS, ...NATURE];

for (const def of BUILTIN_SHAPES) if (!shapeRegistry.get(def.id)) shapeRegistry.register(def);
