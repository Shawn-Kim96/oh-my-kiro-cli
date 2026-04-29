import { listTeams, readTeamConfig } from '../team/state.js';

export async function latestTeamName(): Promise<string | null> {
  const teams = await listTeams();
  let latest: { name: string; createdAt: number } | null = null;

  for (const name of teams) {
    const config = await readTeamConfig(name);
    const createdAt = config ? new Date(config.created_at).getTime() : 0;
    if (!latest || createdAt > latest.createdAt) {
      latest = { name, createdAt };
    }
  }

  return latest?.name ?? null;
}
