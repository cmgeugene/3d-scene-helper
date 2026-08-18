import { mkdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const COMPANION_DEV_SESSION_RELATIVE_PATH =
  '.i2v/companion-session.json';

export interface CompanionDevSession {
  url: string;
  token: string;
}

export function companionDevSessionPath(repoRoot: string) {
  return path.join(path.resolve(repoRoot), COMPANION_DEV_SESSION_RELATIVE_PATH);
}

export async function writeCompanionDevSession(
  repoRoot: string,
  session: CompanionDevSession,
) {
  const sessionPath = companionDevSessionPath(repoRoot);
  await mkdir(path.dirname(sessionPath), { recursive: true });
  await writeFile(
    sessionPath,
    `${JSON.stringify(
      {
        version: 1,
        url: session.url,
        token: session.token,
      },
      null,
      2,
    )}\n`,
    { encoding: 'utf8', mode: 0o600 },
  );
}

export async function clearCompanionDevSession(repoRoot: string) {
  try {
    await unlink(companionDevSessionPath(repoRoot));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}
