import "./tauri.ts";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Frame } from "./Frame.tsx";
import { Playground } from "./Playground.tsx";
import "./playground.css";

const isFrame = new URLSearchParams(location.search).has("frame");

createRoot(document.getElementById("root")!).render(
  <StrictMode>{isFrame ? <Frame /> : <Playground />}</StrictMode>,
);
