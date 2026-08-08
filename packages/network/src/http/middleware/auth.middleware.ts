import { RouteContext, NetworkConfig } from '../../types.js';

export function authenticateRequest(ctx: RouteContext, config: NetworkConfig): boolean {
  // 1. Health check is always public
  const url = ctx.req.url || '';
  if (url.startsWith('/api/system/health') || url.startsWith('/api/webhooks/')) {
    return true;
  }

  // 2. If no apiKey is set and host is local, permit access
  if (!config.apiKey && (config.host === '127.0.0.1' || config.host === 'localhost')) {
    return true;
  }

  // 3. Check Authorization header
  const authHeader = ctx.req.headers['authorization'];
  if (!authHeader) {
    return false;
  }

  const parts = authHeader.split(' ');
  const scheme = parts[0];
  if (parts.length !== 2 || !scheme || scheme.toLowerCase() !== 'bearer') {
    return false;
  }

  const token = parts[1];
  return token === config.apiKey;
}
