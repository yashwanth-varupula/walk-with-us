import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight,
  CheckCircle2,
  Mail,
  MapPin,
} from 'lucide-react';
import {
  buildFallbackMailto,
  submitVolunteerApplication,
  type VolunteerApplication,
} from '../../services/applications';
import { getPublicHelpRequestsPage, type PublicHelpRequest } from '../../services/helpRequests';
import Button, { LinkButton } from '../../components/ui/Button';
import { CONTACT_EMAIL } from '../../lib/siteConfig';

const AVAILABILITY = [
  'Weekday mornings',
  'Weekday afternoons',
  'Weekday evenings',
  'Weekends',
  'Flexible',
];

const BLANK: VolunteerApplication = {
  fullName: '',
  email: '',
  phone: '',
  city: '',
  availability: AVAILABILITY[0],
  skills: '',
  message: '',
};

const WAYS_TO_HELP = [
  {
    title: 'Transport Support',
    body: 'Drive someone to a clinic, hospital appointment, pharmacy, or government office for vital medical visits.',
  },
  {
    title: 'Language & Form Navigation',
    body: 'Assist community members in understanding official letters, welfare schemes, or completing application documentation.',
  },
  {
    title: 'Companionship & Check-ins',
    body: 'Regular phone check-ins or home visits to provide reassurance to elderly or isolated community members.',
  },
  {
    title: 'Verification & Community Review',
    body: 'Assist our team in checking documentation accuracy, clarifying details, and supporting field outreach.',
  },
];

