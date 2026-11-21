// SMS through Twilio's REST API (Node's built-in fetch; no SDK needed for one endpoint).
// Off unless ENABLE_SMS=true: US business texting needs A2P 10DLC registration (brand and
// campaign approval, which takes weeks) before carriers deliver it, so email stays the required channel.
const TWILIO_API = 'https://api.twilio.com/2010-04-01';
const TIMEOUT_MS = 15000;

const smsEnabled = () => process.env.ENABLE_SMS === 'true';

/**
 * Sends one SMS. Returns Twilio's message SID.
 * Throws an Error with .status (HTTP status) so the outbox can tell permanent from temporary failures.
 */
async function sendSms({ to, body }) {
  if (!smsEnabled()) throw Object.assign(new Error('SMS is disabled (ENABLE_SMS is not true)'), { permanent: true });

  const sid = process.env.TWILIO_ACCOUNT_SID;
  const params = new URLSearchParams({ To: to, Body: body });
  // A Messaging Service (needed for alphanumeric sender IDs in some countries) wins over a plain number
  if (process.env.TWILIO_MESSAGING_SERVICE_SID) params.set('MessagingServiceSid', process.env.TWILIO_MESSAGING_SERVICE_SID);
  else params.set('From', process.env.TWILIO_PHONE_NUMBER);

  const response = await fetch(`${TWILIO_API}/Accounts/${encodeURIComponent(sid)}/Messages.json`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${sid}:${process.env.TWILIO_AUTH_TOKEN}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: params,
    signal: AbortSignal.timeout(TIMEOUT_MS)
  });

  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw Object.assign(new Error(`Twilio ${response.status}: ${result.message || response.statusText}`), {
      status: response.status
    });
  }
  return result.sid || null;
}

module.exports = { sendSms, smsEnabled };
