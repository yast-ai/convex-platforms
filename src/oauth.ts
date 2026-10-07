import type { AuthConfig } from 'convex/server';

export const mcpMetadataPath = '/.well-known/oauth-protected-resource/mcp';

export type McpOAuth = {
  resource: URL;
  metadataPath: string;
  metadataUrl: string;
  authProviders: AuthConfig['providers'];
  metadata: {
    resource: string;
    authorization_servers: string[];
    bearer_methods_supported: string[];
  };
};

export type WorkOSAuthConfig = {
  clientId: string;
  authkitUrl?: string;
  siteUrl: string;
};

function httpsUrl(value: string, name: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} must be a URL`);
  }
  const loopback = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]';
  if (url.protocol !== 'https:' && !(loopback && url.protocol === 'http:'))
    throw new Error(`${name} must use HTTPS except for a loopback development URL`);
  return url;
}

/** Build the native Convex JWT provider and OAuth discovery document for one MCP resource. */
export function createMcpOAuth(authkitUrl: string, siteUrl: string): McpOAuth {
  const issuer = httpsUrl(authkitUrl, 'workos.authkitUrl');
  if (issuer.pathname !== '/' || issuer.search || issuer.hash)
    throw new Error('workos.authkitUrl must be an origin without a path, query, or hash');
  const site = httpsUrl(siteUrl, 'workos.siteUrl');
  const resource = new URL('/mcp', site);
  const metadataUrl = new URL(mcpMetadataPath, resource).href;
  return {
    resource,
    metadataPath: mcpMetadataPath,
    metadataUrl,
    // Convex performs signature, expiry, issuer, and exact audience verification.
    authProviders: [
      {
        type: 'customJwt',
        issuer: issuer.origin,
        jwks: `${issuer.origin}/oauth2/jwks`,
        algorithm: 'RS256',
        applicationID: resource.href,
      },
    ],
    metadata: {
      resource: resource.href,
      authorization_servers: [issuer.origin],
      bearer_methods_supported: ['header'],
    },
  };
}

/**
 * Auth providers for a consuming app's `convex/auth.config.ts`.
 * The first two providers accept normal WorkOS web and device sessions. When
 * configured, the final provider accepts only Connect access tokens for the
 * exact `/mcp` resource.
 */
export function getWorkOSAuthProviders(config: WorkOSAuthConfig): AuthConfig['providers'] {
  if (!config.clientId) throw new Error('workos.clientId is required');
  const providers: AuthConfig['providers'] = [
    {
      type: 'customJwt',
      issuer: 'https://api.workos.com/',
      algorithm: 'RS256',
      jwks: `https://api.workos.com/sso/jwks/${config.clientId}`,
      applicationID: config.clientId,
    },
    {
      type: 'customJwt',
      issuer: `https://api.workos.com/user_management/${config.clientId}`,
      algorithm: 'RS256',
      jwks: `https://api.workos.com/sso/jwks/${config.clientId}`,
    },
  ];
  if (config.authkitUrl)
    providers.unshift(...createMcpOAuth(config.authkitUrl, config.siteUrl).authProviders);
  return providers;
}
