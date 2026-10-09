import { Link } from 'react-router-dom';
import { ArrowRight, Lock, Shield } from 'lucide-react';
import { LinkButton } from '../../components/ui/Button';

const HOW_IT_WORKS = [
  {
    step: '01',
    title: 'A person asks for help',
    body: 'They describe their situation and attach supporting documents. Until they submit, it is a private draft only they can see.',
  },
  {
    step: '02',
    title: 'Staff verify it',
    body: 'A staff member checks the documents and details in the console. Every decision is written to an audit log against their own account.',
  },
  {
    step: '03',
    title: 'It is published',
    body: 'Only once verified does the request appear on the public list, where anyone can see it and choose to help.',
  },
  {
    step: '04',
    title: 'Helpers step in',
    body: 'The request moves to active, and the person who asked can follow exactly where it has got to.',
  },
];

export default function About() {
  return (
    <div className="bg-canvas">
      {/* 1. Header / Introduction */}
      <header className="border-b border-line bg-canvas py-12 sm:py-18">
        <div className="container-page max-w-4xl">
          <p className="text-xs font-semibold uppercase tracking-wider text-primary">
            About Walk With Us
          </p>
          <h1 className="mt-3 font-serif text-3xl font-bold tracking-tight text-ink sm:text-4xl lg:text-5xl leading-tight">
            Walk With Us connects people who need help with people who can give it.
          </h1>
          <p className="mt-5 text-base sm:text-lg leading-relaxed text-ink-muted max-w-2xl">
            We run a small, careful process. A request is never published on trust alone — it is checked first, and every action taken on it is recorded.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <LinkButton to="/help" size="lg" className="min-h-[44px]">
              See Live Requests
            </LinkButton>
            <LinkButton to="/request-help" variant="secondary" size="lg" className="min-h-[44px]">
              Ask for Help
            </LinkButton>
          </div>
        </div>
      </header>

      {/* 2. Why Walk With Us Exists */}
      <section className="container-page max-w-4xl py-12 sm:py-16">
        <div className="max-w-2xl">
          <h2 className="font-serif text-2xl font-bold tracking-tight text-ink sm:text-3xl">
            Why Walk With Us exists
          </h2>
          <div className="mt-4 space-y-4 text-sm sm:text-base leading-relaxed text-ink-muted">
            <p>
              When an urgent medical crisis, education fee deadline, or basic living need occurs, navigating formal bureaucracy or impersonal crowdfunding platforms can be overwhelming. People in distress need a direct, dignified way to ask for assistance.
            </p>
            <p>
              At the same time, community members want to give support but need confidence that requests are genuine and that funds reach real individuals rather than opaque intermediaries. Walk With Us exists to bridge that gap with direct verification, complete privacy, and straightforward accountability.
            </p>
          </div>
        </div>
      </section>

      {/* 3. How the Organization Works */}
      <section className="border-t border-line py-12 sm:py-16">
        <div className="container-page max-w-4xl">
          <div className="max-w-2xl">
            <p className="text-xs font-semibold uppercase tracking-wider text-primary">
              Structured Review Process
            </p>
            <h2 className="mt-2 font-serif text-2xl font-bold tracking-tight text-ink sm:text-3xl">
              How the platform operates
            </h2>
            <p className="mt-2 text-sm sm:text-base text-ink-muted">
              From the initial draft to community support, every step follows a structured, accountable lifecycle.
            </p>
          </div>

          <div className="mt-10 divide-y divide-line border-y border-line">
            {HOW_IT_WORKS.map((step) => (
              <div
                key={step.title}
                className="grid gap-3 py-6 sm:grid-cols-12 sm:gap-6 sm:py-7"
              >
                <div className="sm:col-span-2">
                  <span className="font-mono text-xs font-bold text-ink-subtle">
                    {step.step}
                  </span>
                </div>
                <div className="sm:col-span-4">
                  <h3 className="text-base font-bold text-ink">
                    {step.title}
                  </h3>
                </div>
                <div className="sm:col-span-6">
                  <p className="text-sm leading-relaxed text-ink-muted">
                    {step.body}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 4. Privacy & Data Handling Commitments */}
      <section className="border-t border-line py-12 sm:py-16 bg-surface/30">
        <div className="container-page max-w-4xl">
          <div className="max-w-2xl">
            <p className="text-xs font-semibold uppercase tracking-wider text-primary">
              Privacy & Access
            </p>
            <h2 className="mt-2 font-serif text-2xl font-bold tracking-tight text-ink sm:text-3xl">
              How we handle your information
            </h2>
            <p className="mt-2 text-sm sm:text-base text-ink-muted">
              Two commitments describe almost everything we do with your data.
            </p>
          </div>

          <div className="mt-10 grid gap-8 sm:grid-cols-2">
            <div className="space-y-3">
              <div className="flex items-center gap-2 font-bold text-ink">
                <Lock className="h-4 w-4 text-primary shrink-0" aria-hidden="true" />
                <h3 className="text-base font-bold text-ink">
                  Your documents stay private
                </h3>
              </div>
              <p className="text-sm leading-relaxed text-ink-muted">
                Supporting documents you upload go to a private storage bucket. They are never publicly addressable, and they are only ever reachable through short-lived, signed links issued after the database confirms the viewer is allowed to see them.
              </p>
            </div>

            <div className="space-y-3">
              <div className="flex items-center gap-2 font-bold text-ink">
                <Shield className="h-4 w-4 text-primary shrink-0" aria-hidden="true" />
                <h3 className="text-base font-bold text-ink">
                  Only staff can see a request before publication
                </h3>
              </div>
              <p className="text-sm leading-relaxed text-ink-muted">
                Access rules are enforced in the database itself, not in the browser. Someone cannot reach a draft, a rejected request, or a verification note by changing what the page requests — the request is simply refused.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* 5. Closing / Next Steps */}
      <section className="border-t border-line py-12 sm:py-16">
        <div className="container-page max-w-4xl">
          <div className="border-y border-line py-8 sm:py-10">
            <div className="max-w-2xl">
              <h2 className="font-serif text-xl font-bold tracking-tight text-ink sm:text-2xl">
                Get involved with Walk With Us
              </h2>
              <p className="mt-2 text-sm leading-relaxed text-ink-muted">
                There are multiple ways to support, and none of them require you to already know us.
              </p>
            </div>

            <div className="mt-6 flex flex-wrap items-center gap-3">
              <LinkButton to="/help" size="sm" className="min-h-[44px]">
                Browse Help
              </LinkButton>
              <LinkButton to="/request-help" variant="secondary" size="sm" className="min-h-[44px]">
                Request Help
              </LinkButton>
              <LinkButton to="/volunteer" variant="secondary" size="sm" className="min-h-[44px]">
                Volunteer
              </LinkButton>
              <LinkButton to="/partner" variant="secondary" size="sm" className="min-h-[44px]">
                Partner
              </LinkButton>
              <LinkButton to="/donate" variant="ghost" size="sm" className="min-h-[44px]">
                Donate
              </LinkButton>
            </div>

            <div className="mt-8 border-t border-line pt-6">
              <p className="text-xs text-ink-muted sm:text-sm">
                Already know someone who needs help?{' '}
                <Link
                  to="/request-help"
                  className="font-semibold text-primary hover:underline inline-flex items-center gap-1 min-h-[44px] py-1"
                >
                  <span>Start a request for them</span>
                  <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                </Link>
              </p>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