export default function Volunteer() {
  const [form, setForm] = useState<VolunteerApplication>(BLANK);
  const [failure, setFailure] = useState<{ reason: string; message: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [submitted, setSubmitted] = useState<string | null>(null);
  const [requests, setRequests] = useState<PublicHelpRequest[]>([]);

  const set = <K extends keyof VolunteerApplication>(key: K, value: VolunteerApplication[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const schemaMissing = failure?.reason === 'schema_missing';

  useEffect(() => {
    let active = true;
    void (async () => {
      const page = await getPublicHelpRequestsPage({ limit: 4 });
      if (!active) return;
      setRequests(page.rows);
    })();
    return () => {
      active = false;
    };
  }, []);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    setFailure(null);
    setBusy(true);

    const result = await submitVolunteerApplication(form);
    setBusy(false);

    if (result.ok) {
      setSubmitted(result.reference);
      setForm(BLANK);
    } else {
      setFailure({ reason: result.reason, message: result.message });
    }
  };

  const fallbackHref = buildFallbackMailto(
    'volunteer',
    {
      fullName: form.fullName,
      email: form.email,
      phone: form.phone,
      city: form.city,
      availability: form.availability,
      skills: form.skills,
      message: form.message,
    },
    CONTACT_EMAIL,
  );

  return (
    <div className="min-h-screen bg-canvas py-8 sm:py-12">
      <div className="container-page max-w-3xl space-y-12 sm:space-y-16">
        {/* 1. Page Header */}
        <header className="space-y-3 border-b border-line pb-8">
          <p className="text-xs font-semibold uppercase tracking-wider text-ink-subtle">
            Community Volunteering
          </p>
          <h1 className="text-2xl font-bold tracking-tight text-ink sm:text-3xl lg:text-4xl">
            Volunteer with Walk With Us
          </h1>
          <p className="text-base text-ink-muted leading-relaxed sm:text-lg max-w-2xl">
            You do not need formal certifications or extensive commitments. Most volunteer support involves practical, direct assistance—such as driving someone to a medical appointment, translating documentation, or providing check-ins for neighbors in crisis.
          </p>
          <div className="flex flex-wrap items-center gap-3 pt-2">
            <a
              href="#volunteer-form"
              className="inline-flex items-center justify-center rounded-control bg-primary px-5 py-2.5 text-sm font-medium text-white shadow-xs hover:bg-primary-strong transition-colors focus-visible:outline-2 focus-visible:outline-primary min-h-[44px]"
            >
              Submit an Enquiry
            </a>
            <LinkButton to="/help" variant="secondary" size="md" className="min-h-[44px]">
              Browse Current Needs
            </LinkButton>
          </div>
        </header>

        {/* 2. Ways to Help (Editorial List) */}
        <section aria-labelledby="ways-heading" className="space-y-6">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-ink-subtle">
              Contribution Areas
            </p>
            <h2 id="ways-heading" className="mt-1 text-xl font-bold text-ink sm:text-2xl">
              How volunteers support the community
            </h2>
            <p className="mt-1 text-sm text-ink-muted">
              These are the practical areas where neighbors and individuals assist most often.
            </p>
          </div>

          <div className="grid gap-6 sm:grid-cols-2 border-t border-line pt-6">
            {WAYS_TO_HELP.map((way) => (
              <div key={way.title} className="space-y-1.5">
                <h3 className="text-base font-semibold text-ink">{way.title}</h3>
                <p className="text-sm leading-relaxed text-ink-muted">
                  {way.body}
                </p>
              </div>
            ))}
          </div>
        </section>

        {/* 3. Real Help Requests Context */}
        {requests.length > 0 && (
          <section aria-labelledby="requests-heading" className="border-t border-line pt-8 space-y-5">
            <div className="flex flex-wrap items-baseline justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-ink-subtle">
                  Live Community Needs
                </p>
                <h2 id="requests-heading" className="mt-1 text-lg font-bold text-ink sm:text-xl">
                  Recent verified requests in need of support
                </h2>
              </div>
              <Link
                to="/help"
                className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline min-h-[36px]"
              >
                <span>Browse directory</span>
                <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
              </Link>
            </div>

            <ul className="divide-y divide-line border-t border-b border-line" aria-label="Sample active requests">
              {requests.map((r) => (
                <li key={r.id} className="py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <Link
                    to={`/help/${r.id}`}
                    className="text-sm font-semibold text-ink hover:text-primary transition-colors focus-visible:outline-2 focus-visible:outline-primary truncate"
                  >
                    {r.title}
                  </Link>
                  <span className="flex items-center gap-1 text-xs text-ink-subtle shrink-0">
                    <MapPin className="h-3 w-3 text-slate-400" aria-hidden="true" />
                    <span>
                      {[r.locationCity, r.locationState].filter(Boolean).join(', ') || 'Community need'}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* 4. Volunteer Enquiry Form */}
        <section id="volunteer-form" aria-labelledby="form-heading" className="border-t border-line pt-8 space-y-6">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-ink-subtle">
              Enquiry Form
            </p>
            <h2 id="form-heading" className="mt-1 text-xl font-bold text-ink sm:text-2xl">
              Register your interest to volunteer
            </h2>
            <p className="mt-1 text-sm text-ink-muted">
              Tell us your location, availability, and skills. Our team will review your details and reach out when a relevant opportunity arises.
            </p>
          </div>

          {submitted ? (
            <div
              role="status"
              className="border border-line bg-surface p-6 sm:p-8 rounded-control text-center space-y-3"
            >
              <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-emerald-100 text-emerald-800">
                <CheckCircle2 className="h-5 w-5 text-emerald-700" aria-hidden="true" />
              </div>
              <h3 className="text-lg font-bold text-ink">
                Volunteer Enquiry Received
              </h3>
              <p className="mx-auto max-w-md text-sm text-ink-muted leading-relaxed">
                Thank you for offering your support. Your enquiry has been recorded with our team. We will contact you if there is an aligned community need in your area.
              </p>
              <div className="inline-flex items-center gap-1.5 text-xs text-ink-subtle pt-2">
                <span>Reference:</span>
                <code className="font-mono font-semibold text-ink">{submitted.slice(0, 8)}</code>
              </div>
              <div className="pt-4 flex flex-wrap justify-center gap-3">
                <Button variant="secondary" size="sm" onClick={() => setSubmitted(null)} className="min-h-[44px]">
                  Submit Another Enquiry
                </Button>
                <LinkButton to="/help" size="sm" className="min-h-[44px]">
                  Browse Current Requests
                </LinkButton>
              </div>
            </div>
          ) : (
            <div className="border border-line bg-surface p-6 sm:p-8 rounded-control">
              {failure && (
                <div
                  role="alert"
                  className={`mb-6 rounded-control p-4 text-xs sm:text-sm ${
                    schemaMissing
                      ? 'border border-amber-200 bg-amber-50 text-amber-900'
                      : 'border border-rose-200 bg-rose-50 text-rose-900'
                  }`}
                >
                  <p className="font-bold">
                    {schemaMissing ? 'Volunteer System Maintenance' : 'Submission Issue'}
                  </p>
                  <p className="mt-1 leading-relaxed">{failure.message}</p>
                  {schemaMissing && (
                    <div className="mt-3">
                      <p className="text-xs text-amber-800">
                        You can email us directly with your volunteer details:
                      </p>
                      <a
                        href={fallbackHref}
                        className="mt-2 inline-flex items-center gap-1.5 font-bold text-primary hover:underline text-xs min-h-[36px]"
                      >
                        <Mail className="h-3.5 w-3.5" aria-hidden="true" />
                        Send your details via email instead
                      </a>
                    </div>
                  )}
                </div>
              )}

              <form onSubmit={handleSubmit} noValidate className="space-y-5">
                {/* Name & City */}
                <div className="grid gap-5 sm:grid-cols-2">
                  <div>
                    <label htmlFor="volunteer-name" className="block text-xs font-semibold text-ink mb-1.5">
                      Full Name <span className="text-rose-600">*</span>
                    </label>
                    <input
                      id="volunteer-name"
                      type="text"
                      required
                      autoComplete="name"
                      value={form.fullName}
                      onChange={(e) => set('fullName', e.target.value)}
                      placeholder="e.g. Priya Sharma"
                      className="field-control text-sm py-2.5 min-h-[44px]"
                    />
                  </div>
                  <div>
                    <label htmlFor="volunteer-city" className="block text-xs font-semibold text-ink mb-1.5">
                      City <span className="text-rose-600">*</span>
                    </label>
                    <input
                      id="volunteer-city"
                      type="text"
                      required
                      autoComplete="address-level2"
                      value={form.city}
                      onChange={(e) => set('city', e.target.value)}
                      placeholder="e.g. Bengaluru"
                      className="field-control text-sm py-2.5 min-h-[44px]"
                    />
                  </div>
                </div>

                {/* Email & Phone */}
                <div className="grid gap-5 sm:grid-cols-2">
                  <div>
                    <label htmlFor="volunteer-email" className="block text-xs font-semibold text-ink mb-1.5">
                      Email Address <span className="text-rose-600">*</span>
                    </label>
                    <input
                      id="volunteer-email"
                      type="email"
                      required
                      autoComplete="email"
                      value={form.email}
                      onChange={(e) => set('email', e.target.value)}
                      placeholder="name@example.com"
                      className="field-control text-sm py-2.5 min-h-[44px]"
                    />
                  </div>
                  <div>
                    <label htmlFor="volunteer-phone" className="block text-xs font-semibold text-ink mb-1.5">
                      Phone Number <span className="font-normal text-ink-subtle">(Optional)</span>
                    </label>
                    <input
                      id="volunteer-phone"
                      type="tel"
                      autoComplete="tel"
                      value={form.phone}
                      onChange={(e) => set('phone', e.target.value)}
                      placeholder="+91 98765 43210"
                      className="field-control text-sm py-2.5 min-h-[44px]"
                    />
                    <p className="mt-1 text-[11px] text-ink-subtle">
                      Helpful for coordinating local and time-sensitive assistance.
                    </p>
                  </div>
                </div>

                {/* Availability */}
                <div>
                  <label htmlFor="volunteer-availability" className="block text-xs font-semibold text-ink mb-1.5">
                    General Availability <span className="text-rose-600">*</span>
                  </label>
                  <select
                    id="volunteer-availability"
                    required
                    value={form.availability}
                    onChange={(e) => set('availability', e.target.value)}
                    className="field-control text-sm py-2.5 min-h-[44px]"
                  >
                    {AVAILABILITY.map((a) => (
                      <option key={a} value={a}>
                        {a}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Skills */}
                <div>
                  <label htmlFor="volunteer-skills" className="block text-xs font-semibold text-ink mb-1.5">
                    Skills or Experience <span className="font-normal text-ink-subtle">(Optional)</span>
                  </label>
                  <input
                    id="volunteer-skills"
                    type="text"
                    maxLength={200}
                    value={form.skills}
                    onChange={(e) => set('skills', e.target.value)}
                    placeholder="e.g. Driving, Translation (Kannada, Hindi), Documentation"
                    className="field-control text-sm py-2.5 min-h-[44px]"
                  />
                </div>

                {/* Message */}
                <div>
                  <label htmlFor="volunteer-message" className="block text-xs font-semibold text-ink mb-1.5">
                    How would you like to assist? <span className="text-rose-600">*</span>
                  </label>
                  <textarea
                    id="volunteer-message"
                    required
                    rows={4}
                    maxLength={2000}
                    value={form.message}
                    onChange={(e) => set('message', e.target.value)}
                    placeholder="Briefly describe what kind of support you can offer..."
                    className="field-control text-sm py-2.5 resize-y"
                  />
                  <div className="mt-1 flex items-center justify-between text-[11px] text-ink-subtle">
                    <span>A brief summary is sufficient.</span>
                    {failure && failure.reason === 'validation' && form.message.trim().length < 10 && (
                      <span className="font-semibold text-rose-600">{failure.message}</span>
                    )}
                  </div>
                </div>

                {/* Submit Action */}
                <div className="pt-2">
                  <Button
                    type="submit"
                    size="lg"
                    block
                    loading={busy}
                    loadingLabel="Submitting enquiry…"
                    className="min-h-[48px]"
                  >
                    Submit Volunteer Enquiry
                  </Button>
                </div>

                {/* Privacy reassurance */}
                <p className="text-center text-xs text-ink-subtle leading-relaxed">
                  We use these details strictly to connect with you regarding volunteer opportunities. Your information is never sold or shared publicly.
                </p>
              </form>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
