// Isolated-world helper: reads the CSV data files shipped with the extension and hands them to random.js (MAIN world).
// The MAIN world has no chrome.runtime, so the files travel through window.postMessage.
(() => {
  "use strict";
  const FILES = { lang: "data/lang.csv", recipes: "data/recipes.csv", phrases: "data/phrases.csv", corpus: "data/corpus.csv", levels: "data/levels.csv" };
  let cache = null;

  async function readFiles() {
    if (cache) return cache;
    const out = {};
    for (const [name, path] of Object.entries(FILES)) {
      const response = await fetch(chrome.runtime.getURL(path));
      out[name] = await response.text();
    }
    cache = out;
    return out;
  }

  async function send() {
    window.postMessage({ source: "ctrnd-loader", type: "data", files: await readFiles() }, window.location.origin);
  }

  window.addEventListener("message", event => {
    if (event.source === window && event.data && event.data.source === "ctrnd-main" && event.data.type === "need-data") send();
  });
  // Also push once, in case random.js was loaded before this listener existed.
  send();
})();
