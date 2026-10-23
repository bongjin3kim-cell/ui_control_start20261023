import http from 'node:http';
import { randomBytes } from 'node:crypto';

export const snapshot = () => ({ schemaVersion: 1, capturedAt: '2026-10-23T02:00:00.000Z', route: '#lab', heading: 'UI 실습', inputValuesIncluded: false,
  summary: { totalRequests: 8, completedScenarios: 0 }, form: [], table: { rows: [], page: '1 / 2', range: '전체 8건 중 1-4', statusFilter: 'all', sort: 'none' },
  modal: { open: false, title: '' }, async: { state: 'idle', result: '응답 대기 중' }, errors: [], recentEvents: ['session.ready'] });
export const testEnv = () => ({ OPENAI_API_KEY: 'test-provider-' + randomBytes(24).toString('hex'), OPENAI_MODEL: 'test-model',
  APP_ACCESS_PASSWORD: randomBytes(24).toString('base64url'), APP_SESSION_SECRET: randomBytes(32).toString('base64url'), APP_ORIGIN: 'https://lab.example' });
export function eventResponse(events, { bytewise = false, crlf = false } = {}) {
  const text = events.map(e => `data: ${JSON.stringify(e)}\n\n`).join('').replaceAll('\n', crlf ? '\r\n' : '\n');
  const bytes = new TextEncoder().encode(text);
  return new Response(new ReadableStream({ start(controller) { if (bytewise) for (const b of bytes) controller.enqueue(Uint8Array.of(b)); else controller.enqueue(bytes); controller.close(); } }), { headers: { 'Content-Type': 'text/event-stream' } });
}
export const completedResponse = (answer = '현재 전체 요청은 8개입니다.') => eventResponse([{ type: 'response.output_text.delta', delta: answer }, { type: 'response.completed', response: { status: 'completed' } }]);
export async function serve(handler) {
  const server = http.createServer(handler); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  return { origin, close: () => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }) };
}
