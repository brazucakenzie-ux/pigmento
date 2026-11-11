import { blurOp } from '../../brush/retouch';
import { createRetouchTool, STRENGTH } from '../retouchTools';
import { registerTool } from '../ToolRegistry';

export default registerTool(
  createRetouchTool({
    id: 'blur',
    labelKey: 'tool.blur',
    hintKey: 'tool.blur.hint',
    icon: 'blur',
    shortcut: 'K',
    order: 20,
    historyLabel: 'history.blurBrush',
    options: [STRENGTH(50)],
    op: (_ctx, o, s) => blurOp(s.layer.surface, s.shape, s.clip, Number(o.strength ?? 50) / 100),
  }),
);
