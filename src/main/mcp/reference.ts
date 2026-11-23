import { z } from 'zod';
import { RESOURCES, TOOLS } from './tools';
import type { AssistantKind, ToolDef } from './types';

/**
 * The tool reference (docs/mcp.md), made from the tools themselves so it can't drift from them:
 * a unit test compares the file with this, and `npm run mcp-docs` writes it.
 */

const SECTIONS: readonly { title: string; tools: readonly string[] }[] = [
  { title: 'Looking', tools: ['list_windows', 'get_picture_info', 'get_picture_image', 'list_available', 'get_settings'] },
  { title: 'Pictures and files', tools: ['new_picture', 'open_file', 'save_file', 'export_image', 'close_window', 'focus_window'] },
  { title: 'Layers and selections', tools: ['add_layer', 'delete_layer', 'move_layer', 'group_layers', 'set_layer', 'select', 'transform_pixels'] },
  { title: 'Painting', tools: ['set_colors', 'fill', 'brush_stroke', 'draw_line', 'draw_shape', 'draw_path', 'add_text'] },
  { title: 'The image, effects, actions and settings', tools: ['resize_image', 'crop', 'canvas_size', 'set_picture_properties', 'rotate_flip', 'apply_effect', 'run_action', 'change_settings'] },
  { title: 'Animation', tools: ['make_piece', 'set_keyframe', 'set_piece', 'set_trail', 'set_trim', 'set_animation', 'edit_drawing', 'export_animation'] },
];

const KIND: Record<AssistantKind, string> = {
  look: 'Look at pictures',
  edit: 'Draw and edit',
  files: 'Open, save and export files',
  pictures: 'New, close and switch pictures',
  settings: 'Change Pigmento’s settings',
};

type Schema = {
  type?: string | string[];
  description?: string;
  enum?: unknown[];
  const?: unknown;
  minimum?: number;
  maximum?: number;
  minItems?: number;
  items?: Schema;
  properties?: Record<string, Schema>;
  required?: string[];
  anyOf?: Schema[];
};

/** A schema's type, in a few words. */
function typeOf(s: Schema): string {
  if (s.anyOf) return s.anyOf.map(typeOf).join(' or ');
  if (s.const !== undefined) return `\`${JSON.stringify(s.const)}\``;
  if (s.enum) return s.enum.map((v) => `\`${String(v)}\``).join(', ');
  if (s.type === 'array') return `list of ${s.items ? typeOf(s.items) : 'values'}`;
  if (s.type === 'object') return s.properties ? `{ ${Object.keys(s.properties).join(', ')} }` : 'object';
  const t = Array.isArray(s.type) ? s.type.join(' or ') : (s.type ?? 'any');
  // (zod gives every whole number JavaScript's safe-integer limits: they say nothing here.)
  const min = s.minimum !== undefined && Math.abs(s.minimum) < Number.MAX_SAFE_INTEGER ? s.minimum : undefined;
  const max = s.maximum !== undefined && Math.abs(s.maximum) < Number.MAX_SAFE_INTEGER ? s.maximum : undefined;
  const range = min !== undefined && max !== undefined ? ` ${min} to ${max}` : min !== undefined ? ` from ${min}` : max !== undefined ? ` up to ${max}` : '';
  return `${t === 'integer' ? 'whole number' : t}${range}`;
}

const cell = (s: string) => s.replace(/\|/g, '\\|').replace(/\n/g, ' ');

/** One tool, as a section of the reference. */
function toolSection(t: ToolDef): string {
  const schema = z.toJSONSchema(z.object(t.input), { io: 'input' }) as Schema;
  const props = Object.entries(schema.properties ?? {});
  const required = new Set(schema.required ?? []);
  const lines = [`### \`${t.name}\` (${t.title})`, '', t.description, '', `Permission: ${KIND[t.kind]}.${t.readOnly ? ' Only reads.' : ''}`];
  if (props.length) {
    lines.push('', '| Argument | Type | Description |', '|---|---|---|');
    for (const [name, p] of props) {
      const sub = p.type === 'object' && p.properties ? ` Its fields: ${Object.entries(p.properties).map(([k, v]) => `\`${k}\` (${typeOf(v)}${v.description ? `: ${v.description}` : ''})`).join('; ')}.` : '';
      lines.push(`| \`${name}\`${required.has(name) ? '' : ' (optional)'} | ${cell(typeOf(p))} | ${cell((p.description ?? '') + sub)} |`);
    }
  }
  return lines.join('\n');
}

export function mcpReference(): string {
  const listed = new Set(SECTIONS.flatMap((s) => s.tools));
  const missing = TOOLS.filter((t) => !listed.has(t.name)).map((t) => t.name);
  if (missing.length) throw new Error(`The reference has no section for: ${missing.join(', ')}`);
  const byName = new Map(TOOLS.map((t) => [t.name, t]));
  const parts = [
    '# Pigmento for AI assistants: tool reference',
    '',
    '<!-- Made from the tools themselves (src/main/mcp): run `npm run mcp-docs` after changing one. -->',
    '',
    `Pigmento offers ${TOOLS.length} tools and ${RESOURCES.length} resources to AI assistants over the Model Context Protocol. The [user guide](user-guide.md#ai-assistants) says how to connect one and how to choose what assistants may do.`,
    '',
    '- Positions and sizes are in picture pixels, from the top-left corner. Animation frames are numbered from 1, as in the timeline.',
    '- Colours are `#rrggbb` or `#rrggbbaa`. Layers, pieces and shapes are named by the ids `get_picture_info` gives.',
    '- Each tool acts on the window the user is working in. Every tool except `list_windows` also takes an optional `window` (an id from `list_windows`) to act on another.',
    '- Each call that changes the picture is one undo step, named "Assistant: …" in the History panel.',
    '- Each tool is checked against a permission (Settings → AI assistants), which the user can set to Allowed, Ask each time or Not allowed.',
  ];
  for (const s of SECTIONS) parts.push('', `## ${s.title}`, '', s.tools.map((n) => toolSection(byName.get(n)!)).join('\n\n'));
  parts.push('', '## Resources', '', 'The same views as resources, of the window the user is working in:', '', '| URI | What it is |', '|---|---|');
  for (const r of RESOURCES) parts.push(`| \`${r.uri}\` | ${r.description} (${r.mimeType}) |`);
  return `${parts.join('\n')}\n`;
}
