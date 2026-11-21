// LiveKit voice agent: answers a shop's phone line (LiveKit SIP) or a browser test call.
// Speech: Deepgram (Nova-3 in, Aura-2 out). Thinking: Groq (Llama 3.3 70B). Voice activity: Silero.
// Everything the receptionist knows and may do comes from the server's /api/voice for each call.
import 'dotenv/config';
import { fileURLToPath } from 'node:url';
import { cli, defineAgent, llm, ServerOptions, voice } from '@livekit/agents';
import * as deepgram from '@livekit/agents-plugin-deepgram';
import * as openai from '@livekit/agents-plugin-openai';
import * as silero from '@livekit/agents-plugin-silero';
import { createVoiceApi } from './api.js';
import { buildEndReport, buildTools, callNumbers, createCallTracker, transcriptFrom } from './tools.js';

const api = () => createVoiceApi({ baseUrl: process.env.SERVER_URL, key: process.env.VOICE_AGENT_KEY });

export default defineAgent({
  // Loaded once per process, so each call starts without a model download
  prewarm: async (proc) => {
    proc.userData.vad = await silero.VAD.load();
  },

  entry: async (ctx) => {
    const voiceApi = api();
    await ctx.connect();
    const participant = await ctx.waitForParticipant();
    const numbers = callNumbers(participant, ctx.room.name);
    const startedAt = new Date();

    const session = new voice.AgentSession({
      vad: ctx.proc.userData.vad,
      stt: new deepgram.STT({ model: 'nova-3', language: 'en-US' }),
      llm: openai.LLM.withGroq({ model: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile', temperature: 0.3 }),
      // Opt out of Deepgram's model-improvement program: these are customers' calls
      tts: new deepgram.TTS({ model: process.env.DEEPGRAM_VOICE || 'aura-2-thalia-en', mipOptOut: process.env.DEEPGRAM_MIP_OPT_OUT !== 'false' })
    });

    let start;
    try {
      start = await voiceApi.startCall(numbers);
    } catch (error) {
      // Without the server the agent knows nothing about the shop: don't improvise
      console.error('Could not start call:', error.message);
      await session.start({ agent: new voice.Agent({ instructions: 'Apologise briefly.' }), room: ctx.room });
      await session.say("Sorry, we're having technical trouble right now. Please call back in a few minutes.").waitForPlayout();
      return ctx.shutdown('server unavailable');
    }

    if (start.action !== 'answer') {
      const message = start.action === 'transfer'
        ? `Please call the shop directly at ${start.transfer_to.split('').join(' ')}.` // read digit by digit
        : "Sorry, this number isn't set up yet.";
      await session.start({ agent: new voice.Agent({ instructions: 'Say only what you are told to say.' }), room: ctx.room });
      await session.say(message).waitForPlayout();
      return ctx.shutdown(start.action);
    }

    const tracker = createCallTracker();
    const agent = new voice.Agent({
      instructions: start.agent.instructions,
      tools: buildTools(start.agent.tools, { api: voiceApi, callId: start.call_id, tool: llm.tool, tracker })
    });

    // The end-of-call report goes out however the call ends (caller hung up, error, shutdown)
    let reported = false;
    const report = async (endedReason) => {
      if (reported) return;
      reported = true;
      try {
        await voiceApi.end(start.call_id, buildEndReport({
          tracker,
          transcript: transcriptFrom(session.history?.items),
          startedAt,
          endedAt: new Date(),
          endedReason
        }));
      } catch (error) {
        console.error('Could not send end-of-call report:', error.message);
      }
    };
    session.on(voice.AgentSessionEventTypes.Close, (event) => report(String(event.reason || 'closed')));
    ctx.addShutdownCallback(() => report('shutdown'));

    await session.start({ agent, room: ctx.room });
    await voiceApi.answered(start.call_id).catch((error) => console.error('Could not mark call answered:', error.message));
    await session.say(start.agent.greeting);
  }
});

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  cli.runApp(new ServerOptions({ agent: fileURLToPath(import.meta.url) }));
}
