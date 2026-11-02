/** The gateway config as one shared state: every tab reads it and saves through save(). */

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { api } from "./api";
import type { GatewayConfig } from "./types";

interface ConfigState {
  config: GatewayConfig | null;
  /** Problems with the stored config, if someone saved a broken one by hand. */
  errors: string[];
  missingSecrets: string[];
  loadError: unknown;
  reload: () => Promise<void>;
  /** Throws ApiError with the server's reasons when the config is invalid or changed elsewhere. */
  save: (next: GatewayConfig) => Promise<void>;
}

const ConfigContext = createContext<ConfigState | null>(null);

export function ConfigProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<GatewayConfig | null>(null);
  const [hash, setHash] = useState("");
  const [errors, setErrors] = useState<string[]>([]);
  const [missingSecrets, setMissingSecrets] = useState<string[]>([]);
  const [loadError, setLoadError] = useState<unknown>(null);

  const reload = useCallback(async () => {
    try {
      const data = await api<{ config: GatewayConfig; hash: string; errors: string[]; missingSecrets: string[] }>("GET", "/config");
      setConfig(data.config);
      setHash(data.hash);
      setErrors(data.errors);
      setMissingSecrets(data.missingSecrets);
      setLoadError(null);
    } catch (err) {
      setLoadError(err);
    }
  }, []);

  useEffect(() => void reload(), [reload]);

  const save = useCallback(
    async (next: GatewayConfig) => {
      const { hash: newHash } = await api<{ hash: string }>("PUT", "/config", { config: next, baseHash: hash });
      setConfig(next);
      setHash(newHash);
      setErrors([]);
    },
    [hash],
  );

  return <ConfigContext.Provider value={{ config, errors, missingSecrets, loadError, reload, save }}>{children}</ConfigContext.Provider>;
}

export function useConfig(): ConfigState {
  const ctx = useContext(ConfigContext);
  if (!ctx) throw new Error("useConfig outside ConfigProvider");
  return ctx;
}
