import { smudgeOp } from '../../brush/retouch';
import { createRetouchTool, STRENGTH } from '../retouchTools';
import { registerTool } from '../ToolRegistry';

export default registerTool(
  createRetouchTool({
    id: 'smudge',
    labelKey: 'tool.smudge',
    hintKey: 'tool.smudge.hint',
    icon: 'smudge',
    shortcut: 'K',
    order: 10,
    historyLabel: 'history.smudge',
    options: [STRENGTH(60)],
    op: (_ctx, o, s) => smudgeOp(s.layer.surface, s.shape, s.clip, Number(o.strength ?? 60) / 100),
  }),
);
