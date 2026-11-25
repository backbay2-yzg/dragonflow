import { useEffect, useState } from "react";
import { WML } from "@wailsio/runtime";
import { MainApp } from "./windows/MainApp";
import { TrayFlyout } from "./windows/TrayFlyout";

function resolveRoute(): "main" | "flyout" {
  return window.location.hash.startsWith("#/flyout") ? "flyout" : "main";
}

export default function App() {
  const [route, setRoute] = useState<"main" | "flyout">(resolveRoute);

  useEffect(() => {
    const onHashChange = () => setRoute(resolveRoute());
    window.addEventListener("hashchange", onHashChange);
    WML.Reload();
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  return route === "flyout" ? <TrayFlyout /> : <MainApp />;
}
