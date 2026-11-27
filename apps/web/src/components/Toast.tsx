export interface ToastMsg {
  text: string;
  undo?: () => void;
}

export function Toast({ t, onDone }: { t: ToastMsg | null; onDone: () => void }) {
  if (!t) return null;
  return (
    <div className="toast" role="status">
      <span>{t.text}</span>
      {t.undo && (
        <button
          onClick={() => {
            t.undo!();
            onDone();
          }}
        >
          Undo
        </button>
      )}
    </div>
  );
}
