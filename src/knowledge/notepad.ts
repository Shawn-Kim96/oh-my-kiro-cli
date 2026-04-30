import { existsSync } from 'fs';
import { mkdir, readFile, writeFile } from 'fs/promises';
import { dirname } from 'path';
import { kchNotepadPath } from '../utils/paths.js';

export type NotepadSection = 'priority' | 'working' | 'manual';

const SECTION_TITLES: Record<NotepadSection, string> = {
  priority: 'Priority Context',
  working: 'Working Memory',
  manual: 'Manual Notes',
};

const SECTION_ORDER: NotepadSection[] = ['priority', 'working', 'manual'];

function emptyNotepad(): Record<NotepadSection, string[]> {
  return { priority: [], working: [], manual: [] };
}

function sectionHeader(section: NotepadSection): string {
  return `## ${SECTION_TITLES[section]}`;
}

export async function readNotepad(): Promise<Record<NotepadSection, string[]>> {
  const path = kchNotepadPath();
  if (!existsSync(path)) return emptyNotepad();

  const result = emptyNotepad();
  const content = await readFile(path, 'utf-8');
  let current: NotepadSection | null = null;
  for (const line of content.split(/\r?\n/)) {
    const matched = SECTION_ORDER.find(section => line.trim() === sectionHeader(section));
    if (matched) {
      current = matched;
      continue;
    }
    if (current && line.trim() && line.trim() !== '_empty_') result[current].push(line);
  }
  return result;
}

export async function writeNotepadSection(section: NotepadSection, content: string, options?: { replace?: boolean }): Promise<void> {
  const state = await readNotepad();
  const line = section === 'working' ? `- ${new Date().toISOString()} ${content}` : content;
  state[section] = options?.replace ? [line] : [...state[section], line];

  const rendered = [
    '# kch notepad',
    '',
    ...SECTION_ORDER.flatMap((s) => [
      sectionHeader(s),
      '',
      ...(state[s].length ? state[s] : ['_empty_']),
      '',
    ]),
  ].join('\n');

  const path = kchNotepadPath();
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, rendered, 'utf-8');
}

export async function clearNotepad(): Promise<void> {
  const path = kchNotepadPath();
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, '# kch notepad\n\n', 'utf-8');
}

export function assertNotepadSection(value: string): NotepadSection {
  if (SECTION_ORDER.includes(value as NotepadSection)) return value as NotepadSection;
  throw new Error(`Invalid notepad section: ${value}. Expected ${SECTION_ORDER.join(', ')}`);
}
