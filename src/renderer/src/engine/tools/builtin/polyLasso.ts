import { createSelectTool } from '../selectTools';
import { registerTool } from '../ToolRegistry';

export default registerTool(
  createSelectTool({
    id: 'polyLasso',
    kind: 'polygon',
    labelKey: 'tool.polyLasso',
    hintKey: 'tool.polyLasso.hint',
    historyKey: 'history.selectPolygon',
    icon: 'poly-lasso',
    shortcut: 'Q',
    order: 4,
  }),
);
