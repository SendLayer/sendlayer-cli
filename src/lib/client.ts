import { SendLayer } from 'sendlayer';

let cachedClient: { key: string; client: SendLayer } | null = null;

export function getClient(apiKey: string): SendLayer {
  if (cachedClient && cachedClient.key === apiKey) {
    return cachedClient.client;
  }
  const client = new SendLayer(apiKey);
  cachedClient = { key: apiKey, client };
  return client;
}
