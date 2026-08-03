export interface CompanionLaunchDescriptor {
  version: 1;
  url: string;
  token: string;
}

export function createCompanionLaunchUrl(
  editorUrl: string,
  descriptor: Omit<CompanionLaunchDescriptor, 'version'>,
) {
  const url = new URL(editorUrl);
  const encoded = Buffer.from(
    JSON.stringify({
      version: 1,
      ...descriptor,
    } satisfies CompanionLaunchDescriptor),
    'utf8',
  ).toString('base64url');
  url.hash = `companion=${encoded}`;
  return url.toString();
}
