import Image from 'next/image';
import Link from 'next/link';
import {
  ArrowRight, CalendarCheck, Check, ChevronDown, Clock, FileText, Mail, Moon, PhoneForwarded, PhoneIncoming,
  Settings2, Sun, TriangleAlert, Users, Wrench, type LucideIcon
} from 'lucide-react';
import { Logo } from '@/components/Logo';
import { DashboardTour } from '@/components/landing/DashboardTour';
import { BRAND_NAME, DEMO_LOGIN } from '@/lib/brand';

const DEMO_HREF = DEMO_LOGIN ? '/login?demo' : '/login';
const wrap = 'mx-auto w-full max-w-6xl px-4 sm:px-6';

const MOMENTS: { time: string; icon: LucideIcon; text: string }[] = [
  { time: '7:55 AM', icon: Sun, text: 'Two customers at the counter, one on hold, and line two starts ringing.' },
  { time: '1:30 PM', icon: Wrench, text: 'Everyone’s on a lift. The phone rings out while someone’s halfway through a brake job.' },
  { time: '6:40 PM', icon: Moon, text: 'You’ve locked up. Somebody’s check engine light just came on and they want it looked at tomorrow.' }
];

// An example call to the demo shop. Notes explain what the receptionist is doing.
const CALL: { who: 'agent' | 'caller'; text: string; note?: string }[] = [
  { who: 'agent', text: 'Thanks for calling Riverside Auto Care. I’m the shop’s AI assistant, and this call is recorded. How can I help you today?', note: 'First thing it says: it’s an AI, and the call is recorded. No pretending to be Mike from the front desk.' },
  { who: 'caller', text: 'Hey, my brakes started grinding on the way to work. It’s a 2019 Civic.' },
  { who: 'agent', text: 'That’s worth getting in soon. Can I get your name?', note: 'Name, car, what’s wrong. The same three things your service writer would ask.' },
  { who: 'caller', text: 'Maria Lopez.' },
  { who: 'agent', text: 'Thanks, Maria. I can do tomorrow at 10 AM or 1 PM, or Thursday at 8. Any of those work?', note: 'Those times come from your real schedule: opening hours, free bays, job length and days off.' },
  { who: 'caller', text: 'Ten tomorrow. Roughly what’s that going to cost me?' },
  { who: 'agent', text: 'The shop gives you an estimate once they’ve had a look. So that’s Maria Lopez, 2019 Honda Civic, grinding when braking, tomorrow at 10. Shall I book it?', note: 'No prices, no guesses. It reads everything back and waits for a yes.' },
  { who: 'caller', text: 'Yes please.' },
  { who: 'agent', text: 'You’re all set for tomorrow at 10 AM. See you then, Maria.', note: 'The booking shows up on your dashboard with this transcript attached.' }
];

const FEATURES: { icon: LucideIcon; title: string; text: string }[] = [
  { icon: CalendarCheck, title: 'Books only what you can fit', text: 'It works from your opening hours, how many bays you run, how long a job slot is and the days you’re closed. Two callers can’t both grab your last 10 AM slot.' },
  { icon: FileText, title: 'Every call, written down', text: 'A full transcript and a one-line summary for each call: who rang, what they drive and what’s wrong. Thirty seconds to read instead of three minutes of voicemail.' },
  { icon: PhoneForwarded, title: 'One short call-back list', text: 'Couldn’t find a time, wanted a person, or the line dropped? They land on one list with their number, so nobody gets forgotten.' },
  { icon: Mail, title: 'Confirmations and reminders', text: 'Customers who want one get an email confirmation and a reminder before the visit. Your team gets an email whenever someone needs a call back.' },
  { icon: TriangleAlert, title: 'Knows where its job ends', text: 'It won’t diagnose and it won’t quote. If a car sounds unsafe to drive, it tells the caller to leave it parked and offers the earliest slot.' },
  { icon: Users, title: 'A login for everyone', text: 'Owners set hours, bays and holidays. Service advisors get their own login for the bookings and the call-back list, without touching the settings.' }
];

