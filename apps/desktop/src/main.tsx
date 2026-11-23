import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import { Stuff } from "./app.ts";
import "./app.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Stuff.Provider>
      <App />
    </Stuff.Provider>
  </StrictMode>,
);
