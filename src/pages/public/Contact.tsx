import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import Button, { LinkButton } from '../../components/ui/Button';
import { CONTACT_EMAIL } from '../../lib/siteConfig';

const TOPICS = [
  'I need help with a request',
  'I want to volunteer',
  'I want to donate',
  'I want to partner with you',
  'I found a problem with this website',
  'Something else',
];

interface Draft {
  name: string;
  email: string;
  topic: string;
  message: string;
}

const BLANK: Draft = { name: '', email: '', topic: TOPICS[0], message: '' };

export default function Contact() {
  const [draft, setDraft] = useState<Draft>(BLANK);
  const [error, setError] = useState<string | null>(null);

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((prev) => ({ ...prev, [key]: value }));

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);

    if (!draft.name.trim()) {
      setError('Please tell us your name.');
      return;
    }
    if (!draft.topic) {
      setError('Please choose a topic.');
      return;
    }
    if (draft.message.trim().length < 10) {
      setError('Please write at least a sentence or two so we can help.');
      return;
    }

    const subject = `[Walk With Us] ${draft.topic}`;
    const body = [
      `Name: ${draft.name.trim()}`,
      `Email: ${draft.email.trim() || '(not provided)'}`,
      `Topic: ${draft.topic}`,
      '',
      draft.message.trim(),
    ].join('\n');

    const href = `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;

    window.location.href = href;
  };

  return (
    <div className="bg-canvas">
      {/* 1. Header / Introduction */}
      <header className="border-b border-line bg-canvas py-12 sm:py-18">
        <div className="container-page max-w-4xl">
          <p className="text-xs font-semibold uppercase tracking-wider text-primary">
            Direct Communication
          </p>
          <h1 className="mt-3 font-serif text-3xl font-bold tracking-tight text-ink sm:text-4xl lg:text-5xl leading-tight">
            Contact Walk With Us
          </h1>
          <p className="mt-4 text-base sm:text-lg leading-relaxed text-ink-muted max-w-2xl">
            We read every communication that comes in. If you are facing an urgent crisis or need help, the fastest route is to submit a request so our staff can immediately review your case.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <LinkButton to="/request-help" size="lg" className="min-h-[44px]">
              Start a Help Request
            </LinkButton>
            <LinkButton to="/help" variant="secondary" size="lg" className="min-h-[44px]">
              Browse Current Needs
            </LinkButton>
          </div>
        </div>
      </header>

      {/* 2. Main Content Grid */}
      <main className="container-page max-w-4xl py-12 sm:py-16">
        <div className="grid gap-12 lg:grid-cols-12 lg:gap-14 items-start">
          {/* Information & Channels Column (5 cols) */}
          <aside className="lg:col-span-5 space-y-8">
            {/* Primary Email Channel */}
            <div className="space-y-2">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-primary">
                Direct Email
              </h2>
              <h3 className="font-serif text-lg font-bold text-ink">
                General & Partner Enquiries
              </h3>
              <p className="text-sm leading-relaxed text-ink-muted">
                The most direct and reliable way to reach our team for questions, press enquiries, or direct contribution coordination.
              </p>
              <div className="pt-1">
                <a
                  href={`mailto:${CONTACT_EMAIL}`}
                  className="font-medium text-primary hover:underline text-sm break-all inline-block min-h-[44px] py-2"
                >
                  {CONTACT_EMAIL}
                </a>
              </div>
            </div>

            <div className="border-t border-line pt-8 space-y-2">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-primary">
                Urgent Assistance
              </h2>
              <h3 className="font-serif text-lg font-bold text-ink">
                Need Help for Yourself or a Family?
              </h3>
              <p className="text-sm leading-relaxed text-ink-muted">
                Submitting a request on our platform enters you directly into the staff verification queue, allowing donors to support your verified requirement.
              </p>
              <div className="pt-2">
                <Link
                  to="/request-help"
                  className="inline-flex items-center gap-1.5 text-sm font-semibold text-primary hover:underline min-h-[44px] py-1"
                >
                  <span>Start a help request now</span>
                  <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </Link>
              </div>
            </div>

            <div className="border-t border-line pt-8 space-y-2">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-primary">
                Coverage & Presence
              </h2>
              <h3 className="font-serif text-lg font-bold text-ink">
                Where We Work
              </h3>
              <p className="text-sm leading-relaxed text-ink-muted">
                We operate digitally across India, supporting requesters and connecting local helpers in any city. Our physical office and postal address are not published here yet.
              </p>
            </div>

            <div className="border-t border-line pt-8 space-y-2">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-primary">
                Review Cadence
              </h2>
              <h3 className="font-serif text-lg font-bold text-ink">
                Response Times
              </h3>
              <p className="text-sm leading-relaxed text-ink-muted">
                Emails are reviewed during working days. Verification requests are picked up by staff as soon as a reviewer is available in the queue.
              </p>
            </div>
          </aside>

          {/* Contact Message Form (7 cols) */}
          <section className="lg:col-span-7">
            <form
              onSubmit={handleSubmit}
              noValidate
              className="border-t lg:border-t-0 lg:border-l border-line pt-10 lg:pt-0 lg:pl-10 space-y-6"
            >
              <div>
                <h2 className="font-serif text-2xl font-bold tracking-tight text-ink sm:text-3xl">
                  Send us a message
                </h2>
                <p className="mt-2 text-sm leading-relaxed text-ink-muted">
                  This prepares a pre-addressed email in your personal mail app. No data is stored on external web servers until you hit send.
                </p>
              </div>

              {error && (
                <div
                  role="alert"
                  className="rounded-control border border-rose-200 bg-rose-50/70 p-4 text-xs sm:text-sm text-rose-900"
                >
                  <p className="font-semibold">Please check the form:</p>
                  <p className="mt-1 leading-relaxed">{error}</p>
                </div>
              )}

              <div className="space-y-5">
                {/* Name */}
                <div>
                  <label htmlFor="contact-name" className="block text-xs font-semibold uppercase tracking-wider text-ink mb-1.5">
                    Your Full Name *
                  </label>
                  <input
                    id="contact-name"
                    type="text"
                    required
                    autoComplete="name"
                    value={draft.name}
                    onChange={(e) => set('name', e.target.value)}
                    placeholder="e.g. Ramesh Kumar"
                    className="field-control text-sm py-2.5"
                  />
                </div>

                {/* Email */}
                <div>
                  <label htmlFor="contact-email" className="block text-xs font-semibold uppercase tracking-wider text-ink mb-1.5">
                    Your Email Address <span className="font-normal text-ink-subtle lowercase">(optional)</span>
                  </label>
                  <input
                    id="contact-email"
                    type="email"
                    autoComplete="email"
                    value={draft.email}
                    onChange={(e) => set('email', e.target.value)}
                    placeholder="name@example.com"
                    className="field-control text-sm py-2.5"
                  />
                  <p className="mt-1.5 text-xs text-ink-subtle">
                    Include your email if you would like a direct reply.
                  </p>
                </div>

                {/* Topic */}
                <div>
                  <label htmlFor="contact-topic" className="block text-xs font-semibold uppercase tracking-wider text-ink mb-1.5">
                    What is this about? *
                  </label>
                  <select
                    id="contact-topic"
                    required
                    value={draft.topic}
                    onChange={(e) => set('topic', e.target.value)}
                    className="field-control text-sm py-2.5"
                  >
                    {TOPICS.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Message */}
                <div>
                  <label htmlFor="contact-message" className="block text-xs font-semibold uppercase tracking-wider text-ink mb-1.5">
                    Your Message *
                  </label>
                  <textarea
                    id="contact-message"
                    required
                    rows={5}
                    maxLength={2000}
                    value={draft.message}
                    onChange={(e) => set('message', e.target.value)}
                    placeholder="Please include any details that will help us understand your question..."
                    className="field-control text-sm py-2.5 resize-y"
                  />
                  <p className="mt-1.5 text-xs text-ink-subtle">
                    Please write at least a sentence or two so we can properly assist.
                  </p>
                </div>

                {/* Submit Action */}
                <div className="pt-2">
                  <Button type="submit" size="lg" block className="min-h-[48px]">
                    Open in My Email App
                  </Button>
                </div>

                <p className="text-center text-xs text-ink-muted">
                  No payment details or sensitive files are collected through this general contact form.
                </p>
              </div>
            </form>
          </section>
        </div>
      </main>
    </div>
  );
}
