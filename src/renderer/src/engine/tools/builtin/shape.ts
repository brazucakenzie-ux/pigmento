import { resolveParams, shapeRegistry } from '../../shapes/ShapeRegistry';
import '../../shapes/library';
import { createBoxShapeTool } from '../shapeTools';
import { registerTool } from '../ToolRegistry';
import type { OptionSpec, ToolOptions } from '../Tool';

export const DEFAULT_LIBRARY_SHAPE = 'star-5';

const SHAPE_OPTION: OptionSpec = {
  key: 'shapeId',
  type: 'shape',
  labelKey: 'opt.shape',
  default: DEFAULT_LIBRARY_SHAPE,
};
const PARAMS_OPTION: OptionSpec = {
  key: 'params',
  type: 'shapeParams',
  labelKey: 'opt.shapeParams',
  shapeKey: 'shapeId',
  default: {},
};

/** The library shape the Shape tool draws, with its slider values (defaults filled in). */
export function libraryShapeOf(o: ToolOptions): {
  shapeId: string;
  params: Record<string, number>;
} {
  const def =
    shapeRegistry.get(String(o.shapeId ?? '')) ?? shapeRegistry.get(DEFAULT_LIBRARY_SHAPE)!;
  const table = (o.params ?? {}) as Record<string, Record<string, number> | undefined>;
  return { shapeId: def.id, params: resolveParams(def, table[def.id]) };
}

export default registerTool(
  createBoxShapeTool({
    id: 'shape',
    kind: 'parametric',
    labelKey: 'tool.shape',
    hintKey: 'tool.shape.hint',
    icon: 'shapes',
    shortcut: 'U',
    order: 160,
    leadOptions: [SHAPE_OPTION],
    extraOptions: [PARAMS_OPTION],
    library: (ctx) => libraryShapeOf(ctx.options('shape')),
  }),
);