const STEPS = [
  { icon: Settings2, title: 'Tell it about your shop', text: 'Opening hours for each day, number of bays, how long a typical job slot is, holidays, and who should get the alerts.' },
  { icon: PhoneIncoming, title: 'Send it your calls', text: 'Forward calls when you’re busy, after hours, or all day long. Customers keep dialing the number they already have.' },
  { icon: Check, title: 'Work the list', text: 'Check the new bookings over coffee, ring back the few people it couldn’t book, and get on with your day.' }
];

const FAQ = [
  { q: 'Will callers know they’re talking to an AI?', a: 'Yes. The first thing it says is that it’s the shop’s AI assistant and that the call is recorded. Some states, California among them, need everyone on a call to agree to recording, so this part isn’t optional.' },
  { q: 'What if it books something wrong?', a: 'It can only offer times your schedule says are free, and it reads the name, car, problem and time back before it books. Every call has a transcript, so you can see exactly what was said.' },
  { q: 'Does it give prices or diagnose problems?', a: 'No. It tells callers the shop gives an estimate after looking at the car. Pricing and diagnosis stay with the people who actually know.' },
  { q: 'What if someone just wants a person?', a: 'If you’ve added a transfer number, it puts them through. If not, it takes their name and number and they go straight onto the call-back list.' },
  { q: 'Can I close for a holiday or change my hours?', a: 'Yes, in Settings. Add closed days ahead of time and it won’t offer them. Changes apply from the very next call.' },
  { q: 'Is Wrenchline a real product?', a: 'It’s a working build. The voice agent, the booking engine and the dashboard in the demo all run on the same code. The shop, callers and calls you’ll see in the demo are sample data.' }
];

function PrimaryCta({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <Link href={DEMO_HREF} className={`inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-brand-600 px-6 text-[15px] font-semibold text-white shadow-lg shadow-brand-600/25 transition-colors duration-150 hover:bg-brand-700 ${className}`}>
      {children} <ArrowRight aria-hidden className="h-4 w-4" />
    </Link>
  );
}

function SectionHeading({ eyebrow, title, text, light = false }: { eyebrow: string; title: string; text?: string; light?: boolean }) {
  return (
    <div className="mx-auto max-w-2xl text-center">
      <p className={`text-sm font-semibold uppercase tracking-wider ${light ? 'text-brand-300' : 'text-brand-600'}`}>{eyebrow}</p>
      <h2 className={`mt-3 text-3xl font-bold tracking-tight text-balance sm:text-4xl ${light ? 'text-white' : 'text-ink'}`}>{title}</h2>
      {text && <p className={`mt-4 text-lg text-pretty ${light ? 'text-slate-300' : 'text-ink-muted'}`}>{text}</p>}
    </div>
  );
}

