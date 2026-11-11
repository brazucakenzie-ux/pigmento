import { TONE_RANGES, toneOp, type ToneRange } from '../../brush/retouch';
import type { I18nKey } from '../../../i18n';
import { createRetouchTool, STRENGTH } from '../retouchTools';
import { registerTool } from '../ToolRegistry';

export default registerTool(
  createRetouchTool({
    id: 'dodgeBurn',
    labelKey: 'tool.dodgeBurn',
    hintKey: 'tool.dodgeBurn.hint',
    icon: 'dodge-burn',
    shortcut: 'H',
    order: 50,
    historyLabel: 'history.dodgeBurn',
    options: [
      {
        key: 'mode',
        type: 'segmented',
        labelKey: 'opt.toneMode',
        default: 'dodge',
        choices: [
          { value: 'dodge', labelKey: 'opt.toneMode.dodge' },
          { value: 'burn', labelKey: 'opt.toneMode.burn' },
        ],
      },
      { key: 'range', type: 'segmented', labelKey: 'opt.toneRange', default: 'midtones', choices: TONE_RANGES.map((r) => ({ value: r, labelKey: `opt.toneRange.${r}` as I18nKey })) },
      STRENGTH(30, 'opt.exposure'),
    ],
    op: (_ctx, o, s) =>
      toneOp(s.layer.surface, s.shape, s.clip, o.mode === 'burn' ? 'burn' : 'dodge', (TONE_RANGES as readonly string[]).includes(String(o.range)) ? (o.range as ToneRange) : 'midtones', Number(o.strength ?? 30) / 100),
  }),
);
