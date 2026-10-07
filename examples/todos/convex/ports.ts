import { createPlatformServer } from '@disposabl/convex-platforms/server';
import manifest from '../platforms/generated/manifest.json';

export const platforms = createPlatformServer({
  manifest,
  workos: {
    clientId: process.env.WORKOS_CLIENT_ID ?? '',
    apiKey: process.env.WORKOS_API_KEY ?? '',
    authkitUrl: process.env.WORKOS_AUTHKIT_URL ?? '',
    siteUrl: process.env.CONVEX_SITE_URL ?? '',
  },
});
