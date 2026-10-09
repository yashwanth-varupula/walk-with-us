import { useId, type ReactNode } from 'react';
import { AlertCircle } from 'lucide-react';

/**
 * Accessible form field wrapper.
 *
 * Every label in this app is now programmatically tied to its control through
 * generated ids and `htmlFor`. Previously most fields rendered a visible <label>
 * with no `htmlFor` and an input with no `id`, so clicking the label did not
 * focus the input and a screen reader announced every control as just
 * "edit text" with no name.
 *
 * The hint and the error are wired in with `aria-describedby`, and the error
 * also sets `aria-invalid`, so assistive tech reports the field as invalid
 * rather than silently rejecting the submission.
 */
export function Field({
  label,
  hint,
  error,
  required,
  children,
  className = '',
}: {
  label: string;
  hint?: string;
  error?: string | null;
  required?: boolean;
  children: (props: {
    id: string;
    'aria-describedby': string | undefined;
    'aria-invalid': boolean | undefined;
    'aria-required': boolean | undefined;
  }) => ReactNode;
  className?: string;
}) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;

  const describedBy =
    [error ? errorId : null, hint ? hintId : null].filter(Boolean).join(' ') || undefined;

  return (
    <div className={className}>
      <label htmlFor={id} className="block text-sm font-medium text-ink">
        {label}
        {required && (
          <span className="ml-0.5 text-rose-700" aria-hidden="true">
            *
          </span>
        )}
        {required && <span className="sr-only"> (required)</span>}
      </label>

      {hint && (
        <p id={hintId} className="mt-1 text-xs text-ink-muted">
          {hint}
        </p>
      )}

      <div className="mt-1.5">
        {children({
          id,
          'aria-describedby': describedBy,
          'aria-invalid': error ? true : undefined,
          'aria-required': required ? true : undefined,
        })}
      </div>

      {error && (
        <p id={errorId} className="mt-1.5 flex items-center gap-1 text-sm font-medium text-rose-700">
          <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
          {error}
        </p>
      )}
    </div>
  );
}

/** Styled text/number/date/email input. Pair it with <Field>. */
export function Input({
  invalid,
  className = '',
  ...rest
}: React.InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }) {
  return (
    <input
      className={`field-control ${invalid ? 'field-control-invalid' : ''} ${className}`}
      aria-invalid={invalid || rest['aria-invalid'] || undefined}
      {...rest}
    />
  );
}

export function Textarea({
  invalid,
  className = '',
  ...rest
}: React.TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }) {
  return (
    <textarea
      className={`field-control min-h-28 resize-y leading-relaxed ${invalid ? 'field-control-invalid' : ''} ${className}`}
      aria-invalid={invalid || rest['aria-invalid'] || undefined}
      {...rest}
    />
  );
}

export function Select({
  invalid,
  className = '',
  children,
  ...rest
}: React.SelectHTMLAttributes<HTMLSelectElement> & { invalid?: boolean }) {
  return (
    <select
      className={`field-control appearance-none bg-[length:16px] pr-10 ${invalid ? 'field-control-invalid' : ''} ${className}`}
      style={{
        backgroundImage:
          "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 20 20' fill='%2364748b'%3E%3Cpath fill-rule='evenodd' d='M5.23 7.21a.75.75 0 011.06.02L10 11.17l3.71-3.94a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z' clip-rule='evenodd'/%3E%3C/svg%3E\")",
        backgroundRepeat: 'no-repeat',
        backgroundPosition: 'right 0.75rem center',
      }}
      aria-invalid={invalid || rest['aria-invalid'] || undefined}
      {...rest}
    >
      {children}
    </select>
  );
}

/** Checkbox with a real <label> target, so the text is clickable and announced. */
export function Checkbox({
  label,
  className = '',
  ...rest
}: React.InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  const id = useId();
  return (
    <div className={`flex items-start gap-2.5 ${className}`}>
      <input
        id={id}
        type="checkbox"
        className="mt-0.5 h-4 w-4 shrink-0 rounded border-slate-300 text-primary accent-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        {...rest}
      />
      <label htmlFor={id} className="text-sm text-ink-muted">
        {label}
      </label>
    </div>
  );
}
