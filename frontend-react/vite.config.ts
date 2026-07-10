// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths, nitro (build-only using cloudflare as a default target),
//     componentTagger (dev-only), VITE_* env injection, @ path alias, React/TanStack dedupe,
//     error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const apiBase = "http://127.0.0.1:8000";
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function resolveBackendPython() {
  if (process.env.PYTHON) return process.env.PYTHON;

  const candidates = [
    process.env.CONDA_PREFIX ? join(process.env.CONDA_PREFIX, "python.exe") : "",
    resolve(repoRoot, ".venv", "Scripts", "python.exe"),
    resolve(repoRoot, ".venv", "bin", "python"),
  ].filter(Boolean);

  const localPython = candidates.find((candidate) => existsSync(candidate));
  if (localPython) return localPython;

  return process.platform === "win32" ? "python" : "python3";
}

const backendPython = resolveBackendPython();
let backendProcess: ChildProcessWithoutNullStreams | null = null;
let backendStartPromise: Promise<void> | null = null;

async function backendIsReady() {
  try {
    const response = await fetch(`${apiBase}/health`, { signal: AbortSignal.timeout(2000) });
    return response.ok;
  } catch {
    return false;
  }
}

async function waitForBackend() {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 45000) {
    if (await backendIsReady()) return;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 500));
  }
  throw new Error("FastAPI backend did not become ready on http://127.0.0.1:8000.");
}

function startBackendIfNeeded() {
  if (backendStartPromise) return backendStartPromise;

  backendStartPromise = (async () => {
    if (await backendIsReady()) return;

    console.log("[scholar-e] Starting FastAPI backend on http://127.0.0.1:8000...");
    backendProcess = spawn(backendPython, ["server.py"], {
      cwd: repoRoot,
      stdio: "inherit",
      shell: false,
      env: {
        ...process.env,
        PYTHONUNBUFFERED: "1",
      },
    });

    backendProcess.on("exit", (code) => {
      backendProcess = null;
      backendStartPromise = null;
      if (code !== 0 && code !== null) {
        console.warn(`[scholar-e] FastAPI backend exited with code ${code}.`);
      }
    });

    await waitForBackend();
  })();

  return backendStartPromise;
}

function lazyBackendPlugin() {
  return {
    name: "scholar-e-lazy-backend",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith("/api/")) {
          next();
          return;
        }

        try {
          await startBackendIfNeeded();
          next();
        } catch (error) {
          const message = error instanceof Error ? error.message : "Failed to start backend.";
          res.statusCode = 503;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ detail: message }));
        }
      });

      const stopBackend = () => {
        if (backendProcess && !backendProcess.killed) {
          backendProcess.kill();
        }
      };
      process.once("SIGINT", stopBackend);
      process.once("SIGTERM", stopBackend);
      process.once("exit", stopBackend);
    },
  };
}

function isKnownExternalUnusedImportWarning(warning: { code?: string; message?: string; exporter?: string }) {
  if (warning.code !== "UNUSED_EXTERNAL_IMPORT") return false;
  const exporter = warning.exporter ?? "";
  const message = warning.message ?? "";
  return (
    exporter.startsWith("@tanstack/router-core") ||
    message.includes('external module "@tanstack/router-core')
  );
}

export default defineConfig({
  vite: {
    plugins: [lazyBackendPlugin()],
    build: {
      rollupOptions: {
        onwarn(warning, warn) {
          if (isKnownExternalUnusedImportWarning(warning)) return;
          warn(warning);
        },
      },
    },
    server: {
      proxy: {
        "/api": apiBase,
      },
    },
  },
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
});
