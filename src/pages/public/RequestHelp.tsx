import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  FileCheck2,
  FileText,
  FileUp,
  Loader2,
  Lock,
  Pencil,
  Save,
  ShieldCheck,
  Trash2,
  UploadCloud,
} from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';
import {
  createHelpRequestDraft,
  DOCUMENT_BUCKET,
  getCategories,
  getOwnedHelpRequestStatus,
  getOwnedHelpRequestById,
  listHelpRequestDocuments,
  MAX_DOCUMENTS_PER_REQUEST,
  removeHelpRequestDocument,
  submitHelpRequest,
  updateHelpRequestDraft,
  uploadHelpRequestDocument,
  validateDocumentFile,
  getDocumentDisplayName,
  type Category,
  type HelpRequestDraftInput,
  type HelpRequestDocumentRecord,
  type HelpRequestServiceError,
} from '../../services/helpRequests';
import { Alert, LoadingState } from '../../components/ui/Card';
import Button, { LinkButton } from '../../components/ui/Button';
import { Checkbox, Field, Input, Textarea } from '../../components/ui/Field';
import { DOCUMENT_STATUS_META } from '../../lib/status';
import {
  draftCompletenessProblem,
  EMPTY_WIZARD_FORM,
  firstInvalidStep,
  isLastStep,
  MAX_CITY,
  MAX_DESCRIPTION,
  MAX_STATE,
  MAX_TITLE,
  nextStepId,
  previousStepId,
  stepIndex,
  summariseErrors,
  URGENCY_OPTIONS,
  validateAllSteps,
  validateStep,
  WIZARD_STEPS,
  type FieldErrors,
  type StepId,
  type WizardFormState,
} from '../../lib/wizard';
import { formatINR } from '../../lib/format';

/* ------------------------------------------------------------------ errors */

interface StructuredSupabaseError {
  code: string;
  message: string;
  details: string;
  hint: string;
}

/**
 * Supabase REST errors are plain objects ({ code, details, hint, message }),
 * not Error instances. Detect and normalize them so the real failure (RLS
 * violation, enum error, missing row, etc.) can be reported instead of being
 * swallowed by a generic fallback.
 */
function extractStructuredError(err: unknown): StructuredSupabaseError | null {
  if (!err || typeof err !== 'object' || err instanceof Error) return null;
  const e = err as Record<string, unknown>;
  if (typeof e.message !== 'string' && typeof e.code !== 'string') return null;
  return {
    code: typeof e.code === 'string' ? e.code : '',
    message: typeof e.message === 'string' ? e.message : '',
    details: typeof e.details === 'string' ? e.details : '',
    hint: typeof e.hint === 'string' ? e.hint : '',
  };
}

function devErrorSuffix(structured: StructuredSupabaseError): string {
  const parts: string[] = [];
  if (structured.code) parts.push(`code: ${structured.code}`);
  if (structured.details) parts.push(`details: ${structured.details}`);
  if (structured.hint) parts.push(`hint: ${structured.hint}`);
  const joined = parts.join(' | ');
  return joined ? ` (${joined})` : '';
}

const REQUEST_DB_ERROR = 'We could not save your request. Your answers are still on screen — please try again.';
const DOCUMENT_DB_ERROR = 'We could not attach this document. Please try again.';

function requestDbErrorMessage(err: unknown, action: 'save' | 'submit'): string {
  const structured = extractStructuredError(err);
  const suffix = structured ? devErrorSuffix(structured) : '';

  if (!structured) {
    return REQUEST_DB_ERROR;
  }

  const classified = (err as { kind?: unknown }).kind;
  if (typeof classified === 'string') {
    return import.meta.env.DEV ? `${structured.message}${suffix}` : structured.message;
  }

  const lower = structured.message.toLowerCase();
  const isRls =
    structured.code === '42501' ||
    lower.includes('row-level security') ||
    lower.includes('policy');

  let base: string;
  if (structured.code === 'PGRST116' || lower.includes('could not find')) {
    base =
      action === 'submit'
        ? 'This request could not be found for submission. It may have already been submitted or may no longer belong to your account.'
        : 'This draft could not be found. It may have already been submitted or may no longer belong to your account.';
  } else if (isRls) {
    base =
      action === 'submit'
        ? 'This request can no longer be submitted because its status has changed. It may have already been submitted.'
        : 'This request can no longer be edited because its status has changed. It may have already been submitted.';
  } else if (structured.code === '22P02') {
    base = 'The request status could not be applied. Please refresh the page and try again.';
  } else if (structured.code === '23502') {
    base =
      'Some required details are missing from your request. Please review the form and complete every required field.';
  } else {
    base = REQUEST_DB_ERROR;
  }

  return import.meta.env.DEV ? `${base}${suffix}` : base;
}

