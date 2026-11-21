// Agent logic without LiveKit or real keys: API client, tool wiring, end-of-call outcome.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createVoiceApi, VoiceApiError } from '../src/api.js';
import { buildEndReport, buildTools, callNumbers, createCallTracker, transcriptFrom } from '../src/tools.js';

const quiet = { warn() {}, error() {} };
const fakeTool = (spec) => spec; // stands in for LiveKit's llm.tool

const TOOL_DEFS = [
  { name: 'check_availability', description: 'Find times', parameters: { type: 'object', properties: {} } },
  { name: 'book_appointment', description: 'Book', parameters: { type: 'object', properties: {} } }
];

function fakeApi(overrides = {}) {
  const calls = [];
  const record = (name, result) => async (...args) => {
    calls.push([name, ...args]);
    if (result instanceof Error) throw result;
    return result;
  };
  return {
    calls,
    availability: record('availability', overrides.availability ?? { slots: [] }),
    book: record('book', overrides.book ?? { booked: true, booking_id: 'b1' })
  };
}

test('API client sends the voice key and the right path, and reports HTTP errors', async () => {
  const requests = [];
  const fetchImpl = async (url, init) => {
    requests.push({ url, init });
    return new Response(JSON.stringify(url.endsWith('/calls') ? { action: 'answer', call_id: 'c1' } : { error: 'Call not found' }), {
      status: url.endsWith('/calls') ? 200 : 404
    });
  };
  const api = createVoiceApi({ baseUrl: 'https://shop.example.com/', key: 'k'.repeat(32), fetchImpl });

  const started = await api.startCall({ providerCallId: 'room-1', toNumber: '+15551112222', fromNumber: '+15559998888' });
  assert.equal(started.call_id, 'c1');
  assert.equal(requests[0].url, 'https://shop.example.com/api/voice/calls');
  assert.equal(requests[0].init.headers.Authorization, `Bearer ${'k'.repeat(32)}`);
  assert.deepEqual(JSON.parse(requests[0].init.body), { provider_call_id: 'room-1', to_number: '+15551112222', from_number: '+15559998888' });

  await assert.rejects(api.answered('c1'), (e) => e instanceof VoiceApiError && e.status === 404 && /Call not found/.test(e.message));
});

test('API client turns a network failure into a VoiceApiError instead of hanging', async () => {
  const api = createVoiceApi({ baseUrl: 'https://x', key: 'k', fetchImpl: async () => { throw new Error('ECONNREFUSED'); } });
  await assert.rejects(api.availability('c1', {}), (e) => e instanceof VoiceApiError && e.status === 0 && /unreachable/.test(e.message));
});

test('API client refuses to start without its settings', () => {
  assert.throws(() => createVoiceApi({ baseUrl: '', key: 'k' }), /SERVER_URL and VOICE_AGENT_KEY are required/);
});

test('every tool the server defines is wired to its endpoint; unknown tools are skipped', async () => {
  const api = fakeApi();
  const tracker = createCallTracker();
  const tools = buildTools([...TOOL_DEFS, { name: 'delete_everything', description: 'x' }], { api, callId: 'c1', tool: fakeTool, tracker, logger: quiet });
  assert.deepEqual(Object.keys(tools), ['check_availability', 'book_appointment']);

  await tools.check_availability.execute({ preferred_date: '2030-01-15' });
  await tools.book_appointment.execute({ start: 'x', customer_name: 'Jane' });
  assert.deepEqual(api.calls, [
    ['availability', 'c1', { preferred_date: '2030-01-15' }],
    ['book', 'c1', { start: 'x', customer_name: 'Jane' }]
  ]);
  assert.equal(tools.book_appointment.parameters, TOOL_DEFS[1].parameters); // schema passed through unchanged
});

test('a booked call needs no call back', async () => {
  const tracker = createCallTracker();
  const tools = buildTools(TOOL_DEFS, { api: fakeApi(), callId: 'c1', tool: fakeTool, tracker, logger: quiet });
  await tools.check_availability.execute({});
  await tools.book_appointment.execute({ customer_name: 'Jane', issue_summary: 'Brakes' });
  const report = buildEndReport({ tracker });
  assert.equal(report.outcome.booking_requested, false);
  assert.equal(report.outcome.callback_requested, false);
});

test('a caller who looked for times but did not book is flagged for a call back, with their details', async () => {
  const tracker = createCallTracker();
  const api = fakeApi({ book: { booked: false, code: 'SLOT_FULL', alternatives: [] } });
  const tools = buildTools(TOOL_DEFS, { api, callId: 'c1', tool: fakeTool, tracker, logger: quiet });
  await tools.check_availability.execute({});
  await tools.book_appointment.execute({ customer_name: 'Jane', customer_phone: '555-999-8888', issue_summary: 'Brakes' });
  const { outcome } = buildEndReport({ tracker });
  assert.deepEqual(
    { booking_requested: outcome.booking_requested, name: outcome.customer_name, phone: outcome.customer_phone, issue: outcome.issue_summary },
    { booking_requested: true, name: 'Jane', phone: '555-999-8888', issue: 'Brakes' }
  );
});

test('a caller who never asked about appointments is not flagged', () => {
  assert.equal(buildEndReport({ tracker: createCallTracker() }).outcome.booking_requested, false);
});

test('when the server fails mid-call, the model is told not to invent an answer and the call is flagged', async () => {
  const tracker = createCallTracker();
  const api = fakeApi({ availability: new Error('timeout') });
  const tools = buildTools(TOOL_DEFS, { api, callId: 'c1', tool: fakeTool, tracker, logger: quiet });
  const result = await tools.check_availability.execute({});
  assert.match(result.error, /shop will call them back/);
  assert.equal(buildEndReport({ tracker }).outcome.callback_requested, true);
});

test('the transcript keeps the conversation and drops system and tool items', () => {
  const items = [
    { type: 'message', role: 'system', textContent: 'secret instructions' },
    { type: 'message', role: 'assistant', textContent: 'Thanks for calling.' },
    { type: 'message', role: 'user', textContent: 'My brakes squeal.' },
    { type: 'function_call', name: 'check_availability' },
    { type: 'message', role: 'assistant', textContent: '' }
  ];
  assert.equal(transcriptFrom(items), 'Agent: Thanks for calling.\nCaller: My brakes squeal.');
});

test('phone calls take their numbers from LiveKit SIP; browser test calls use the DEMO settings', () => {
  const phone = callNumbers(
    { attributes: { 'sip.callID': 'SCL_1', 'sip.trunkPhoneNumber': '+15551112222', 'sip.phoneNumber': '+15559998888' } },
    'room-1',
    {}
  );
  assert.deepEqual(phone, { isPhone: true, providerCallId: 'SCL_1', toNumber: '+15551112222', fromNumber: '+15559998888' });

  const browser = callNumbers({ attributes: {} }, 'room-2', { DEMO_SHOP_NUMBER: '+15551112222', DEMO_CALLER_NUMBER: '+15550001111' });
  assert.deepEqual(browser, { isPhone: false, providerCallId: 'room-2', toNumber: '+15551112222', fromNumber: '+15550001111' });
});
