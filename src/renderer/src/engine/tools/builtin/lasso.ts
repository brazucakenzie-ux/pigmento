import { createSelectTool } from '../selectTools';
import { registerTool } from '../ToolRegistry';

export default registerTool(
  createSelectTool({
    id: 'lasso',
    kind: 'lasso',
    labelKey: 'tool.lasso',
    hintKey: 'tool.lasso.hint',
    icon: 'lasso',
    shortcut: 'Q',
    order: 2,
  }),
);
