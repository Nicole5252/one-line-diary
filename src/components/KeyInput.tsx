import { useEffect, useRef } from "react";

/** One-line key field. Enter or blur saves; empty = cancel. */
export function KeyInput({ placeholder, onDone }: { placeholder: string; onDone: (value: string) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  const finish = () => {
    if (done.current) return;
    done.current = true;
    onDone(ref.current?.value.trim() ?? "");
  };
  return (
    <div className="ol-keybox" data-keep>
      <input
        ref={ref}
        className="ol-keyinput"
        type="password"
        placeholder={placeholder}
        autoComplete="off"
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        onKeyDown={(e) => {
          if (e.key === "Enter") ref.current?.blur();
        }}
        onBlur={finish}
      />
      <p className="ol-keynote">金鑰只會存在這台裝置的瀏覽器裡</p>
    </div>
  );
}
