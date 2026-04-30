import { existsSync } from 'fs';
import { mkdir, readFile, writeFile } from 'fs/promises';
import { dirname } from 'path';
import { kchProjectMemoryPath } from '../utils/paths.js';

export interface ProjectMemory {
  techStack?: Record<string, unknown>;
  build?: Record<string, unknown>;
  conventions?: Record<string, unknown>;
  structure?: Record<string, unknown>;
  notes: Record<string, Array<{ content: string; created_at: string }>>;
  directives: Array<{ directive: string; priority: 'normal' | 'high'; context?: string; created_at: string }>;
}

export function emptyProjectMemory(): ProjectMemory {
  return { notes: {}, directives: [] };
}

export async function readProjectMemory(): Promise<ProjectMemory> {
  const path = kchProjectMemoryPath();
  if (!existsSync(path)) return emptyProjectMemory();
  try {
    return { ...emptyProjectMemory(), ...(JSON.parse(await readFile(path, 'utf-8')) as Partial<ProjectMemory>) };
  } catch {
    return emptyProjectMemory();
  }
}

export async function writeProjectMemory(memory: ProjectMemory): Promise<void> {
  const path = kchProjectMemoryPath();
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(memory, null, 2), 'utf-8');
}

export async function mergeProjectMemory(patch: Record<string, unknown>): Promise<ProjectMemory> {
  const existing = await readProjectMemory();
  const merged = { ...existing, ...patch } as ProjectMemory;
  if (!merged.notes) merged.notes = {};
  if (!merged.directives) merged.directives = [];
  await writeProjectMemory(merged);
  return merged;
}

export async function addProjectNote(category: string, content: string): Promise<ProjectMemory> {
  const memory = await readProjectMemory();
  memory.notes[category] = memory.notes[category] ?? [];
  memory.notes[category].push({ content, created_at: new Date().toISOString() });
  await writeProjectMemory(memory);
  return memory;
}

export async function addProjectDirective(directive: string, options?: { priority?: 'normal' | 'high'; context?: string }): Promise<ProjectMemory> {
  const memory = await readProjectMemory();
  memory.directives.push({
    directive,
    priority: options?.priority ?? 'normal',
    context: options?.context,
    created_at: new Date().toISOString(),
  });
  await writeProjectMemory(memory);
  return memory;
}
