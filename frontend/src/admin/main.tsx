import "@fontsource-variable/inter";
import "@fontsource/instrument-serif/400.css";
import "../styles/tokens.css";
import "../styles/base.css";
import "../styles/ui.css";
import "../styles/shell.css";
import "../styles/features.css";
import "../styles/admin.css";

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { ThemeProvider, ToastProvider } from "../context/ui";
import Admin from "./Admin";

// The control centre: its own page, served on its own host.
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <ThemeProvider>
        <ToastProvider>
          <Admin />
        </ToastProvider>
      </ThemeProvider>
    </BrowserRouter>
  </StrictMode>,
);
