// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths, nitro (build-only using cloudflare as a default target),
//     componentTagger (dev-only), VITE_* env injection, @ path alias, React/TanStack dedupe,
//     error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const apiBase = "http://127.0.0.1:8000";
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
let backendProcess: ChildProcessWithoutNullStreams | null = null;
let backendStartPromise: Promise<void> | null = null;

async function backendIsReady() {
  try {
    const response = await fetch(`${apiBase}/health`, { signal: AbortSignal.timeout(800) });
    return response.ok;
  } catch {
    return false;
  }
}

async function waitForBackend() {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 15000) {
    if (await backendIsReady()) return;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 300));
  }
  throw new Error("FastAPI backend did not become ready on http://127.0.0.1:8000.");
}

function startBackendIfNeeded() {
  if (backendStartPromise) return backendStartPromise;

  backendStartPromise = (async () => {
    if (await backendIsReady()) return;

    console.log("[scholar-e] Starting FastAPI backend on http://127.0.0.1:8000...");
    backendProcess = spawn("python", ["server.py"], {
      cwd: repoRoot,
      stdio: "inherit",
      shell: process.platform === "win32",
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

export default defineConfig({
  vite: {
    plugins: [lazyBackendPlugin()],
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
