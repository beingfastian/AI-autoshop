// What the voice agent says and may do on a call, built per call from the shop's settings.
// The agent (LiveKit today) fetches this when a call starts, so prompt changes ship with the
// code and are tested here, and switching voice providers doesn't touch the receptionist logic.
//
// US requirements baked in:
// - The first sentence discloses that this is an AI and that the call is recorded (California
//   and other all-party-consent states require consent to recording).
// - "Today" is given in the shop's timezone, so "tomorrow at 9" means the shop's tomorrow.
const { DateTime } = require('luxon');
const { ISSUE_CATEGORIES, URGENCIES } = require('./bookings');

const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
const label = (day) => day[0].toUpperCase() + day.slice(1);

function formatTime(hhmm) {
  const t = DateTime.fromFormat(hhmm || '', 'HH:mm');
  return t.isValid ? t.toFormat('h:mm a') : null;
}

// "Monday-Friday 8:00 AM-6:00 PM; Saturday 9:00 AM-2:00 PM; Sunday closed"
function describeHours(businessHours) {
  const text = DAYS.map((day) => {
    const h = businessHours?.[day];
    const open = h && !h.closed && formatTime(h.open);
    const close = h && !h.closed && formatTime(h.close);
    return open && close ? `${open}-${close}` : 'closed';
  });
  const groups = [];
  DAYS.forEach((day, i) => {
    const last = groups[groups.length - 1];
    if (last && last.hours === text[i]) last.to = day;
    else groups.push({ from: day, to: day, hours: text[i] });
  });
  return groups
    .map((g) => `${label(g.from)}${g.to !== g.from ? `-${label(g.to)}` : ''} ${g.hours}`)
    .join('; ');
}

// JSON Schemas for the tools the agent can call; each maps to one /api/voice endpoint
const TOOLS = [
  {
    name: 'check_availability',
    endpoint: 'availability',
    description:
      'Find open appointment times. Always call this before offering any time to the caller. ' +
      'Pass the day and time they asked for, if any.',
    parameters: {
      type: 'object',
      properties: {
        preferred_date: { type: 'string', description: 'Requested day as YYYY-MM-DD, resolved from words like "tomorrow" using today\'s date' },
        preferred_time: { type: 'string', description: 'Requested time like "14:00" or "2pm"; omit if the caller has no preference' }
      },
      additionalProperties: false
    }
  },
  {
    name: 'book_appointment',
    endpoint: 'bookings',
    description:
      'Book one of the times returned by check_availability, after the caller agreed to it and you ' +
      'read the details back. Only tell the caller they are booked if this returns booked: true.',
    parameters: {
      type: 'object',
      properties: {
        start: { type: 'string', description: 'The exact "start" value of the chosen time from check_availability' },
        customer_name: { type: 'string' },
        customer_phone: { type: 'string', description: 'Best number to reach them; leave out to use the number they are calling from' },
        customer_email: { type: 'string', description: 'Only if they want an email confirmation; spell it back first' },
        vehicle_make: { type: 'string' },
        vehicle_model: { type: 'string' },
        vehicle_year: { type: 'integer' },
        issue_summary: { type: 'string', description: 'The problem in the caller\'s words, one or two sentences' },
        issue_category: { type: 'string', enum: ISSUE_CATEGORIES },
        urgency: { type: 'string', enum: URGENCIES, description: 'urgent if unsafe to drive (brakes, steering, overheating) or the car will not start' }
      },
      required: ['start', 'customer_name', 'issue_summary'],
      additionalProperties: false
    }
  }
];

function buildInstructions(workshop, { now, callerNumber }) {
  const local = DateTime.fromJSDate(now).setZone(workshop.timezone);
  const lines = [
    `You are the AI phone receptionist for ${workshop.name}, an auto repair shop${workshop.address ? ` at ${workshop.address}` : ''}.`,
    `Right now it is ${local.toFormat("cccc, LLLL d, yyyy 'at' h:mm a")} for the shop (${workshop.timezone}). Use this to work out dates like "tomorrow" or "next Monday".`,
    `Opening hours: ${describeHours(workshop.business_hours)}.`,
    '',
    'Your job: understand the car problem and book an appointment.',
    '- Ask for their name, the vehicle (make, model, year if they know it) and what is wrong.',
    '- Always call check_availability before offering times. Offer at most three, in plain words.',
    '- Never invent times, prices or promises. For prices say the shop gives an estimate after inspecting the car.',
    '- Before booking, read back the name, vehicle, problem and time, and get a yes.',
    '- Call book_appointment and only say they are booked if it returns booked: true. If the time was just taken, offer the alternatives it returns.',
    callerNumber
      ? `- They are calling from ${callerNumber}. Ask if that is the best number to reach them.`
      : '- Ask for the best phone number to reach them.',
    '- Email confirmation is optional; if they want it, spell the address back letter by letter.',
    '- If the car is unsafe to drive (brakes, steering, overheating, smoke), tell them not to drive it and offer the earliest time.',
    workshop.transfer_phone
      ? '- If they ask for a person, or it is an emergency you cannot handle, transfer the call.'
      : '- If they ask for a person, take their name and number and tell them the shop will call back.',
    '- If you cannot book (nothing suitable, or they are unsure), tell them the shop will call them back.',
    '- Keep answers short and natural; this is a phone call.'
  ];
  return lines.join('\n');
}

/**
 * Everything the voice agent needs for one call.
 * @param workshop workshops row
 * @param options  { now = new Date(), callerNumber }
 */
function buildAgentConfig(workshop, { now = new Date(), callerNumber = null } = {}) {
  return {
    greeting:
      `Thanks for calling ${workshop.name}. I'm the shop's AI assistant, and this call is recorded. ` +
      'How can I help you today?',
    instructions: buildInstructions(workshop, { now, callerNumber }),
    timezone: workshop.timezone,
    transfer_phone: workshop.transfer_phone || null,
    tools: TOOLS.map(({ name, description, parameters }) => ({ name, description, parameters }))
  };
}

module.exports = { buildAgentConfig, describeHours, TOOLS };
