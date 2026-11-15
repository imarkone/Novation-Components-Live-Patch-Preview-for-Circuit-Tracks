(() => {
  "use strict";

  const boxId = "marek-circuit-tracks-preview";
  const downloadSelector = 'button[data-test-download][aria-label="Download selected Patch" i]:not([disabled])';
  const patchHeader = [0xf0, 0x00, 0x20, 0x29, 0x01, 0x64, 0x00, 0x00, 0x00];
  const dumpRequest = [0xf0, 0x00, 0x20, 0x29, 0x01, 0x64, 0x40, 0x00, 0xf7];
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  // Scientific pitch notation (middle C is MIDI 60 / C4).
  const singleNotes = [48, 72].map(note => ({
    notes: [note], duration: 650, gap: 250, velocity: 96
  }));

  // Two bars on a 16-step grid. C minor with a repeated low C and short offbeat notes.
  const arpStepMs = 60000 / 144 / 4;
  const arpPattern = [
    [0, 48, 115], [2, 60, 94], [3, 55, 104], [5, 48, 113], [6, 63, 96],
    [8, 48, 112], [10, 55, 103], [11, 60, 95], [13, 58, 103], [14, 55, 99],
    [16, 48, 115], [18, 60, 94], [19, 55, 104], [21, 48, 113], [22, 63, 96],
    [24, 48, 112], [26, 55, 103], [27, 60, 95], [29, 55, 103], [30, 48, 115]
  ];
  const raveArp = arpPattern.map(([step, note, velocity], index) => ({
    notes: [note],
    duration: arpStepMs * 0.55,
    gap: ((arpPattern[index + 1]?.[0] ?? 32) - step - 0.55) * arpStepMs,
    velocity
  }));

  // The supplied rave stabs use 480 ticks per quarter and 434782 μs per quarter.
  function fromTicks(events) {
    const tickMs = 434782 / 480000;
    return events.map(([notes, ticks, pause, velocity]) => ({
      notes, duration: ticks * tickMs, gap: pause * tickMs, velocity
    }));
  }

  const chords = fromTicks([
    [[48, 55, 62], 180, 180, 115],
    [[48, 55, 62], 180, 180, 110],
    [[46, 53, 60], 240, 240, 115],
    [[46, 53, 60], 240, 240, 110],
    [[48, 55, 62], 180, 60, 105],
    [[44, 51, 55], 660, 60, 115],
    [[46, 53, 60], 180, 60, 110],
    [[48, 55, 62], 300, 180, 115],
    [[46, 53, 60], 360, 120, 110],
    [[48, 55, 62], 180, 180, 115],
    [[48, 55, 62], 180, 180, 110],
    [[46, 53, 60], 240, 240, 115],
    [[46, 53, 60], 240, 240, 110],
    [[48, 55, 62], 180, 60, 105],
    [[44, 51, 55], 660, 60, 115],
    [[46, 53, 60], 180, 60, 110],
    [[48, 55, 62], 300, 180, 115],
    [[46, 53, 60], 360, 0, 110],
  ]);
  let busy = false;

  function isSynth1Patch(bytes) {
    return bytes.length === 350 &&
      patchHeader.every((byte, index) => byte === bytes[index]) &&
      bytes[349] === 0xf7 &&
      bytes.subarray(9, 349).every(byte => byte < 128);
  }

  function readPatch(input, output) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        input.removeEventListener("midimessage", receive);
        reject(new Error("Circuit Tracks did not return the current Synth 1 patch."));
      }, 2000);
      function receive(event) {
        const bytes = event.data;
        if (!isSynth1Patch(bytes)) return;
        clearTimeout(timer);
        input.removeEventListener("midimessage", receive);
        resolve(Uint8Array.from(bytes));
      }
      input.addEventListener("midimessage", receive);
      try {
        output.send(dumpRequest);
      } catch (error) {
        clearTimeout(timer);
        input.removeEventListener("midimessage", receive);
        reject(error);
      }
    });
  }

  async function getPorts(access) {
    function select(ports) {
      const candidates = [...ports.values()].filter(port =>
        port.state === "connected" &&
        /circuit\s*tracks/i.test(port.name ?? "") &&
        !/(?:\bmidi|\bport)\s*[23]\b/i.test(port.name ?? "")
      );
      if (candidates.length !== 1) {
        throw new Error("Could not identify a single Circuit Tracks USB MIDI port.");
      }
      return candidates[0];
    }
    const input = select(access.inputs);
    const output = select(access.outputs);
    await Promise.all([input.open(), output.open()]);
    return { input, output };
  }

  function selectedPatchBytes(download) {
    // Components builds a SysEx Blob synchronously when Download Patch is clicked.
    // Capture only its matching download and restore the browser methods immediately.
    const create = URL.createObjectURL;
    const anchorClick = HTMLAnchorElement.prototype.click;
    const candidateBlobs = new Map();
    let selectedBlob;
    try {
      URL.createObjectURL = function createPreviewURL(blob) {
        const url = create.call(URL, blob);
        if (blob instanceof Blob && blob.size === 350) candidateBlobs.set(url, blob);
        return url;
      };
      HTMLAnchorElement.prototype.click = function clickPreviewDownload() {
        const blob = candidateBlobs.get(this.href);
        if (blob && /\.syx$/i.test(this.download)) {
          selectedBlob = blob;
          return;
        }
        anchorClick.call(this);
      };
      download.click();
    } finally {
      URL.createObjectURL = create;
      HTMLAnchorElement.prototype.click = anchorClick;
    }

    if (!selectedBlob) throw new Error("Components did not provide a patch. No MIDI was sent.");
    return selectedBlob.arrayBuffer().then(buffer => {
      const bytes = new Uint8Array(buffer);
      if (!isSynth1Patch(bytes)) throw new Error("The selected file is not a supported Circuit Tracks Synth 1 patch.");
      return bytes;
    });
  }

  function assertSamePatch(expected, actual, message) {
    if (!expected.every((byte, index) => byte === actual[index])) throw new Error(message);
  }

  async function playPreview(input, output, selected, phrase, status) {
    status("Reading the current Synth 1 patch…");
    const original = await readPatch(input, output);
    const activeNotes = new Set();
    let operationError;
    try {
      output.send(selected);
      await sleep(100);
      assertSamePatch(selected, await readPatch(input, output),
        "Circuit Tracks did not confirm the preview patch byte for byte.");
      status("Playing preview…");
      for (const {notes, duration, gap, velocity} of phrase) {
        for (const note of notes) {
          activeNotes.add(note);
          output.send([0x90, note, velocity]);
        }
        await sleep(duration);
        for (const note of notes) {
          output.send([0x80, note, 0]);
          activeNotes.delete(note);
        }
        await sleep(gap);
      }
    } catch (error) {
      operationError = error;
    } finally {
      for (const note of activeNotes) {
        try {
          output.send([0x80, note, 0]);
        } catch {
          // Continue to the independent restoration attempt.
        }
      }
      status("Restoring the original patch…");
      try {
        output.send(original);
        await sleep(100);
        assertSamePatch(original, await readPatch(input, output), "The restored patch did not match the original.");
      } catch (error) {
        throw new Error("Could not verify restoration. Select the original preset again on Circuit Tracks. " + error.message);
      }
    }
    if (operationError) throw new Error(operationError.message + " The original patch was restored.");
  }

  async function run(download, phrase, status) {
    if (busy) return;
    busy = true;
    const buttons = document.getElementById(boxId)?.querySelectorAll("button") ?? [];
    for (const button of buttons) button.disabled = true;

    try {
      if (!navigator.requestMIDIAccess) throw new Error("Open this page in Chrome or Edge with Web MIDI support.");
      status("Waiting for USB MIDI access…");
      const [selected, access] = await Promise.all([
        selectedPatchBytes(download),
        navigator.requestMIDIAccess({ sysex: true })
      ]);
      const { input, output } = await getPorts(access);
      await playPreview(input, output, selected, phrase, status);
      status("Preview complete. Original patch restored and verified.");
    } catch (error) {
      status(error.message ?? String(error));
    } finally {
      busy = false;
      for (const button of buttons) button.disabled = false;
    }
  }

  function placeButton() {
    const onPacks = /^\/circuit-tracks\/packs(?:\/|$)/.test(location.pathname);
    const download = onPacks && document.querySelector(downloadSelector);
    const panel = download && download.closest(".sidebar__container");
    const category = panel && panel.querySelector("[data-test-category-select]");
    const existing = document.getElementById(boxId);
    if (!category) {
      if (!busy) existing?.remove();
      return;
    }
    if (existing) {
      if (existing.previousElementSibling === category || busy) return;
      existing.remove();
    }

    const box = document.createElement("div");
    box.id = boxId;
    box.style.cssText = "display:block;align-self:stretch;margin:6px 0;color:inherit;";
    const message = document.createElement("div");
    message.setAttribute("role", "status");
    message.style.cssText = "font-size:11px;line-height:1.4;overflow-wrap:anywhere;margin-top:4px;";
    for (const [label, phrase] of [["▶ Single C3/C5", singleNotes], ["▶ Melody", raveArp], ["▶ Chords", chords]]) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = label;
      button.style.cssText = "width:100%;margin-bottom:4px;padding:7px;background:#2c4bc6;color:white;border:1px solid #7796ff;border-radius:3px;cursor:pointer;";
      button.addEventListener("click", () => {
        const selectedDownload = panel.querySelector(downloadSelector);
        if (!selectedDownload) {
          message.textContent = "Select one populated patch slot.";
          return;
        }
        return run(selectedDownload, phrase, value => { message.textContent = value; });
      });
      box.append(button);
    }
    box.append(message);
    category.after(box);
  }

  new MutationObserver(placeButton).observe(document.body, { childList: true, subtree: true });
  placeButton();
})();
