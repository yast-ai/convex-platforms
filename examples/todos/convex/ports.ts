import { createPlatformServer } from '@disposabl/convex-platforms/server';
import type { Manifest } from '@disposabl/convex-platforms';
import manifest from '../platforms/generated/manifest.json';

export const platforms = createPlatformServer({
  manifest: manifest as Manifest,
  workos: {
    clientId: process.env.WORKOS_CLIENT_ID ?? '',
    apiKey: process.env.WORKOS_API_KEY ?? '',
    authkitUrl: process.env.WORKOS_AUTHKIT_URL ?? '',
    siteUrl: process.env.CONVEX_SITE_URL ?? '',
  },
});
