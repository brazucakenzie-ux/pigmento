import { createBoxShapeTool } from '../shapeTools';
import { registerTool } from '../ToolRegistry';

export default registerTool(
  createBoxShapeTool({
    id: 'rect',
    kind: 'rect',
    labelKey: 'tool.rect',
    hintKey: 'tool.rect.hint',
    icon: 'rect',
    shortcut: 'R',
    order: 120,
  }),
);