export default function LandingPage() {
  return (
    <div className="bg-white">
      <a href="#main" className="sr-only z-50 rounded-lg bg-white px-4 py-2 focus:not-sr-only focus:fixed focus:left-4 focus:top-4">Skip to content</a>

      <header className="sticky top-0 z-40 border-b border-line/80 bg-white/85 backdrop-blur">
        <div className={`${wrap} flex h-16 items-center justify-between gap-4`}>
          <Link href="/" aria-label={`${BRAND_NAME} home`} className="rounded-xl"><Logo /></Link>
          <nav aria-label="Main" className="hidden items-center gap-8 text-sm font-medium text-ink-muted md:flex">
            <a href="#how-it-works" className="transition-colors hover:text-ink">How a call goes</a>
            <a href="#features" className="transition-colors hover:text-ink">What it does</a>
            <a href="#dashboard" className="transition-colors hover:text-ink">Dashboard</a>
            <a href="#faq" className="transition-colors hover:text-ink">FAQ</a>
          </nav>
          <div className="flex items-center gap-2">
            <Link href="/dashboard" className="hidden h-10 items-center rounded-xl px-4 text-sm font-semibold text-ink-muted transition-colors hover:bg-slate-100 hover:text-ink sm:inline-flex">Sign in</Link>
            <Link href={DEMO_HREF} className="inline-flex h-10 items-center rounded-xl bg-ink px-4 text-sm font-semibold text-white transition-colors hover:bg-slate-700">Try the demo</Link>
          </div>
        </div>
      </header>

      <main id="main">
        {/* Hero */}
        <section className="relative overflow-hidden bg-canvas">
          <div aria-hidden className="pointer-events-none absolute inset-0 [background-image:linear-gradient(#e2e8f0_1px,transparent_1px),linear-gradient(90deg,#e2e8f0_1px,transparent_1px)] [background-size:56px_56px] [mask-image:radial-gradient(ellipse_at_top,black_30%,transparent_75%)]" />
          <div aria-hidden className="pointer-events-none absolute -top-40 left-1/2 h-[480px] w-[720px] -translate-x-1/2 rounded-full bg-brand-200/50 blur-3xl" />

          <div className={`${wrap} relative pb-20 pt-16 sm:pt-24`}>
            <div className="mx-auto max-w-3xl text-center">
              <p className="inline-flex items-center gap-2 rounded-full bg-white px-4 py-1.5 text-sm font-medium text-ink-muted shadow-sm ring-1 ring-line">
                <Wrench aria-hidden className="h-4 w-4 text-brand-600" /> For independent auto repair shops
              </p>
              <h1 className="mt-6 text-4xl font-bold tracking-tight text-balance text-ink sm:text-5xl lg:text-6xl">
                The phone rings. You’re under a car. <span className="text-brand-600">{BRAND_NAME} picks up.</span>
              </h1>
              <p className="mx-auto mt-6 max-w-2xl text-lg text-pretty text-ink-muted sm:text-xl">
                An AI receptionist that answers the calls you can’t get to, asks about the car, and books the job into a slot you actually have open. Anyone it can’t book goes on a short call-back list, not into voicemail.
              </p>
              <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
                <PrimaryCta className="w-full sm:w-auto">Try the live demo</PrimaryCta>
                <a href="#how-it-works" className="inline-flex h-12 w-full items-center justify-center rounded-xl bg-white px-6 text-[15px] font-semibold text-ink ring-1 ring-line transition-colors hover:ring-slate-300 sm:w-auto">Hear how a call goes</a>
              </div>
              <ul className="mt-8 flex flex-wrap justify-center gap-x-6 gap-y-2 text-sm text-ink-muted">
                {['Answers nights and weekends', 'Books around your bays and hours', 'Never quotes a price'].map((t) => (
                  <li key={t} className="flex items-center gap-1.5"><Check aria-hidden className="h-4 w-4 text-emerald-600" />{t}</li>
                ))}
              </ul>
            </div>

            <div className="relative mx-auto mt-16 max-w-5xl">
              {/* Phones get the mobile dashboard; the desktop one is unreadable at that size */}
              <div className="mx-auto h-[440px] w-[240px] overflow-hidden rounded-[2.25rem] border-[7px] border-slate-900 bg-white shadow-2xl shadow-slate-900/20 sm:hidden">
                <Image src="/landing/overview-mobile.webp" alt="The Wrenchline dashboard on a phone: appointments today and callers to ring back" width={780} height={1688} sizes="226px" className="w-full" />
              </div>
              <div className="hidden overflow-hidden rounded-2xl border border-line bg-white shadow-2xl shadow-slate-900/15 sm:block">
                <div aria-hidden className="flex items-center gap-1.5 border-b border-line bg-slate-50 px-4 py-3">
                  <span className="h-2.5 w-2.5 rounded-full bg-slate-300" />
                  <span className="h-2.5 w-2.5 rounded-full bg-slate-300" />
                  <span className="h-2.5 w-2.5 rounded-full bg-slate-300" />
                </div>
                <Image src="/landing/overview.webp" alt="The Wrenchline dashboard for a sample shop: appointments today, callers to ring back, and calls per day" width={1600} height={1000} priority sizes="(min-width: 1024px) 1024px, 100vw" className="h-auto w-full" />
              </div>

              {/* Example of a call the AI booked after hours (illustrative) */}
              <figure aria-label="Example: a call booked after the shop closed" className="relative mx-auto -mt-10 w-[min(100%,340px)] rounded-2xl border border-line bg-white p-5 shadow-xl shadow-slate-900/10 sm:absolute sm:-bottom-8 sm:left-6 sm:mt-0 lg:-left-10">
                <div className="flex items-center justify-between text-xs font-medium text-ink-muted">
                  <span className="flex items-center gap-1.5"><Clock aria-hidden className="h-3.5 w-3.5" /> 7:42 PM · after close</span>
                  <span className="rounded-full bg-emerald-50 px-2 py-0.5 font-semibold text-emerald-700 ring-1 ring-emerald-200">Booked</span>
                </div>
                <p className="mt-3 font-semibold text-ink">Maria Lopez · 2019 Honda Civic</p>
                <p className="text-sm text-ink-muted">“My brakes started grinding on the way to work.”</p>
                <p className="mt-3 flex items-center gap-2 rounded-xl bg-brand-50 px-3 py-2 text-sm font-semibold text-brand-700">
                  <CalendarCheck aria-hidden className="h-4 w-4" /> Booked for tomorrow, 10:00 AM
                </p>
              </figure>
            </div>
          </div>
        </section>

        {/* The problem */}
        <section className="bg-slate-900 py-20 sm:py-28">
          <div className={wrap}>
            <SectionHeading light eyebrow="Why it exists" title="Most missed calls never turn into voicemails." text="People hang up and call the next shop on the map. Nobody at your shop did anything wrong. The phone just rings at the worst possible times." />
            <ul className="mt-14 grid gap-4 md:grid-cols-3">
              {MOMENTS.map(({ time, icon: Icon, text }) => (
                <li key={time} className="rounded-2xl border border-white/10 bg-white/5 p-6">
                  <p className="flex items-center gap-2 font-semibold text-white"><Icon aria-hidden className="h-5 w-5 text-brand-300" /> {time}</p>
                  <p className="mt-3 text-slate-300">{text}</p>
                </li>
              ))}
            </ul>
            <p className="mx-auto mt-12 max-w-2xl text-center text-lg text-slate-200">{BRAND_NAME} takes those calls, so the job ends up on your schedule and not someone else’s.</p>
          </div>
        </section>

        {/* Example call */}
        <section id="how-it-works" className="scroll-mt-16 py-20 sm:py-28">
          <div className={wrap}>
            <SectionHeading eyebrow="How a call goes" title="Here’s what your customers hear." text="An example call to our demo shop, with notes on what’s going on behind each answer." />
            <ol className="mx-auto mt-14 max-w-4xl space-y-4">
              {CALL.map((line, i) => (
                <li key={i} className="grid gap-2 md:grid-cols-[minmax(0,1fr)_260px] md:gap-8">
                  <div className={`flex ${line.who === 'caller' ? 'justify-end' : ''}`}>
                    <div className={`max-w-[88%] rounded-2xl px-4 py-3 ${line.who === 'agent' ? 'rounded-tl-md bg-slate-100 text-ink' : 'rounded-tr-md bg-brand-600 text-white'}`}>
                      <p className={`text-xs font-semibold ${line.who === 'agent' ? 'text-ink-muted' : 'text-brand-100'}`}>{line.who === 'agent' ? 'Wrenchline' : 'Caller'}</p>
                      <p className="mt-0.5">{line.text}</p>
                    </div>
                  </div>
                  {line.note ? (
                    <p className="flex gap-2 self-center border-l-2 border-brand-200 pl-3 text-sm text-ink-muted md:border-l-0 md:pl-0">
                      <span aria-hidden className="mt-1.5 hidden h-1.5 w-1.5 shrink-0 rounded-full bg-brand-500 md:block" />
                      <span><span className="sr-only">Note: </span>{line.note}</span>
                    </p>
                  ) : <span aria-hidden className="hidden md:block" />}
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* Features */}
        <section id="features" className="scroll-mt-16 bg-canvas py-20 sm:py-28">
          <div className={wrap}>
            <SectionHeading eyebrow="What it does" title="A receptionist that sticks to what it knows." text="It handles the calls that take up your morning, and knows when to hand one back to you." />
            <ul className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {FEATURES.map(({ icon: Icon, title, text }) => (
                <li key={title} className="rounded-2xl border border-line bg-white p-6 shadow-sm">
                  <span aria-hidden className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-50 text-brand-600"><Icon className="h-5 w-5" /></span>
                  <h3 className="mt-5 text-lg font-semibold text-ink">{title}</h3>
                  <p className="mt-2 text-ink-muted">{text}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* Dashboard tour */}
        <section id="dashboard" className="scroll-mt-16 py-20 sm:py-28">
          <div className={wrap}>
            <SectionHeading eyebrow="The dashboard" title="Everything from the phone, on one screen." text="This is the real dashboard with sample data in it. Flip through it here, or open the demo and click around." />
            <div className="mx-auto mt-12 max-w-5xl"><DashboardTour /></div>
          </div>
        </section>

        {/* Getting started */}
        <section className="border-y border-line bg-canvas py-20 sm:py-28">
          <div className={wrap}>
            <SectionHeading eyebrow="Getting started" title="Three steps, no new phone number for customers." />
            <ol className="mt-14 grid gap-4 md:grid-cols-3">
              {STEPS.map(({ icon: Icon, title, text }, i) => (
                <li key={title} className="rounded-2xl border border-line bg-white p-6">
                  <div className="flex items-center justify-between">
                    <span aria-hidden className="flex h-11 w-11 items-center justify-center rounded-xl bg-ink text-white"><Icon className="h-5 w-5" /></span>
                    <span className="text-sm font-semibold text-slate-400">Step {i + 1}</span>
                  </div>
                  <h3 className="mt-5 text-lg font-semibold text-ink">{title}</h3>
                  <p className="mt-2 text-ink-muted">{text}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* FAQ */}
        <section id="faq" className="scroll-mt-16 py-20 sm:py-28">
          <div className={`${wrap} max-w-3xl`}>
            <SectionHeading eyebrow="Questions" title="The things shop owners ask first." />
            <div className="mt-12 divide-y divide-line rounded-2xl border border-line">
              {FAQ.map(({ q, a }) => (
                <details key={q} className="group px-6 py-5 [&_summary::-webkit-details-marker]:hidden">
                  <summary className="flex items-center justify-between gap-4 rounded-md font-semibold text-ink">
                    {q}
                    <ChevronDown aria-hidden className="h-5 w-5 shrink-0 text-slate-400 transition-transform duration-200 group-open:rotate-180" />
                  </summary>
                  <p className="mt-3 text-ink-muted">{a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        {/* Final call to action */}
        <section className="px-4 pb-20 sm:px-6 sm:pb-28">
          <div className="relative mx-auto max-w-6xl overflow-hidden rounded-3xl bg-gradient-to-br from-brand-600 to-brand-900 px-6 py-16 text-center sm:px-12">
            <div aria-hidden className="pointer-events-none absolute inset-0 opacity-[0.08] [background-image:linear-gradient(white_1px,transparent_1px),linear-gradient(90deg,white_1px,transparent_1px)] [background-size:44px_44px]" />
            <div className="relative mx-auto max-w-2xl">
              <h2 className="text-3xl font-bold tracking-tight text-balance text-white sm:text-4xl">Have a look around the demo shop.</h2>
              <p className="mt-4 text-lg text-pretty text-brand-100">Riverside Auto Care is made up, but the dashboard is the real one: two weeks of calls, bookings and call backs. No sign-up needed.</p>
              <Link href={DEMO_HREF} className="mt-8 inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-white px-6 text-[15px] font-semibold text-brand-700 shadow-lg transition-colors hover:bg-brand-50">
                Open the live demo <ArrowRight aria-hidden className="h-4 w-4" />
              </Link>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-line bg-canvas">
        <div className={`${wrap} flex flex-col gap-6 py-10 sm:flex-row sm:items-center sm:justify-between`}>
          <Logo subtitle="AI receptionist for auto repair shops" />
          <nav aria-label="Footer" className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-ink-muted">
            <a href="#how-it-works" className="hover:text-ink">How a call goes</a>
            <a href="#features" className="hover:text-ink">What it does</a>
            <a href="#faq" className="hover:text-ink">FAQ</a>
            <Link href="/dashboard" className="hover:text-ink">Sign in</Link>
          </nav>
        </div>
        <p className={`${wrap} pb-10 text-xs text-slate-500`}>© {new Date().getFullYear()} {BRAND_NAME}. Riverside Auto Care and everyone in the demo are fictional.</p>
      </footer>
    </div>
  );
}
