import { createRoot } from "react-dom/client";
import "@fontsource-variable/inter";
import "./styles.css";
import { App } from "./App.tsx";

for (const ev of ["gesturestart", "gesturechange", "gestureend"]) {
  document.addEventListener(ev, (e) => e.preventDefault());
}
createRoot(document.getElementById("root")!).render(<App />);

try {
  void navigator.storage?.persist?.();
} catch {
  /* ignore */
}

try {
  void navigator.storage?.persist?.();
} catch {
  /* ignore */
}