function documentErrorMessage(err: unknown): string {
  const known =
    err && typeof err === 'object' && !(err instanceof Error)
      ? (err as Partial<HelpRequestServiceError>)
      : null;
  if (known && typeof known.source === 'string' && typeof known.message === 'string') {
    const service = known as HelpRequestServiceError;
    const suffix = import.meta.env.DEV
      ? [
          service.name ? `name: ${service.name}` : null,
          service.status !== undefined ? `status: ${service.status}` : null,
          service.code ? `code: ${service.code}` : null,
          service.hint ? `hint: ${service.hint}` : null,
        ]
          .filter(Boolean)
          .join(' | ')
      : '';
    const withSuffix = (text: string) => (suffix ? `${text} (${suffix})` : text);

    switch (known.source) {
      case 'storage-upload':
        return withSuffix('This document could not be uploaded. Please try again.');
      case 'documents-insert':
        return withSuffix(DOCUMENT_DB_ERROR);
      case 'storage-cleanup':
        return withSuffix(
          'The file was uploaded but could not be removed after a save error. Please contact support.',
        );
      case 'storage-remove':
      case 'documents-delete':
      case 'documents-list':
        return withSuffix(known.message);
      default:
        break;
    }
  }
  return DOCUMENT_DB_ERROR;
}

/* ------------------------------------------------------------------- page */

type FieldErrorsByStep = Partial<Record<StepId, FieldErrors>>;

