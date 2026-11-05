import { createSelectTool } from '../selectTools';
import { registerTool } from '../ToolRegistry';

export default registerTool(
  createSelectTool({
    id: 'select',
    kind: 'rect',
    labelKey: 'tool.select',
    hintKey: 'tool.select.hint',
    icon: 'select',
    shortcut: 'S',
    order: 1,
  }),
);
