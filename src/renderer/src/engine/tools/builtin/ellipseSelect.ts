import { createSelectTool } from '../selectTools';
import { registerTool } from '../ToolRegistry';

export default registerTool(
  createSelectTool({
    id: 'ellipseSelect',
    kind: 'ellipse',
    labelKey: 'tool.ellipseSelect',
    hintKey: 'tool.ellipseSelect.hint',
    historyKey: 'history.selectEllipse',
    icon: 'ellipse-select',
    shortcut: 'S',
    order: 2,
  }),
);
