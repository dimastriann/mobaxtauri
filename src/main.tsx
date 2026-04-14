import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { Provider } from "./components/ui/provider";
import "./index.css";

// Disable default browser context menu in production for a more native feel, except in terminal
if (import.meta.env.PROD) {
  document.addEventListener('contextmenu', (e) => {
    // Allow native context menu inside xterm
    if (e.target instanceof Element && e.target.closest('.xterm')) {
      return;
    }
    e.preventDefault();
  });
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <Provider defaultTheme="dark">
      <App />
    </Provider>
  </React.StrictMode>,
);
