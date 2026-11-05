import { createBoxShapeTool } from '../shapeTools';
import { registerTool } from '../ToolRegistry';

export default registerTool(
  createBoxShapeTool({
    id: 'ellipse',
    kind: 'ellipse',
    labelKey: 'tool.ellipse',
    hintKey: 'tool.ellipse.hint',
    icon: 'ellipse',
    shortcut: 'O',
    order: 140,
  }),
);
