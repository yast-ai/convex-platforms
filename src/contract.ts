export const platformNames = ['api', 'mcp', 'cli', 'sdk-typescript', 'sdk-python'] as const;
export type Platform = (typeof platformNames)[number];
export type Platforms = boolean | Partial<Record<Platform, boolean>>;
export type JsonSchema = Record<string, unknown>;
export type Identity = { orgId: string; userId: string; role: string };
export type Operation = {
  name: string;
  resource: string[];
  action: string;
  tool: string;
  path: string;
  function: string;
  type: 'query' | 'mutation' | 'action';
  platforms: Platform[];
  description: string;
  inputSchema: JsonSchema;
  outputSchema: JsonSchema;
  ui?: string;
};
export type Widget = {
  text: string;
  csp?: {
    connectDomains?: string[];
    resourceDomains?: string[];
    frameDomains?: string[];
    baseUriDomains?: string[];
  };
};
export type Manifest = {
  version: 1;
  name: string;
  operations: Operation[];
  widgets: Record<string, Widget>;
  openapi: Record<string, unknown>;
};
