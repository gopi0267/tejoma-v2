import express from 'express';

export const clients: express.Response[] = [];

export function broadcastEvent(event: string, data: any) {
  const payload = `event: ${event}
data: ${JSON.stringify(data)}

`;
  clients.forEach(client => {
    try {
      client.write(payload);
    } catch (e) {
      console.error('Failed to send SSE payload', e);
    }
  });
}
