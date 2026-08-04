import { spawn, type ChildProcess } from 'node:child_process';

export interface BrowserOpenCommand {
  command: string;
  args: string[];
}

export function browserOpenCommand(
  url: string,
  platform: NodeJS.Platform = process.platform,
): BrowserOpenCommand {
  const parsed = new URL(url).toString();
  if (platform === 'darwin') return { command: 'open', args: [parsed] };
  if (platform === 'win32') {
    return { command: 'cmd', args: ['/c', 'start', '', parsed] };
  }
  return { command: 'xdg-open', args: [parsed] };
}

type SpawnBrowser = (
  command: string,
  args: readonly string[],
  options: { detached: boolean; stdio: 'ignore'; windowsHide: boolean },
) => ChildProcess;

export async function openBrowser(
  url: string,
  spawnBrowser: SpawnBrowser = spawn,
  platform: NodeJS.Platform = process.platform,
) {
  const invocation = browserOpenCommand(url, platform);
  const child = spawnBrowser(invocation.command, invocation.args, {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  });
  await new Promise<void>((resolve, reject) => {
    child.once('spawn', resolve);
    child.once('error', reject);
  });
  child.unref();
}
