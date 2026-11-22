import { ASSISTANT_ASK, type AssistantCall, type AssistantReply, type AssistantResult } from '@shared/ipc';
import { engine } from '../state/engine';
import { openDialog, useUi } from '../state/store';
import { errorText, type Handler } from './assistantArgs';
import { carryOutChange, isChange } from './assistantChange';
import { LOOK_HANDLERS } from './assistantLook';
import { LAYER_HANDLERS } from './assistantLayers';
import { PICTURE_HANDLERS } from './assistantPictures';

/**
 * This window's side of AI assistants (see main/mcp): it carries out the tool calls main sends it,
 * on its own picture, and answers each one with what it did or why it couldn't.
 */

const HANDLERS: Record<string, Handler> = { ...LOOK_HANDLERS, ...PICTURE_HANDLERS, ...LAYER_HANDLERS };

/** "Ask each time": the user says whether the assistant may go ahead (in Pigmento's own dialog). */
function askUser(call: AssistantCall): Promise<AssistantResult> {
  if (useUi.getState().dialog) return Promise.reject(new Error('The user is busy with a dialog in Pigmento. Try again in a moment.'));
  return new Promise((resolve, reject) => {
    openDialog({
      kind: 'assistantAsk',
      client: call.client,
      title: call.title,
      what: call.ask ?? '',
      resolve: (allowed) => (allowed ? resolve({ text: 'Allowed.' }) : reject(new Error('The user didn’t allow it.'))),
    });
  });
}

/** Carry out one call: answer an ask, look, or make a change (watched, then one undo step). */
async function carryOut(call: AssistantCall): Promise<AssistantResult> {
  if (call.tool === ASSISTANT_ASK) return askUser(call);
  const h = HANDLERS[call.tool];
  if (!h) throw new Error(`This Pigmento window doesn’t know the tool ${call.tool}.`);
  const r = await h(call.args, call);
  if (!isChange(r)) return r;
  // Anything the user had going (a shape being drawn, a selection being moved) is finished first.
  engine.commitLive();
  return carryOutChange(engine.history, r, useUi.getState().settings.assistants.pace);
}

/** Carry out assistants' calls in this window until the returned function stops it. */
export function startAssistants(): () => void {
  const api = window.pigmento.assistant;
  return api.onCall((call) => {
    void (async () => {
      let reply: AssistantReply;
      try {
        reply = { ok: true, result: await carryOut(call) };
      } catch (err) {
        reply = { ok: false, error: errorText(err) };
      }
      api.reply(call.id, reply);
    })();
  });
}
