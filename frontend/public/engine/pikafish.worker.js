// Classic Web Worker adapter for the modularized Emscripten build produced by
// ousc/Pikafish-wasm. The UI communicates with this file using plain UCI lines.

let engine = null;
let bootError = null;
const pendingCommands = [];

function reportBootError(error) {
  bootError = error instanceof Error ? error : new Error(String(error));
  self.postMessage({
    type: "error",
    message: bootError.message,
    stack: bootError.stack || "",
  });
}

self.addEventListener("error", (event) => {
  if (engine) return;
  const detail = event.error?.stack || event.error?.message || event.message || String(event.error || "unknown worker error");
  reportBootError(new Error(detail));
  event.preventDefault();
});

self.addEventListener("unhandledrejection", (event) => {
  if (engine) return;
  reportBootError(event.reason);
  event.preventDefault();
});

function assetUrl(name) {
  return new URL(name, self.location.href).href;
}

function runCommand(command) {
  if (bootError) {
    self.postMessage(`info string WASM engine failed to start: ${bootError.message}`);
    return;
  }
  if (!engine) {
    pendingCommands.push(command);
    return;
  }
  engine.send_command(command);
}

self.onmessage = (event) => {
  if (typeof event.data === "string") runCommand(event.data);
};

try {
  importScripts(assetUrl("pikafish.js"));
  Pikafish({
    // Emscripten would otherwise invoke the no-op CLI main() and emit an
    // ExitStatus before the exported UCI bridge receives its first command.
    noInitialRun: true,
    locateFile: (name) => assetUrl(name),
    read_stdout: (line) => self.postMessage(line),
    printErr: (line) => self.postMessage({ type: "diagnostic", message: String(line) }),
    onAbort: (reason) => reportBootError(new Error(`Emscripten abort: ${String(reason)}`)),
  })
    .then((module) => {
      engine = module;
      for (const command of pendingCommands.splice(0)) runCommand(command);
    })
    .catch((error) => {
      reportBootError(error);
    });
} catch (error) {
  reportBootError(error);
}
