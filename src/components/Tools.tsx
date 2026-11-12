import { useEffect, useRef, useState } from "react";
import { KeyInput } from "./KeyInput.tsx";

export function Tools({
  hasKey,
  onKey,
  onExport,
  onImport,
}: {
  hasKey: boolean;
  onKey: (k: string) => void;
  onExport: () => Promise<string>;
  onImport: (file: File) => Promise<string>;
}) {
  const [editing, setEditing] = useState(false);
  const [msg, setMsg] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const timer = useRef(0);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const flash = (m: string) => {
    setMsg(m);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setMsg(""), 2600);
  };
  return (
    <div className="ol-tools" data-keep>
      <div>
        <button type="button" className="ol-link" onClick={() => setEditing(true)}>
          AI 金鑰
        </button>
        {" · "}
        <button type="button" className="ol-link" onClick={() => void onExport().then(flash)}>
          匯出備份
        </button>
        {" · "}
        <button type="button" className="ol-link" onClick={() => fileRef.current?.click()}>
          匯入備份
        </button>
        {msg && <span className="ol-toolmsg">{msg}</span>}
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="application/json,.json"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) void onImport(f).then(flash);
        }}
      />
      {editing && (
        <>
          <KeyInput
            placeholder={hasKey ? "已設定，貼上新的金鑰可更換" : "貼上 Gemini API 金鑰"}
            onDone={(v) => {
              setEditing(false);
              if (v) onKey(v);
            }}
          />
          {hasKey && (
            <button
              type="button"
              className="ol-link"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                setEditing(false);
                onKey("");
              }}
            >
              清除金鑰
            </button>
          )}
        </>
      )}
    </div>
  );
}
