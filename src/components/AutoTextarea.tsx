import { forwardRef, useImperativeHandle, useLayoutEffect, useRef } from "react";

interface Props {
  value: string;
  onChange: (v: string) => void;
  className?: string;
}

export const AutoTextarea = forwardRef<HTMLTextAreaElement, Props>(function AutoTextarea(
  { value, onChange, className },
  ref,
) {
  const el = useRef<HTMLTextAreaElement>(null);
  useImperativeHandle(ref, () => el.current!);
  useLayoutEffect(() => {
    const t = el.current!;
    t.style.height = "0px";
    t.style.height = t.scrollHeight + "px";
  }, [value]);
  return (
    <textarea
      ref={el}
      rows={1}
      className={"ol-field " + (className ?? "")}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      spellCheck={false}
      autoCorrect="off"
    />
  );
});
