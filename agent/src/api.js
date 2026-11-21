// Client for the server's provider-neutral voice API (/api/voice). The agent holds no business
// logic: shops, slots, bookings and alerts all live in the server.

// A caller is waiting in silence while a request runs, so nothing may hang
const TIMEOUT_MS = 8000;

export class VoiceApiError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'VoiceApiError';
    this.status = status;
  }
}

/**
 * @param options { baseUrl, key, fetchImpl = fetch, timeoutMs }
 */
export function createVoiceApi({ baseUrl, key, fetchImpl = fetch, timeoutMs = TIMEOUT_MS }) {
  if (!baseUrl || !key) throw new Error('SERVER_URL and VOICE_AGENT_KEY are required');
  const root = baseUrl.replace(/\/+$/, '');

  async function post(path, body = {}) {
    let response;
    try {
      response = await fetchImpl(`${root}/api/voice${path}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs)
      });
    } catch (error) {
      throw new VoiceApiError(`Voice API unreachable (${path}): ${error.message}`, 0);
    }
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new VoiceApiError(`Voice API ${response.status} (${path}): ${data.error || response.statusText}`, response.status);
    return data;
  }

  return {
    startCall: ({ providerCallId, toNumber, fromNumber }) =>
      post('/calls', { provider_call_id: providerCallId, to_number: toNumber, from_number: fromNumber }),
    answered: (callId) => post(`/calls/${callId}/answered`),
    availability: (callId, args) => post(`/calls/${callId}/availability`, args),
    book: (callId, args) => post(`/calls/${callId}/bookings`, args),
    end: (callId, report) => post(`/calls/${callId}/end`, report)
  };
}
