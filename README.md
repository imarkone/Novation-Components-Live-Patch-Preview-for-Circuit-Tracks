# Patch Preview for Circuit Tracks

A free, independent Chrome and Edge extension that plays the selected patch in the web version of Novation Components through your own Circuit Tracks.

![Three audition buttons below Category in an example patch panel](docs/patch-panel.png)

*Illustrative patch panel showing where the three extension buttons appear.*

## Install

1. Download and extract the repository ZIP. Open the folder that contains `manifest.json`.
2. In Chrome open `chrome://extensions`. In Edge open `edge://extensions`.
3. Enable **Developer mode**, click **Load unpacked**, and select that folder. Disable an earlier copy of this extension before loading the new one.
4. Open or refresh [Novation Components](https://components.novationmusic.com/) in the same browser.

## Audition a patch

1. Connect a Circuit Tracks by USB. Listen via its headphone jack or line outputs. Close desktop Components and any DAW using the same MIDI port.
2. Stop playback on Circuit Tracks. The extension uses the default MIDI channel 1 for **Synth 1**.
3. In web Components, open **Circuit Tracks → Packs → Patches** and select a populated slot. The buttons appear beneath **Category**. Allow MIDI and SysEx access if prompted.
4. Try one of the three previews:

   | Button | What it plays |
   | --- | --- |
   | **Single C3/C5** | C3 and C5 separately, each at the same velocity. The extension uses scientific pitch notation, where MIDI 60 is middle C (C4). It sends MIDI notes 48 and 72. |
   | **Melody** | A two-bar C minor rave arpeggio at 144 BPM. |
   | **Chords** | Short rave-style triads. Use a polyphonic patch to hear all three notes together. |

5. Wait for **Original patch restored and verified** before unplugging the device or changing its patch.

## What the preview does

The extension reads the active Synth 1 patch, loads the selected sound into its temporary RAM, and checks the result before playing the notes. It sends Note Off messages, restores the original patch, and checks it again. Auditioning does not write to a saved pack or a preset slot.

The extension runs only on `components.novationmusic.com`. It has no accounts, analytics, or separate server. Patch bytes and MIDI traffic stay on your computer and instrument. This community project is independent of Novation and Focusrite.

## Troubleshooting

- **No buttons** — refresh web Components, open **Patches**, and select one populated slot. Updates to Components may require an extension update.
- **No sound** — check the instrument's audio output, Synth 1 MIDI channel, and permission to access MIDI/SysEx. Close other applications using the MIDI port.
- **Restoration could not be verified** — select your original preset on the hardware again. This restores the saved preset settings. Reloading a saved preset can discard temporary edits you made before auditioning.

The MIDI commands are described in the [Circuit Tracks Programmer's Reference Guide V3](https://fael-downloads-prod.focusrite.com/customer/prod/downloads/circuit_tracks_programmer_s_reference_guide_v3.pdf).

The melody was written for this extension. The chord preview preserves the Gemini-generated MIDI phrase supplied for prior releases.
