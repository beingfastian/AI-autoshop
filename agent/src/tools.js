// Turns the tool definitions the server sends for a call into tools the LLM can call, and keeps
// track of what happened so the end-of-call report can say whether the caller got a booking.
//
// The `tool` factory is passed in (LiveKit's llm.tool in production) so this logic can be tested
// without LiveKit.

// Which /api/voice method each tool name maps to
const HANDLERS = {
  check_availability: (api, callId, args) => api.availability(callId, args),
  book_appointment: (api, callId, args) => api.book(callId, args)
};

// What the model hears when the server can't be reached: it must not invent an answer
const UNAVAILABLE = {
  error: 'The booking system is not responding right now. Apologise, take their name and number, and tell them the shop will call them back.'
};

export function createCallTracker() {
  return {
    checkedAvailability: false,
    booked: false,
    lastBookingArgs: null,
    systemErrors: 0
  };
}

/**
 * @param defs     tool definitions from POST /api/voice/calls ({ name, description, parameters })
 * @param context  { api, callId, tool, tracker, logger }
 * @returns object of tools keyed by name, for new voice.Agent({ tools })
 */
export function buildTools(defs, { api, callId, tool, tracker, logger = console }) {
  const tools = {};
  for (const def of defs || []) {
    const handler = HANDLERS[def.name];
    if (!handler) {
      logger.warn(`Server sent unknown tool "${def.name}"; skipping it`);
      continue;
    }
    tools[def.name] = tool({
      description: def.description,
      parameters: def.parameters,
      execute: async (args) => {
        if (def.name === 'check_availability') tracker.checkedAvailability = true;
        if (def.name === 'book_appointment') tracker.lastBookingArgs = args;
        try {
          const result = await handler(api, callId, args || {});
          if (def.name === 'book_appointment' && result.booked) tracker.booked = true;
          return result;
        } catch (error) {
          tracker.systemErrors++;
          logger.error(`Tool ${def.name} failed:`, error.message);
          return UNAVAILABLE;
        }
      }
    });
  }
  return tools;
}

/**
 * The end-of-call report for POST /calls/:id/end.
 * @param input { tracker, transcript, startedAt, endedAt, endedReason }
 */
export function buildEndReport({ tracker, transcript, startedAt, endedAt, endedReason }) {
  const args = tracker.lastBookingArgs || {};
  // Wanted an appointment (looked for times or tried to book) but left without one,
  // or the booking system failed during the call: the shop must call them back
  const bookingRequested = (tracker.checkedAvailability || Boolean(tracker.lastBookingArgs)) && !tracker.booked;
  return {
    ended_reason: endedReason || null,
    started_at: startedAt ? startedAt.toISOString() : null,
    ended_at: endedAt ? endedAt.toISOString() : null,
    transcript: transcript || null,
    outcome: {
      booking_requested: bookingRequested,
      callback_requested: tracker.systemErrors > 0 && !tracker.booked,
      customer_name: args.customer_name || null,
      customer_phone: args.customer_phone || null,
      vehicle_make: args.vehicle_make || null,
      vehicle_model: args.vehicle_model || null,
      issue_summary: args.issue_summary || null
    }
  };
}

/** "Caller: ... / Agent: ..." lines from the session's chat history items. */
export function transcriptFrom(items) {
  return (items || [])
    .filter((item) => item.type === 'message' && (item.role === 'user' || item.role === 'assistant'))
    .map((item) => `${item.role === 'user' ? 'Caller' : 'Agent'}: ${item.textContent ?? ''}`.trim())
    .filter((line) => !/:\s*$/.test(line))
    .join('\n');
}

/**
 * The numbers for this call. Phone calls (LiveKit SIP) carry them as participant attributes;
 * browser test calls have none, so DEMO_* settings stand in for them.
 */
export function callNumbers(participant, roomName, env = process.env) {
  const attrs = participant?.attributes || {};
  const isPhone = Boolean(attrs['sip.trunkPhoneNumber'] || attrs['sip.phoneNumber']);
  return {
    isPhone,
    providerCallId: attrs['sip.callID'] || roomName,
    toNumber: attrs['sip.trunkPhoneNumber'] || env.DEMO_SHOP_NUMBER || null,
    fromNumber: attrs['sip.phoneNumber'] || env.DEMO_CALLER_NUMBER || null
  };
}
