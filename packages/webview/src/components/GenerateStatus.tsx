import type { InitialDataPayload } from '../types.js';

export function GenerateStatus({
  readiness,
}: {
  readiness: InitialDataPayload['generateReadiness'];
}) {
  const issueCount = readiness.diagnostics.length;
  const isReady = issueCount === 0;

  return (
    <section
      className={
        isReady
          ? 'composer-generate-status'
          : 'composer-generate-status composer-generate-status-warning'
      }
      aria-live="polite"
    >
      <div>
        <p className="composer-generate-status-label">Generate Status</p>
        <p className="composer-generate-status-message">
          {isReady
            ? 'Ready to generate launch.json.'
            : `${issueCount} issue${issueCount === 1 ? '' : 's'} block Generate.`}
        </p>
      </div>
      {issueCount > 0 ? (
        <p className="composer-generate-status-detail">
          Fix the highlighted fields, entry issues, or JSON status in the editor
          below.
        </p>
      ) : null}
    </section>
  );
}
