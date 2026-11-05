import { createBoxShapeTool } from '../shapeTools';
import { registerTool } from '../ToolRegistry';

export default registerTool(
  createBoxShapeTool({
    id: 'roundRect',
    kind: 'roundRect',
    labelKey: 'tool.roundRect',
    hintKey: 'tool.roundRect.hint',
    icon: 'roundRect',
    shortcut: 'U',
    order: 130,
    extraOptions: [
      { key: 'radius', type: 'slider', labelKey: 'opt.radius', min: 0, max: 400, step: 1, unit: 'px', default: 16, log: true },
    ],
  }),
);
