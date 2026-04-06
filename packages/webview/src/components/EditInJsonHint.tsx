interface EditInJsonHintProps {
  fileLabel: string;
  description: string;
  onOpenFileJson: () => void;
}

export function EditInJsonHint({
  fileLabel,
  description,
  onOpenFileJson,
}: EditInJsonHintProps) {
  return (
    <section className="composer-json-hint" aria-label="Edit in JSON">
      <p className="composer-json-hint-description">{description}</p>
      <button
        type="button"
        className="composer-json-link"
        onClick={onOpenFileJson}
      >
        Edit in {fileLabel}
      </button>
    </section>
  );
}
