import { getWorkOSAuthProviders } from '@disposabl/convex-platforms/oauth';

export default {
  providers: getWorkOSAuthProviders({
    clientId: process.env.WORKOS_CLIENT_ID ?? '',
    authkitUrl: process.env.WORKOS_AUTHKIT_URL,
    siteUrl: process.env.CONVEX_SITE_URL ?? '',
  }),
};
