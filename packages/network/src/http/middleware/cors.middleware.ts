import { ServerResponse, IncomingMessage } from 'node:http';
import { NetworkConfig } from '../../types.js';

export function applyCorsHeaders(req: IncomingMessage, res: ServerResponse, config: NetworkConfig): boolean {
  const origin = req.headers['origin'] as string;
  const allowedOrigins = config.corsOrigins || ['*'];

  if (allowedOrigins.includes('*') || (origin && allowedOrigins.includes(origin))) {
    res.setHeader('Access-Control-Allow-Origin', origin || '*');
  }

  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
  res.setHeader('Access-Control-Max-Age', '86400');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return true; // Request handled
  }

  return false;
}