export default function RequestHelp() {
  const { user } = useAuth();
  const [searchParams] = useSearchParams();
  const urlDraftId = searchParams.get('draftId') || searchParams.get('id');
  const [nonDraftNotice, setNonDraftNotice] = useState<{ id: string; status: string } | null>(null);

  const [stepId, setStepId] = useState<StepId>('category');
  const [form, setForm] = useState<WizardFormState>(EMPTY_WIZARD_FORM);
  const [categories, setCategories] = useState<Category[]>([]);
  const [categoriesError, setCategoriesError] = useState<string | null>(null);

  const [draftId, setDraftId] = useState<string | null>(null);
  const [draftSavedAt, setDraftSavedAt] = useState<string | null>(null);
  const [resumed, setResumed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrorsByStep>({});

  const [documents, setDocuments] = useState<HelpRequestDocumentRecord[]>([]);
  const [documentsLoading, setDocumentsLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [uploadingLabel, setUploadingLabel] = useState<string | null>(null);
  const [removingPath, setRemovingPath] = useState<string | null>(null);
  const [documentError, setDocumentError] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const submitLock = useRef(false);
  const stepHeadingRef = useRef<HTMLHeadingElement>(null);
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    stepHeadingRef.current?.focus();
  }, [stepId]);

  /* --------------------------------------------------------------- loading */

  useEffect(() => {
    if (!urlDraftId) return;
    let active = true;
    getOwnedHelpRequestById(urlDraftId).then((res) => {
      if (!active) return;
      if (res.error) {
        setError('This draft could not be opened. Please try starting a new request.');
        return;
      }
      if (res.data) {
        if (res.data.status === 'draft') {
          const restored: WizardFormState = {
            title: res.data.title,
            description: res.data.description,
            categoryId: res.data.categoryId ?? '',
            urgency: res.data.urgency,
            targetAmount: res.data.targetAmount ? String(res.data.targetAmount) : '',
            locationCity: res.data.locationCity ?? '',
            locationState: res.data.locationState ?? '',
            acknowledged: false,
          };
          setDraftId(res.data.id);
          setForm(restored);
          const savedAt = new Date(res.data.updatedAt || res.data.createdAt).toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit',
          });
          setDraftSavedAt(savedAt);
          setResumed(true);
          setStepId(firstInvalidStep(restored, []) ?? 'category');
        } else {
          setNonDraftNotice({ id: res.data.id, status: res.data.status });
        }
      }
    });
    return () => {
      active = false;
    };
  }, [urlDraftId]);

  useEffect(() => {
    if (!draftId) {
      setDocuments([]);
      return;
    }
    let active = true;
    setDocumentsLoading(true);
    listHelpRequestDocuments(draftId).then((result) => {
      if (!active) return;
      if (result.error) {
        setDocumentError('Saved documents could not be loaded. Please refresh and try again.');
      } else {
        setDocuments(result.data ?? []);
      }
      setDocumentsLoading(false);
    });
    return () => {
      active = false;
    };
  }, [draftId]);

  useEffect(() => {
    let active = true;
    getCategories().then((result) => {
      if (!active) return;
      if (result.error) {
        setCategoriesError(result.error.message);
        setCategories([]);
      } else if (result.data.length === 0) {
        setCategoriesError('No help categories are available right now. Please try again later.');
        setCategories([]);
      } else {
        setCategoriesError(null);
        setCategories(result.data);
      }
    });
    return () => {
      active = false;
    };
  }, []);

  /* ----------------------------------------------------------------- state */

  const busy = saving || submitting;
  const categoryIds = useMemo(() => categories.map((c) => c.id), [categories]);

  const setField = useCallback(<K extends keyof WizardFormState>(
    field: K,
    value: WizardFormState[K],
  ) => {
    setForm((prev) => ({ ...prev, [field]: value }));
    setFieldErrors((prev) => {
      if (!Object.values(prev).some((errors) => errors && field in errors)) return prev;
      const next: FieldErrorsByStep = {};
      for (const [id, errors] of Object.entries(prev) as [StepId, FieldErrors][]) {
        if (!errors || !(field in errors)) {
          next[id] = errors;
          continue;
        }
        const { [field]: _removed, ...rest } = errors;
        next[id] = rest;
      }
      return next;
    });
    setError(null);
  }, []);

  const errFor = (id: StepId, field: keyof WizardFormState): string | undefined =>
    fieldErrors[id]?.[field];

  const buildInput = (): HelpRequestDraftInput => ({
    title: form.title.trim(),
    description: form.description.trim(),
    categoryId: form.categoryId,
    urgency: form.urgency,
    targetAmount: Number(form.targetAmount),
    locationCity: form.locationCity.trim(),
    locationState: form.locationState.trim(),
  });

  /* ----------------------------------------------------------------- steps */

  const goToStep = (id: StepId) => {
    setError(null);
    setStepId(id);
  };

  const handleNext = () => {
    const errors = validateStep(stepId, form, categoryIds);
    if (Object.values(errors).some(Boolean)) {
      setFieldErrors((prev) => ({ ...prev, [stepId]: errors }));
      setError(summariseErrors(errors));
      return;
    }
    setFieldErrors((prev) => {
      if (!prev[stepId]) return prev;
      const next = { ...prev };
      delete next[stepId];
      return next;
    });
    setError(null);
    setStepId(nextStepId(stepId));
  };

  const handleBack = () => {
    setError(null);
    setStepId(previousStepId(stepId));
  };

  /* ------------------------------------------------------------- persistence */

  const persistDraft = async (): Promise<string | null> => {
    const missing = draftCompletenessProblem(form, categoryIds);
    if (missing) {
      setError(missing);
      return null;
    }
    const input = buildInput();
    let id = draftId;
    if (id) {
      const { data, error: updateError } = await updateHelpRequestDraft(id, input);
      if (updateError) throw updateError;
      id = data?.id ?? id;
    } else {
      const { data, error: createError } = await createHelpRequestDraft(input);
      if (createError) throw createError;
      id = data?.id ?? null;
    }
    if (!alive.current) return id;
    setDraftId(id);
    setDraftSavedAt(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
    return id;
  };

  const handleSaveDraft = async () => {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      await persistDraft();
    } catch (err) {
      if (!alive.current) return;
      setError(requestDbErrorMessage(err, 'save'));
    } finally {
      if (alive.current) setSaving(false);
    }
  };

  /* ------------------------------------------------------------- documents */

  const clearSelectedFile = () => {
    setSelectedFile(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleFileUpload = async () => {
    if (!selectedFile) {
      setDocumentError('Please choose a file to upload first.');
      return;
    }
    if (uploading) return;
    if (!user) {
      setDocumentError('You must be signed in to upload documents.');
      return;
    }
    const validationProblem = validateDocumentFile(selectedFile);
    if (validationProblem) {
      setDocumentError(validationProblem);
      return;
    }
    const duplicate = documents.find(
      (doc) => getDocumentDisplayName(doc.storagePath) === selectedFile.name,
    );
    if (duplicate) {
      setDocumentError(`"${selectedFile.name}" is already attached to this request.`);
      clearSelectedFile();
      return;
    }
    if (documents.length >= MAX_DOCUMENTS_PER_REQUEST) {
      setDocumentError(`You can attach up to ${MAX_DOCUMENTS_PER_REQUEST} documents per request.`);
      return;
    }

    setUploading(true);
    setUploadProgress(0);
    setUploadingLabel(`Uploading ${selectedFile.name}…`);
    setDocumentError(null);
    try {
      const requestId = await persistDraft();
      if (!requestId) {
        return;
      }
      if (import.meta.env.DEV) {
        console.log('Document upload: starting (identity resolved by the service)', {
          bucket: DOCUMENT_BUCKET,
          requestId,
          fileName: selectedFile.name,
          contentType: selectedFile.type,
          size: selectedFile.size,
        });
      }
      const { data, error: uploadError } = await uploadHelpRequestDocument({
        requestId,
        file: selectedFile,
        onProgress: (percent) => {
          if (alive.current) setUploadProgress(percent);
        },
      });
      if (!alive.current) return;
      if (uploadError || !data) {
        setDocumentError(documentErrorMessage(uploadError));
        return;
      }
      const result = await listHelpRequestDocuments(requestId);
      if (!alive.current) return;
      if (!result.error) {
        setDocuments(result.data ?? []);
      }
      clearSelectedFile();
    } catch (err) {
      if (!alive.current) return;
      setDocumentError(requestDbErrorMessage(err, 'save'));
    } finally {
      if (alive.current) {
        setUploading(false);
        setUploadProgress(null);
        setUploadingLabel(null);
      }
    }
  };

  const handleRemoveDocument = async (doc: HelpRequestDocumentRecord) => {
    if (uploading || removingPath) return;
    setRemovingPath(doc.storagePath);
    setDocumentError(null);
    try {
      const result = await removeHelpRequestDocument({
        requestId: doc.requestId,
        storagePath: doc.storagePath,
      });
      if (!alive.current) return;
      if (!result.ok) {
        setDocumentError(documentErrorMessage(result.error));
        return;
      }
      setDocuments((prev) => prev.filter((d) => d.storagePath !== doc.storagePath));
    } catch (err) {
      if (!alive.current) return;
      setDocumentError(documentErrorMessage(err));
    } finally {
      if (alive.current) setRemovingPath(null);
    }
  };

  /* ---------------------------------------------------------------- submit */

  const handleSubmit = async () => {
    if (!user) {
      setError('You must be signed in to submit a request.');
      return;
    }
    if (submitLock.current || submitted) return;

    const allErrors = validateAllSteps(form, categoryIds);
    const firstBad = firstInvalidStep(form, categoryIds);
    if (firstBad) {
      setFieldErrors(allErrors);
      setError(summariseErrors(validateStep(firstBad, form, categoryIds)));
      setStepId(firstBad);
      return;
    }

    submitLock.current = true;
    setSubmitting(true);
    setError(null);
    try {
      const id = await persistDraft();
      if (!id) return;

      const check = await getOwnedHelpRequestStatus(id);
      if (check.error) {
        console.error('[RequestHelp] pre-submit status read failed; still attempting submit:', {
          requestId: id,
          message: check.error.message,
        });
      } else if (check.data && check.data.status !== 'draft') {
        setError(
          `This request is no longer a draft — its current status is "${check.data.status}". It may have already been submitted.`,
        );
        return;
      }

      const { data, error: submitError } = await submitHelpRequest(id);
      if (submitError) throw submitError;
      if (!alive.current) return;
      setDraftId(data?.id ?? id);
      setSubmitted(true);
    } catch (err) {
      if (!alive.current) return;
      console.error('[RequestHelp] submit failed', err);
      setError(requestDbErrorMessage(err, 'submit'));
    } finally {
      submitLock.current = false;
      if (alive.current) setSubmitting(false);
    }
  };

  const handleReset = () => {
    setForm(EMPTY_WIZARD_FORM);
    setFieldErrors({});
    setError(null);
    clearSelectedFile();
    setStepId('category');
  };

  /* ---------------------------------------------------------------- render */

  if (submitted) {
    return (
      <section className="bg-canvas py-10 sm:py-16">
        <div className="container-narrow text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-control bg-emerald-100 text-emerald-800">
            <CheckCircle2 className="h-6 w-6 text-emerald-700" aria-hidden="true" />
          </div>

          <div className="mt-4 inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-900">
            <FileCheck2 className="h-4 w-4" />
            <span>Request Submitted for Review</span>
          </div>

          <h1 className="mt-2 text-2xl font-bold tracking-tight text-ink sm:text-3xl">
            Your request has been safely received
          </h1>
          <p className="mx-auto mt-3 max-w-lg text-sm text-ink-muted leading-relaxed sm:text-base">
            Our team will review your situation details and verify supporting documents. Requests only become visible on the public directory once reviewed and approved.
          </p>

          <div className="mx-auto mt-8 max-w-md border-t border-line pt-6 text-left text-xs text-ink-muted space-y-3">
            <p className="font-semibold text-ink uppercase tracking-wider text-[11px]">
              What happens next
            </p>
            <div className="space-y-2">
              <p>
                <strong className="text-ink">1. Staff Review:</strong> A reviewer checks the details you submitted.
              </p>
              <p>
                <strong className="text-ink">2. Document Verification:</strong> Supporting documents are authenticated in private secure storage.
              </p>
              <p>
                <strong className="text-ink">3. Publication:</strong> Once verified, your request is approved for community support.
              </p>
            </div>
          </div>

          <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
            {draftId && (
              <LinkButton to={`/my-requests/${draftId}`} size="md" className="min-h-[44px]">
                Track Your Request
              </LinkButton>
            )}
            <LinkButton to="/my-requests" variant="secondary" size="md" className="min-h-[44px]">
              View All My Requests
            </LinkButton>
          </div>
        </div>
      </section>
    );
  }

  const stepDef = WIZARD_STEPS[stepIndex(stepId)];
  const currentNumber = stepIndex(stepId) + 1;
  const selectedCategory = categories.find((c) => c.id === form.categoryId);
  const atDocuments = stepId === 'documents';

  return (
    <div className="min-h-screen bg-canvas py-6 sm:py-10">
      <div className="container-narrow space-y-6 sm:space-y-8">
        {/* 1. Page Introduction & Privacy Reassurance */}
        <header className="space-y-2 border-b border-line pb-6">
          <div className="flex items-center justify-between text-xs text-ink-subtle">
            <span className="font-semibold text-primary uppercase tracking-wider text-[11px]">
              Step {currentNumber} of {WIZARD_STEPS.length}
            </span>
            {draftId && draftSavedAt && (
              <span className="text-ink-subtle">
                {saving ? 'Saving draft…' : `Draft saved ${draftSavedAt}`}
              </span>
            )}
          </div>

          <h1 className="text-2xl font-bold tracking-tight text-ink sm:text-3xl">
            Request Assistance
          </h1>

          <p className="text-sm text-ink-muted leading-relaxed max-w-xl">
            Tell us what you need help with. Our team uses this information to understand your situation and review your request.
          </p>

          <p className="text-xs text-ink-subtle pt-1">
            Documents you upload are stored privately and are only used as part of the staff review process.
          </p>
        </header>

        {nonDraftNotice && (
          <Alert tone="warn" title="This request is no longer a draft">
            <p className="text-xs sm:text-sm">
              Its current status is{' '}
              <span className="font-semibold">{nonDraftNotice.status.replace(/_/g, ' ')}</span>, so it
              cannot be edited from this form.
            </p>
            <Link
              to={`/my-requests/${nonDraftNotice.id}`}
              className="mt-2 inline-block text-xs font-semibold underline text-primary"
            >
              View request details and timeline status →
            </Link>
          </Alert>
        )}

        {resumed && draftSavedAt && (
          <Alert tone="info" title="Draft Resumed">
            <p className="text-xs sm:text-sm">
              We picked up where you left off. This draft was last saved at {draftSavedAt}. Please review your answers before submitting.
            </p>
          </Alert>
        )}

        {/* 2. Step Progress Stepper */}
        <nav aria-label="Application progress" className="py-1">
          <div className="flex items-center justify-between text-xs font-medium text-ink-subtle mb-2 sm:hidden">
            <span>Step {currentNumber} of {WIZARD_STEPS.length}</span>
            <span className="text-ink font-semibold">{stepDef.label}</span>
          </div>

          <div
            className="h-1 w-full overflow-hidden rounded-full bg-slate-200"
            role="progressbar"
            aria-valuenow={(currentNumber / WIZARD_STEPS.length) * 100}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`Step ${currentNumber} of ${WIZARD_STEPS.length}: ${stepDef.label}`}
          >
            <div
              className="h-full bg-primary transition-all duration-200"
              style={{ width: `${(currentNumber / WIZARD_STEPS.length) * 100}%` }}
            />
          </div>

          <ol className="hidden sm:flex list-none items-center justify-between gap-2 pt-3" aria-label="Wizard steps list">
            {WIZARD_STEPS.map((s, i) => {
              const state = i === currentNumber - 1 ? 'current' : i < currentNumber - 1 ? 'done' : 'todo';
              const reachable = i <= currentNumber - 1 || Boolean(fieldErrors[s.id]);
              return (
                <li key={s.id} className="flex-1">
                  <button
                    type="button"
                    onClick={() => goToStep(s.id)}
                    disabled={!reachable}
                    aria-current={state === 'current' ? 'step' : undefined}
                    className={`w-full text-left py-1 text-xs transition-colors focus-visible:outline-2 focus-visible:outline-primary disabled:cursor-not-allowed ${
                      state === 'current'
                        ? 'text-primary font-bold'
                        : state === 'done'
                          ? 'text-ink font-medium hover:text-primary'
                          : 'text-ink-subtle/60'
                    }`}
                  >
                    <span className="block text-[11px] font-mono text-ink-subtle">{s.number}</span>
                    <span className="block truncate">{s.label}</span>
                  </button>
                </li>
              );
            })}
          </ol>
        </nav>

        {error && (
          <div
            role="alert"
            className="flex items-start gap-2.5 rounded-control border border-rose-200 bg-rose-50 p-3.5 text-xs sm:text-sm font-medium text-rose-900"
          >
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" aria-hidden="true" />
            <span>{error}</span>
          </div>
        )}

        {/* 3. Main Application Form Body (Document-Style) */}
        <div className="pt-2">
          {/* Section Heading */}
          <div className="border-b border-line pb-4">
            <h2
              ref={stepHeadingRef}
              tabIndex={-1}
              className="text-lg sm:text-xl font-bold tracking-tight text-ink focus:outline-none"
            >
              {stepDef.heading}
            </h2>
            <p className="mt-1 text-xs sm:text-sm text-ink-muted leading-relaxed">
              {stepDef.lede}
            </p>
          </div>

          {/* ------------------------------------------------ Step 1: Category */}
          {stepId === 'category' && (
            <div className="mt-6 space-y-6">
              {categoriesError ? (
                <Alert tone="stop" title="Categories unavailable">
                  {categoriesError}
                </Alert>
              ) : categories.length === 0 ? (
                <LoadingState label="Loading available categories…" />
              ) : (
                <fieldset>
                  <legend className="text-xs font-semibold uppercase tracking-wider text-ink mb-1">
                    Select a cause category <span className="text-rose-600">*</span>
                  </legend>
                  <p className="text-xs text-ink-muted mb-3">
                    Choose what best matches your need. Staff can refine it during review if needed.
                  </p>

                  <div className="grid gap-2.5 sm:grid-cols-2">
                    {categories.map((category) => {
                      const selected = form.categoryId === category.id;
                      return (
                        <label
                          key={category.id}
                          className={`relative flex cursor-pointer items-start gap-3 rounded-control border p-3.5 transition-all ${
                            selected
                              ? 'border-primary bg-primary-soft/40 ring-1 ring-primary'
                              : 'border-line bg-surface hover:border-slate-300'
                          }`}
                        >
                          <input
                            type="radio"
                            name="categoryId"
                            value={category.id}
                            checked={selected}
                            onChange={() => setField('categoryId', category.id)}
                            className="mt-0.5 h-4 w-4 shrink-0 accent-primary"
                          />
                          <span className="min-w-0 flex-1">
                            <span className="block text-sm font-semibold text-ink">{category.name}</span>
                            {category.description && (
                              <span className="mt-0.5 block text-xs text-ink-muted leading-relaxed">
                                {category.description}
                              </span>
                            )}
                          </span>
                        </label>
                      );
                    })}
                  </div>

                  {errFor('category', 'categoryId') && (
                    <p className="mt-2 text-xs font-semibold text-rose-700">
                      {errFor('category', 'categoryId')}
                    </p>
                  )}
                </fieldset>
              )}

              {/* Good faith declaration */}
              <div
                className={`rounded-control border p-4 transition-colors ${
                  errFor('category', 'acknowledged') ? 'border-rose-300 bg-rose-50' : 'border-line bg-surface'
                }`}
              >
                <div className="flex items-start gap-3">
                  <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                  <div className="min-w-0 flex-1">
                    <Checkbox
                      label="I confirm that I am asking for help in good faith, that the details I share are authentic to the best of my knowledge, and that supporting documents can be verified by staff."
                      checked={form.acknowledged}
                      onChange={(e) => setField('acknowledged', e.target.checked)}
                    />
                  </div>
                </div>
                {errFor('category', 'acknowledged') && (
                  <p className="mt-2 text-xs font-semibold text-rose-700">
                    {errFor('category', 'acknowledged')}
                  </p>
                )}
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4 text-xs text-ink-subtle">
                <button
                  type="button"
                  onClick={handleReset}
                  className="font-medium underline hover:text-ink focus-visible:outline-2 focus-visible:outline-primary min-h-[36px]"
                >
                  Clear the form
                </button>
                <span>We never ask for passwords or private banking credentials.</span>
              </div>
            </div>
          )}

          {/* ------------------------------------------------ Step 2: Details */}
          {stepId === 'details' && (
            <div className="mt-6 space-y-6">
              <Field
                label="Campaign title"
                required
                hint={`A clear, honest headline for your request (${form.title.length}/${MAX_TITLE}).`}
                error={errFor('details', 'title')}
              >
                {(props) => (
                  <Input
                    {...props}
                    value={form.title}
                    maxLength={MAX_TITLE}
                    invalid={Boolean(errFor('details', 'title'))}
                    placeholder="e.g. Urgent medical support for cardiac treatment"
                    onChange={(e) => setField('title', e.target.value)}
                    className="min-h-[44px]"
                  />
                )}
              </Field>

              <Field
                label="What are you going through?"
                required
                hint={`Explain what happened, what specific assistance is needed, and how contributions will be used (${form.description.length}/${MAX_DESCRIPTION}).`}
                error={errFor('details', 'description')}
              >
                {(props) => (
                  <Textarea
                    {...props}
                    rows={6}
                    value={form.description}
                    maxLength={MAX_DESCRIPTION}
                    invalid={Boolean(errFor('details', 'description'))}
                    placeholder="Share your story clearly. Helpful details include: what occurred, what costs or practical assistance are needed, and your current situation."
                    onChange={(e) => setField('description', e.target.value)}
                  />
                )}
              </Field>

              <fieldset>
                <legend className="text-xs font-semibold uppercase tracking-wider text-ink mb-1">
                  How urgent is this need? <span className="text-rose-600">*</span>
                </legend>
                <p className="text-xs text-ink-muted mb-3">
                  Helps our verification staff prioritize time-sensitive situations.
                </p>

                <div className="grid gap-2.5 sm:grid-cols-2">
                  {URGENCY_OPTIONS.map((option) => {
                    const selected = form.urgency === option.value;
                    return (
                      <label
                        key={option.value}
                        className={`flex cursor-pointer items-start gap-3 rounded-control border p-3.5 transition-all ${
                          selected
                            ? 'border-primary bg-primary-soft/40 ring-1 ring-primary'
                            : 'border-line bg-surface hover:border-slate-300'
                        }`}
                      >
                        <input
                          type="radio"
                          name="urgency"
                          value={option.value}
                          checked={selected}
                          onChange={() => setField('urgency', option.value)}
                          className="mt-0.5 h-4 w-4 shrink-0 accent-primary"
                        />
                        <span className="min-w-0">
                          <span className="block text-sm font-semibold text-ink">{option.label}</span>
                          <span className="mt-0.5 block text-xs text-ink-muted leading-relaxed">
                            {option.description}
                          </span>
                        </span>
                      </label>
                    );
                  })}
                </div>

                {errFor('details', 'urgency') && (
                  <p className="mt-2 text-xs font-semibold text-rose-700">
                    {errFor('details', 'urgency')}
                  </p>
                )}
              </fieldset>
            </div>
          )}

          {/* ------------------------------------------------ Step 3: Location */}
          {stepId === 'location' && (
            <div className="mt-6 space-y-6">
              <div className="border border-line bg-surface p-4 rounded-control text-xs text-ink-muted leading-relaxed">
                <span className="block font-semibold text-ink mb-1">
                  Location Privacy
                </span>
                We publish your <strong className="text-ink">city and state only</strong> so nearby community supporters and volunteers can locate your request. Street addresses, door numbers, and coordinates are never collected.
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="City" required error={errFor('location', 'locationCity')}>
                  {(props) => (
                    <Input
                      {...props}
                      value={form.locationCity}
                      maxLength={MAX_CITY}
                      autoComplete="address-level2"
                      placeholder="e.g. Pune"
                      invalid={Boolean(errFor('location', 'locationCity'))}
                      onChange={(e) => setField('locationCity', e.target.value)}
                      className="min-h-[44px]"
                    />
                  )}
                </Field>

                <Field label="State" required error={errFor('location', 'locationState')}>
                  {(props) => (
                    <Input
                      {...props}
                      value={form.locationState}
                      maxLength={MAX_STATE}
                      autoComplete="address-level1"
                      placeholder="e.g. Maharashtra"
                      invalid={Boolean(errFor('location', 'locationState'))}
                      onChange={(e) => setField('locationState', e.target.value)}
                      className="min-h-[44px]"
                    />
                  )}
                </Field>
              </div>
            </div>
          )}

          {/* ------------------------------------------------ Step 4: Funding */}
          {stepId === 'funding' && (
            <div className="mt-6 space-y-6">
              <Field
                label="Target fundraising goal (in INR ₹)"
                required
                hint="Specify the estimated amount needed. A clear estimate helps supporters understand your goal."
                error={errFor('funding', 'targetAmount')}
              >
                {(props) => (
                  <div className="relative max-w-sm">
                    <span
                      className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-base font-semibold text-ink-muted"
                      aria-hidden="true"
                    >
                      ₹
                    </span>
                    <Input
                      {...props}
                      value={form.targetAmount}
                      inputMode="decimal"
                      placeholder="25000"
                      className="pl-8 text-base font-semibold min-h-[44px]"
                      invalid={Boolean(errFor('funding', 'targetAmount'))}
                      onChange={(e) => setField('targetAmount', e.target.value)}
                    />
                  </div>
                )}
              </Field>

              <div className="border border-line bg-surface p-4 rounded-control text-xs text-ink-muted leading-relaxed">
                <span className="block font-semibold text-ink mb-1">
                  Transparent Goal
                </span>
                Community contributions are tracked directly against this verified target amount. Once verified, donors can contribute toward fulfilling your goal.
              </div>
            </div>
          )}

          {/* ------------------------------------------------ Step 5: Documents & Review */}
          {atDocuments && (
            <div className="mt-6 space-y-6">
              {/* Private Document Storage Notice */}
              <div className="border border-line bg-surface p-4 sm:p-5 rounded-control space-y-3">
                <div className="flex items-center gap-2 font-semibold text-ink text-sm">
                  <Lock className="h-4 w-4 text-primary" aria-hidden="true" />
                  <span>Private Supporting Documents</span>
                </div>
                <p className="text-xs text-ink-muted leading-relaxed">
                  Supporting documents (such as medical records, hospital bills, or identity proofs) are stored in private secure storage. They are never shown publicly on the website and are only accessible by authorized staff during verification.
                </p>

                <div className="pt-2 flex flex-col gap-2.5 sm:flex-row">
                  <label className="flex flex-1 cursor-pointer items-center gap-2.5 rounded-control border border-dashed border-line bg-canvas px-3.5 py-2.5 hover:border-slate-400 transition-colors min-h-[44px]">
                    <UploadCloud className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                    <span className={`truncate text-xs ${selectedFile ? 'font-semibold text-ink' : 'text-ink-muted'}`}>
                      {selectedFile ? selectedFile.name : 'Choose file (PDF, JPG or PNG up to 5 MB)'}
                    </span>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
                      className="sr-only"
                      onChange={(e) => {
                        setDocumentError(null);
                        setSelectedFile(e.target.files?.[0] ?? null);
                      }}
                    />
                  </label>
                  <Button
                    onClick={handleFileUpload}
                    loading={uploading}
                    loadingLabel="Uploading document"
                    disabled={!selectedFile || documents.length >= MAX_DOCUMENTS_PER_REQUEST}
                    className="shrink-0 min-h-[44px]"
                    size="sm"
                  >
                    {uploading ? 'Uploading…' : 'Attach Document'}
                  </Button>
                </div>

                {uploading && uploadProgress !== null && (
                  <div className="mt-3">
                    <div className="flex items-center justify-between text-xs text-ink-muted">
                      <span className="truncate">{uploadingLabel}</span>
                      <span className="ml-3 shrink-0 font-bold text-primary">{uploadProgress}%</span>
                    </div>
                    <div
                      role="progressbar"
                      aria-label="Document upload progress"
                      aria-valuenow={uploadProgress}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-200"
                    >
                      <div
                        className="h-full rounded-full bg-primary transition-all duration-150"
                        style={{ width: `${uploadProgress}%` }}
                      />
                    </div>
                  </div>
                )}

                {documentError && (
                  <p role="alert" className="mt-2 text-xs font-semibold text-rose-700">
                    {documentError}
                  </p>
                )}
              </div>

              {/* Document List */}
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wider text-ink mb-2">
                  Attached Documents ({documents.length}/{MAX_DOCUMENTS_PER_REQUEST})
                </h3>
                {documentsLoading ? (
                  <LoadingState label="Loading documents…" />
                ) : documents.length === 0 ? (
                  <p className="border border-dashed border-line p-3.5 text-center text-xs text-ink-muted rounded-control">
                    No documents attached yet. While optional for saving a draft, attaching relevant proofs significantly speeds up verification.
                  </p>
                ) : (
                  <ul className="divide-y divide-line border border-line rounded-control" aria-label="Attached documents">
                    {documents.map((doc) => {
                      const docStatus = DOCUMENT_STATUS_META[doc.status] ?? DOCUMENT_STATUS_META.pending;
                      return (
                        <li
                          key={doc.id || doc.storagePath}
                          className="flex items-center justify-between gap-3 p-3 bg-surface"
                        >
                          <div className="flex min-w-0 items-center gap-2 text-xs text-ink">
                            <FileText className="h-4 w-4 shrink-0 text-ink-subtle" aria-hidden="true" />
                            <span className="truncate font-medium">{getDocumentDisplayName(doc.storagePath)}</span>
                            <span className="text-[11px] text-ink-muted">
                              ({docStatus.requesterLabel})
                            </span>
                          </div>
                          <button
                            type="button"
                            onClick={() => handleRemoveDocument(doc)}
                            disabled={uploading || removingPath === doc.storagePath}
                            className="flex shrink-0 items-center gap-1 text-xs font-medium text-rose-700 hover:text-rose-900 disabled:opacity-50 min-h-[36px] px-2"
                          >
                            {removingPath === doc.storagePath ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                            ) : (
                              <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                            )}
                            Remove
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>

              {/* Review summary before submit */}
              <div className="border-t border-line pt-6">
                <div className="mb-4">
                  <h3 className="text-base font-bold text-ink">Application Summary</h3>
                  <p className="text-xs text-ink-muted">
                    Review your answers before submitting for staff verification.
                  </p>
                </div>

                <dl className="divide-y divide-line border border-line rounded-control bg-surface">
                  {WIZARD_STEPS.filter((s) => s.id !== 'documents').map((s) => (
                    <div
                      key={s.id}
                      className="flex flex-wrap items-center justify-between gap-2 px-4 py-3"
                    >
                      <dt className="text-xs font-semibold uppercase tracking-wider text-ink-subtle">{s.label}</dt>
                      <dd className="max-w-[70%] text-right text-xs sm:text-sm font-medium text-ink">
                        {s.id === 'category' && (selectedCategory?.name ?? '—')}
                        {s.id === 'details' && (
                          <div>
                            <span className="block font-semibold">{form.title || '—'}</span>
                            <span className="mt-0.5 block text-xs text-ink-muted">
                              {URGENCY_OPTIONS.find((o) => o.value === form.urgency)?.label} urgency
                            </span>
                          </div>
                        )}
                        {s.id === 'location' &&
                          (form.locationCity && form.locationState
                            ? `${form.locationCity}, ${form.locationState}`
                            : form.locationCity || form.locationState || '—')}
                        {s.id === 'funding' &&
                          (form.targetAmount && Number.isFinite(Number(form.targetAmount))
                            ? formatINR(Number(form.targetAmount))
                            : '—')}
                        <button
                          type="button"
                          onClick={() => goToStep(s.id)}
                          className="mt-0.5 inline-flex items-center gap-1 text-xs font-semibold text-primary underline focus-visible:outline-2 focus-visible:outline-primary min-h-[30px]"
                        >
                          <Pencil className="h-3 w-3" aria-hidden="true" />
                          Edit
                        </button>
                      </dd>
                    </div>
                  ))}
                  <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                    <dt className="text-xs font-semibold uppercase tracking-wider text-ink-subtle">Private Documents</dt>
                    <dd className="text-right text-xs sm:text-sm font-medium text-ink">
                      {documents.length === 0 ? 'None attached (optional)' : `${documents.length} attached`}
                    </dd>
                  </div>
                </dl>

                <p className="mt-4 text-xs text-ink-muted leading-relaxed">
                  Once submitted, your request enters our staff review queue. We will verify your details before the request becomes live on the community directory.
                </p>

                <div className="mt-6 flex flex-col gap-2.5 sm:flex-row">
                  <Button
                    variant="secondary"
                    size="md"
                    onClick={handleSaveDraft}
                    loading={saving}
                    loadingLabel="Saving draft"
                    className="w-full sm:w-auto min-h-[44px]"
                  >
                    <Save className="h-4 w-4" aria-hidden="true" />
                    Save Draft
                  </Button>
                  <Button
                    size="md"
                    onClick={handleSubmit}
                    loading={submitting}
                    loadingLabel="Submitting request"
                    disabled={busy || uploading || !form.acknowledged}
                    className="w-full sm:flex-1 min-h-[44px]"
                  >
                    <FileUp className="h-4 w-4" aria-hidden="true" />
                    Submit Request for Verification
                  </Button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* 4. Wizard Bottom Controls */}
        <div className="flex items-center justify-between gap-3 border-t border-line pt-6">
          <Button
            variant="ghost"
            size="md"
            onClick={handleBack}
            disabled={currentNumber === 1 || busy || uploading}
            className="min-h-[44px]"
          >
            <ArrowLeft className="h-4 w-4 mr-1" aria-hidden="true" />
            Previous
          </Button>

          {isLastStep(stepId) ? (
            <Button
              variant="secondary"
              size="md"
              onClick={handleSaveDraft}
              loading={saving}
              loadingLabel="Saving draft"
              disabled={busy || uploading}
              className="min-h-[44px]"
            >
              Save Draft
            </Button>
          ) : (
            <Button
              size="md"
              onClick={handleNext}
              loading={saving || submitting}
              disabled={busy || uploading}
              className="min-h-[44px]"
            >
              Continue
              <ArrowRight className="h-4 w-4 ml-1" aria-hidden="true" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
