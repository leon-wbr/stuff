import { useEffect, useRef } from "react";
import { App } from "../../desktop/src/App.tsx";
import { Stuff, useWorld } from "../../desktop/src/app.ts";

export const THEME_MESSAGE = "stuff-playground-theme";

const tokens = document.createElement("style");
addEventListener("message", (e: MessageEvent<{ type?: string; css?: string }>) => {
  if (e.data?.type !== THEME_MESSAGE) return;
  tokens.textContent = e.data.css ?? "";
  document.head.append(tokens);
});

/** Opens the view (and editor) named in the URL once the store has loaded. */
function Director() {
  const { send } = Stuff.useActorRef();
  const loaded = Stuff.useSelector((s) => !s.matches({ data: "loading" }));
  const w = useWorld();
  const done = useRef(false);
  useEffect(() => {
    if (!loaded || done.current) return;
    done.current = true;
    const params = new URLSearchParams(location.search);
    const byTitle = (title: string) =>
      [...w.todos, ...w.projects].find((t) => t.title === title)?.id ?? null;
    const view = params.get("view") ?? "today";
    send({
      type: "view",
      view: view.startsWith("project:") ? `project:${byTitle(view.slice(8))}` : (view as "today"),
    });
    const edit = params.get("edit");
    if (edit) send({ type: "edit", id: byTitle(edit) });
  }, [loaded, w, send]);
  return null;
}

export function Frame() {
  return (
    <Stuff.Provider>
      <Director />
      <App />
    </Stuff.Provider>
  );
}
