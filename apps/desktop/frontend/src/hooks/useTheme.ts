import { useCallback, useEffect, useState } from "react";
import { Events } from "@wailsio/runtime";
import { AppThemeChanged } from "../../bindings/events";
import * as AppService from "../../bindings/github.com/dragonflow/desktop/services/appservice";

export type ThemePreference = "system" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";

function resolveEffectiveTheme(pref: ThemePreference): ResolvedTheme {
  if (pref === "light" || pref === "dark") return pref;
  if (typeof window !== "undefined" && window.matchMedia) {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  return "dark";
}

export function useTheme(initialPref: ThemePreference = "system") {
  const [preference, setPreference] = useState<ThemePreference>(initialPref);
  const [resolved, setResolved] = useState<ResolvedTheme>(() => resolveEffectiveTheme(initialPref));

  const applyDomTheme = useCallback((pref: ThemePreference) => {
    const eff = resolveEffectiveTheme(pref);
    setResolved(eff);
    document.documentElement.setAttribute("data-theme", eff);
  }, []);

  useEffect(() => {
    setPreference(initialPref);
    applyDomTheme(initialPref);
  }, [initialPref, applyDomTheme]);

  useEffect(() => {
    const mq = window.matchMedia?.("(prefers-color-scheme: dark)");
    const onMediaChange = () => {
      if (preference === "system") {
        applyDomTheme("system");
      }
    };
    mq?.addEventListener?.("change", onMediaChange);

    const offEvent = Events.On(AppThemeChanged, (ev) => {
      const next = (ev?.data as ThemePreference) || "system";
      setPreference(next);
      applyDomTheme(next);
    });

    return () => {
      mq?.removeEventListener?.("change", onMediaChange);
      offEvent?.();
    };
  }, [preference, applyDomTheme]);

  const changeTheme = useCallback(
    async (next: ThemePreference) => {
      setPreference(next);
      applyDomTheme(next);
      try {
        await AppService.SetTheme(next);
      } catch {
        // ignore if called before runtime ready
      }
    },
    [applyDomTheme],
  );

  const cycleTheme = useCallback(() => {
    const order: ThemePreference[] = ["system", "light", "dark"];
    const next = order[(order.indexOf(preference) + 1) % order.length];
    void changeTheme(next);
  }, [preference, changeTheme]);

  return { preference, resolved, changeTheme, cycleTheme };
}
