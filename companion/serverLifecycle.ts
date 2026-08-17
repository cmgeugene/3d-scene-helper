import type { CompanionServerOptions, CompanionServerHandle } from './server';
import { startCompanionServer } from './server';

export interface StartedCompanionServer {
  server: CompanionServerHandle;
  requestedPort: number;
  usedFallbackPort: boolean;
}

type StartServer = (
  options: CompanionServerOptions,
) => Promise<CompanionServerHandle>;

export async function startCompanionServerWithPortFallback(
  options: CompanionServerOptions & { fallbackOnPortConflict?: boolean },
  startServer: StartServer = startCompanionServer,
): Promise<StartedCompanionServer> {
  const requestedPort = options.port ?? 0;
  try {
    return {
      server: await startServer(options),
      requestedPort,
      usedFallbackPort: false,
    };
  } catch (error) {
    if (
      requestedPort === 0 ||
      options.fallbackOnPortConflict === false ||
      (error as NodeJS.ErrnoException).code !== 'EADDRINUSE'
    ) {
      throw error;
    }
    return {
      server: await startServer({ ...options, port: 0 }),
      requestedPort,
      usedFallbackPort: true,
    };
  }
}
