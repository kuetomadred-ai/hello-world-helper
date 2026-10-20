// Single-process entry for free hosts (Render/Railway/Fly): runs the API and the price-watching worker together.
// Both modules start themselves on import.
await import("./api.js");
await import("./worker.js");
