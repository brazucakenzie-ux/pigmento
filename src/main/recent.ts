import { app, type JumpListCategory, type JumpListItem } from 'electron';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { z } from 'zod';
import type { RecentFile } from '@shared/ipc';
import { atomicWrite, grantPath, readJsonFile } from './files';
import { tm } from './i18n';

const MAX_RECENT = 12;
const RecentSchema = z.array(
  z.object({ path: z.string(), name: z.string(), openedAt: z.number() }),
);

let list: RecentFile[] = [];
const listeners = new Set<(l: RecentFile[]) => void>();

function recentFile(): string {
  return path.join(app.getPath('userData'), 'recent.json');
}

export async function loadRecent(): Promise<RecentFile[]> {
  const raw = await readJsonFile(recentFile());
  const parsed = RecentSchema.safeParse(raw ?? []);
  list = parsed.success ? parsed.data.slice(0, MAX_RECENT) : [];
  for (const r of list) grantPath(r.path);
  updateJumpList();
  return list;
}

export function getRecent(): RecentFile[] {
  return list;
}

export function onRecentChanged(fn: (l: RecentFile[]) => void): void {
  listeners.add(fn);
}

async function persist(): Promise<void> {
  await atomicWrite(recentFile(), JSON.stringify(list, null, 2));
  updateJumpList();
  for (const fn of listeners) fn(list);
}

export async function addRecent(filePath: string): Promise<void> {
  const key = filePath.toLowerCase();
  list = [
    { path: filePath, name: path.basename(filePath), openedAt: Date.now() },
    ...list.filter((r) => r.path.toLowerCase() !== key),
  ].slice(0, MAX_RECENT);
  grantPath(filePath);
  await persist();
}

export async function removeRecent(filePath: string): Promise<void> {
  const key = filePath.toLowerCase();
  list = list.filter((r) => r.path.toLowerCase() !== key);
  await persist();
}

export async function clearRecent(): Promise<void> {
  list = [];
  await persist();
}

/** Drop entries whose files no longer exist (called on startup). */
export async function pruneRecent(): Promise<void> {
  const checks = await Promise.all(
    list.map((r) =>
      fs
        .stat(r.path)
        .then((s) => s.isFile())
        .catch(() => false),
    ),
  );
  const next = list.filter((_, i) => checks[i]);
  if (next.length !== list.length) {
    list = next;
    await persist();
  }
}

/** Arguments that make a jump-list task open `file` in this app (dev needs the app path). */
function launchArgs(extra: string): string {
  const prefix = app.isPackaged ? '' : `"${app.getAppPath()}" `;
  return `${prefix}${extra}`;
}

function updateJumpList(): void {
  if (process.platform !== 'win32') return;
  try {
    const removed = new Set(
      (app.getJumpListSettings().removedItems ?? []).map((i) => (i.args ?? '').toLowerCase()),
    );
    const items: JumpListItem[] = list
      .map(
        (r): JumpListItem => ({
          type: 'task',
          title: r.name,
          description: r.path,
          program: process.execPath,
          args: launchArgs(`"${r.path}"`),
          iconPath: process.execPath,
          iconIndex: 0,
        }),
      )
      .filter((i) => !removed.has((i.args ?? '').toLowerCase()));
    const categories: JumpListCategory[] = [];
    if (items.length > 0) categories.push({ type: 'custom', name: tm('jump.recent'), items });
    categories.push({
      type: 'tasks',
      items: [
        {
          type: 'task',
          title: tm('jump.new'),
          description: tm('jump.newDesc'),
          program: process.execPath,
          args: launchArgs('--new-window'),
          iconPath: process.execPath,
          iconIndex: 0,
        },
      ],
    });
    const result = app.setJumpList(categories);
    if (result !== 'ok') console.warn('Jump list update returned', result);
    // Lets end-to-end tests confirm Windows accepted the jump list.
    if (process.env.PIGMENTO_E2E === '1') {
      (globalThis as unknown as Record<string, unknown>).__pigmentoJumpList = { result, items: items.length };
    }
  } catch (err) {
    console.warn('Jump list update failed', err);
  }
}
