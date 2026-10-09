import { useState, type FormEvent } from 'react';
import {
  CheckCircle2,
  Mail,
} from 'lucide-react';
import {
  buildFallbackMailto,
  submitPartnerEnquiry,
  type PartnerEnquiry,
} from '../../services/applications';
import Button, { LinkButton } from '../../components/ui/Button';
import { CONTACT_EMAIL } from '../../lib/siteConfig';

const PARTNERSHIP_TYPES = [
  'Corporate partner',
  'NGO or nonprofit',
  'Community group',
  'School or university',
  'Pharmacy, clinic or hospital',
  'Local business',
  'Media or press',
];

const VALUE_PROPS = [
  {
    title: 'Verified Community Needs',
    body: 'Every request published on our platform has been reviewed and authenticated by staff. You are supporting real individuals and families whose situations have been verified.',
  },
  {
    title: 'Concrete, Transparent Requests',
    body: 'Requesters detail specifically what they need and roughly what it costs. This clarity makes it straightforward to evaluate whether your organization can assist.',
  },
  {
    title: 'Direct Community Channel',
    body: 'Assistance maps directly to an individual verified case rather than an abstract campaign, maintaining clear tracking and authentic accountability.',
  },
  {
    title: 'Practical & In-Kind Support',
    body: 'Transport, professional services, venue access, and supplies are just as valuable as funding. We will tell you honestly whether we can deploy what you offer.',
  },
];

const PLATFORM_BOUNDARIES = [
  'There is no automated partner dashboard or metrics API; reports are coordinated directly with our team.',
  'We do not display organizational logos across public pages without prior case-by-case agreement.',
  'Online financial settlement is not processed through this website; contributions are coordinated directly.',
  'We cannot guarantee placement of a specific request, or that every published request matches your organizational focus.',
];

const BLANK: PartnerEnquiry = {
  organisation: '',
  contactName: '',
  email: '',
  phone: '',
  partnershipType: PARTNERSHIP_TYPES[0],
  message: '',
};

