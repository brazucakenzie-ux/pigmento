import type { AssistantCall, AssistantReply, AssistantResult } from '@shared/ipc';
import type { LayerNode } from '@engine/doc/LayerController';
import { engine } from '../state/engine';
import { useUi } from '../state/store';

/**
 * This window's side of AI assistants (see main/mcp): it carries out the tool calls main sends it,
 * on its own picture, and answers each one with what it did or why it couldn't.
 */

type Handler = (args: Record<string, unknown>, call: AssistantCall) => AssistantResult | Promise<AssistantResult>;

/** A layer as an assistant sees it (top first, like the Layers panel). */
interface LayerView {
  id: string;
  name: string;
  kind: string;
  visible: boolean;
  locked: boolean;
  opacity: number;
  blend: string;
  active: boolean;
  children?: LayerView[];
}

function layerView(n: LayerNode, activeId: string): LayerView {
  return {
    id: n.id,
    name: n.name,
    kind: n.kind === 'raster' ? 'pixels' : n.kind === 'vector' ? 'shapes' : 'group',
    visible: n.visible,
    locked: n.locked,
    opacity: Math.round(n.opacity * 100) / 100,
    blend: n.blend,
    active: n.id === activeId,
    ...(n.kind === 'group' ? { children: [...n.children].reverse().map((c) => layerView(c, activeId)) } : {}),
  };
}

/** The picture in this window, in brief. */
function pictureInfo(): AssistantResult {
  const s = useUi.getState();
  const layers = engine.layers.info();
  const anim = engine.anim.info();
  const sel = s.selection.bounds;
  const data = {
    width: engine.doc.width,
    height: engine.doc.height,
    file: s.file.path,
    name: s.file.name ?? 'Untitled',
    unsavedChanges: s.history.dirty,
    layers: [...layers.tree].reverse().map((n) => layerView(n, layers.activeId)),
    selection: sel ? { x: sel.x, y: sel.y, width: sel.w, height: sel.h } : null,
    animation: {
      frame: anim.frame,
      length: anim.length,
      fps: anim.fps,
      pieces: anim.pieces.map((p) => ({ id: p.id, name: p.name, kind: p.kind, layer: p.layerId, keyframes: p.keys.map((k) => k.frame), drawings: p.drawings })),
    },
  };
  return { text: `${data.name}: ${data.width} × ${data.height} pixels, ${layers.count} layer${layers.count === 1 ? '' : 's'}${data.unsavedChanges ? ', with unsaved changes' : ''}.`, data };
}

const HANDLERS: Record<string, Handler> = {
  get_picture_info: () => pictureInfo(),
};

/** Carry out assistants' calls in this window until the returned function stops it. */
export function startAssistants(): () => void {
  const api = window.pigmento.assistant;
  return api.onCall((call) => {
    void (async () => {
      let reply: AssistantReply;
      try {
        const h = HANDLERS[call.tool];
        reply = h ? { ok: true, result: await h(call.args, call) } : { ok: false, error: `This Pigmento window doesn’t know the tool ${call.tool}.` };
      } catch (err) {
        reply = { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
      api.reply(call.id, reply);
    })();
  });
}
