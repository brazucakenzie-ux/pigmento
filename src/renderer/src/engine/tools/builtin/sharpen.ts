import { sharpenOp } from '../../brush/retouch';
import { createRetouchTool, STRENGTH } from '../retouchTools';
import { registerTool } from '../ToolRegistry';

export default registerTool(
  createRetouchTool({
    id: 'sharpen',
    labelKey: 'tool.sharpen',
    hintKey: 'tool.sharpen.hint',
    icon: 'sharpen',
    shortcut: 'K',
    order: 30,
    historyLabel: 'history.sharpenBrush',
    options: [STRENGTH(30)],
    op: (_ctx, o, s) => sharpenOp(s.layer.surface, s.shape, s.clip, Number(o.strength ?? 30) / 100),
  }),
);