export default function Partner() {
  const [form, setForm] = useState<PartnerEnquiry>(BLANK);
  const [failure, setFailure] = useState<{ reason: string; message: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [submitted, setSubmitted] = useState<string | null>(null);

  const set = <K extends keyof PartnerEnquiry>(key: K, value: PartnerEnquiry[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const schemaMissing = failure?.reason === 'schema_missing';

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    setFailure(null);
    setBusy(true);

    const result = await submitPartnerEnquiry(form);
    setBusy(false);

    if (result.ok) {
      setSubmitted(result.reference);
      setForm(BLANK);
    } else {
      setFailure({ reason: result.reason, message: result.message });
    }
  };

  const fallbackHref = buildFallbackMailto(
    'partner',
    {
      organisation: form.organisation,
      contactName: form.contactName,
      email: form.email,
      phone: form.phone,
      partnershipType: form.partnershipType,
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
            Organizational Partnerships
          </p>
          <h1 className="text-2xl font-bold tracking-tight text-ink sm:text-3xl lg:text-4xl">
            Partner with Walk With Us
          </h1>
          <p className="text-base text-ink-muted leading-relaxed sm:text-lg max-w-2xl">
            If your organization, clinic, school, or local business can offer professional services, medical supplies, transport, venue access, or targeted funding, we welcome collaboration. Tell us what resources you have, and we will tell you honestly whether we can deploy them effectively.
          </p>
          <div className="flex flex-wrap items-center gap-3 pt-2">
            <a
              href="#enquiry-form"
              className="inline-flex items-center justify-center rounded-control bg-primary px-5 py-2.5 text-sm font-medium text-white shadow-xs hover:bg-primary-strong transition-colors focus-visible:outline-2 focus-visible:outline-primary min-h-[44px]"
            >
              Start a Conversation
            </a>
            <LinkButton to="/about" variant="secondary" size="md" className="min-h-[44px]">
              How Verification Works
            </LinkButton>
          </div>
        </header>

        {/* 2. Collaboration Areas */}
        <section aria-labelledby="collaboration-heading" className="space-y-6">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-ink-subtle">
              Collaboration Framework
            </p>
            <h2 id="collaboration-heading" className="mt-1 text-xl font-bold text-ink sm:text-2xl">
              How we work with partner organizations
            </h2>
            <p className="mt-1 text-sm text-ink-muted">
              We focus on genuine, practical impact with complete transparency at every stage.
            </p>
          </div>

          <div className="grid gap-6 sm:grid-cols-2 border-t border-line pt-6">
            {VALUE_PROPS.map((prop) => (
              <div key={prop.title} className="space-y-1.5">
                <h3 className="text-base font-semibold text-ink">{prop.title}</h3>
                <p className="text-sm leading-relaxed text-ink-muted">
                  {prop.body}
                </p>
              </div>
            ))}
          </div>
        </section>

        {/* 3. Who Can Partner */}
        <section aria-labelledby="who-heading" className="border-t border-line pt-8 space-y-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-ink-subtle">
              Eligible Partners
            </p>
            <h2 id="who-heading" className="mt-1 text-lg font-bold text-ink sm:text-xl">
              Organizations we collaborate with
            </h2>
          </div>
          <div className="flex flex-wrap gap-2 text-xs text-ink-muted">
            {PARTNERSHIP_TYPES.map((type) => (
              <span
                key={type}
                className="rounded-control border border-line bg-surface px-3 py-1.5 font-medium"
              >
                {type}
              </span>
            ))}
          </div>
        </section>

        {/* 4. Operational Boundaries */}
        <section aria-labelledby="boundaries-heading" className="border-t border-line pt-8 space-y-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-ink-subtle">
              Transparency
            </p>
            <h2 id="boundaries-heading" className="mt-1 text-lg font-bold text-ink sm:text-xl">
              Operational boundaries
            </h2>
            <p className="mt-1 text-sm text-ink-muted">
              Being clear about our current platform boundaries ensures aligned expectations.
            </p>
          </div>

          <ul className="space-y-2.5 text-xs sm:text-sm text-ink-muted">
            {PLATFORM_BOUNDARIES.map((item) => (
              <li key={item} className="flex items-start gap-2.5">
                <span
                  aria-hidden="true"
                  className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-primary"
                />
                <span className="leading-relaxed">{item}</span>
              </li>
            ))}
          </ul>
        </section>

        {/* 5. Partnership Enquiry Form */}
        <section id="enquiry-form" aria-labelledby="form-heading" className="border-t border-line pt-8 space-y-6">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-ink-subtle">
              Enquiry Form
            </p>
            <h2 id="form-heading" className="mt-1 text-xl font-bold text-ink sm:text-2xl">
              Start a partnership conversation
            </h2>
            <p className="mt-1 text-sm text-ink-muted">
              Tell us about your organization and how you would like to collaborate. Our team reviews every proposal directly.
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
                Partnership Enquiry Received
              </h3>
              <p className="mx-auto max-w-md text-sm text-ink-muted leading-relaxed">
                Thank you for reaching out. Your proposal has been logged with our team. A coordinator will review your details and reply to the contact information provided.
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
                    {schemaMissing ? 'Partner System Maintenance' : 'Submission Issue'}
                  </p>
                  <p className="mt-1 leading-relaxed">{failure.message}</p>
                  {schemaMissing && (
                    <div className="mt-3">
                      <p className="text-xs text-amber-800">
                        You can email our team directly:
                      </p>
                      <a
                        href={fallbackHref}
                        className="mt-2 inline-flex items-center gap-1.5 font-bold text-primary hover:underline text-xs min-h-[36px]"
                      >
                        <Mail className="h-3.5 w-3.5" aria-hidden="true" />
                        Send your proposal via email instead
                      </a>
                    </div>
                  )}
                </div>
              )}

              <form onSubmit={handleSubmit} noValidate className="space-y-5">
                {/* Organisation & Contact Person */}
                <div className="grid gap-5 sm:grid-cols-2">
                  <div>
                    <label htmlFor="partner-org" className="block text-xs font-semibold text-ink mb-1.5">
                      Organisation / Business Name <span className="text-rose-600">*</span>
                    </label>
                    <input
                      id="partner-org"
                      type="text"
                      required
                      autoComplete="organization"
                      value={form.organisation}
                      onChange={(e) => set('organisation', e.target.value)}
                      placeholder="e.g. Apex Community Clinic"
                      className="field-control text-sm py-2.5 min-h-[44px]"
                    />
                  </div>
                  <div>
                    <label htmlFor="partner-contact" className="block text-xs font-semibold text-ink mb-1.5">
                      Your Full Name <span className="text-rose-600">*</span>
                    </label>
                    <input
                      id="partner-contact"
                      type="text"
                      required
                      autoComplete="name"
                      value={form.contactName}
                      onChange={(e) => set('contactName', e.target.value)}
                      placeholder="e.g. Rahul Verma"
                      className="field-control text-sm py-2.5 min-h-[44px]"
                    />
                  </div>
                </div>

                {/* Email & Phone */}
                <div className="grid gap-5 sm:grid-cols-2">
                  <div>
                    <label htmlFor="partner-email" className="block text-xs font-semibold text-ink mb-1.5">
                      Email Address <span className="text-rose-600">*</span>
                    </label>
                    <input
                      id="partner-email"
                      type="email"
                      required
                      autoComplete="email"
                      value={form.email}
                      onChange={(e) => set('email', e.target.value)}
                      placeholder="contact@example.org"
                      className="field-control text-sm py-2.5 min-h-[44px]"
                    />
                  </div>
                  <div>
                    <label htmlFor="partner-phone" className="block text-xs font-semibold text-ink mb-1.5">
                      Phone Number <span className="font-normal text-ink-subtle">(Optional)</span>
                    </label>
                    <input
                      id="partner-phone"
                      type="tel"
                      autoComplete="tel"
                      value={form.phone}
                      onChange={(e) => set('phone', e.target.value)}
                      placeholder="+91 98765 43210"
                      className="field-control text-sm py-2.5 min-h-[44px]"
                    />
                  </div>
                </div>

                {/* Partnership Type */}
                <div>
                  <label htmlFor="partner-type" className="block text-xs font-semibold text-ink mb-1.5">
                    Type of Organisation <span className="text-rose-600">*</span>
                  </label>
                  <select
                    id="partner-type"
                    required
                    value={form.partnershipType}
                    onChange={(e) => set('partnershipType', e.target.value)}
                    className="field-control text-sm py-2.5 min-h-[44px]"
                  >
                    {PARTNERSHIP_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Message */}
                <div>
                  <label htmlFor="partner-message" className="block text-xs font-semibold text-ink mb-1.5">
                    Collaboration Proposal <span className="text-rose-600">*</span>
                  </label>
                  <textarea
                    id="partner-message"
                    required
                    rows={5}
                    maxLength={2000}
                    value={form.message}
                    onChange={(e) => set('message', e.target.value)}
                    placeholder="Tell us what services, supplies, or assistance your organization can offer, and in what capacity..."
                    className="field-control text-sm py-2.5 resize-y"
                  />
                  <div className="mt-1 flex items-center justify-between text-[11px] text-ink-subtle">
                    <span>Describe your organization's resources and proposed collaboration.</span>
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
                    Submit Partnership Enquiry
                  </Button>
                </div>

                {/* Privacy reassurance */}
                <p className="text-center text-xs text-ink-subtle leading-relaxed">
                  We review every proposal directly. Your organizational contact information is stored securely and never shared publicly.
                </p>
              </form>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
