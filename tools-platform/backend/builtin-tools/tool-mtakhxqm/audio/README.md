# Arabic neural audio assets

These files are AI-generated speech, not recordings of human speakers.

- Egyptian Arabic: `ar-EG-SalmaNeural` (female)
- Modern Standard Arabic text: `ar-SA-ZariyahNeural` (female)
- Encoding: MP3, 24 kHz, mono, 48 kbps
- Speaking rate: `-12%` for language-learning clarity

`manifest.json` maps each lesson string, individual word, Arabic letter, and
vowelled letter exercise to its Egyptian and/or standard-Arabic audio files.
Letter audio speaks the Arabic letter name (for example, `ب` plays `باء`). The
syllable collection covers every one of the 28 letters with fatḥa, kasra, ḍamma,
and sukūn/ending practice. Regenerate the assets from the tool directory with:

```bash
EDGE_TTS_BIN=/absolute/path/to/edge-tts node generate-neural-audio.mjs
```

## Classroom overrides and distribution (checked 2026-10-28)

The curated classroom uses `drill-manifest.json` and `drill-audit.json` in addition to the general `manifest.json` library. Classroom clips use Salma at `-8%`; the `-12%` setting above describes the general library. `library-audit.json` records the library audit. Generated speech remains synthetic.

From the tool directory, audit classroom assets without regenerating speech:

```bash
node generate-classroom-audio.cjs --audit
```

Generation uses `generate-classroom-audio.cjs` and requires the speech and media tools referenced there. It writes audio/manifests; run only when updating speech assets. The versioned `audio.bundle.zip` distributes audio, with `pack-audio.mjs` and `unpack-audio.mjs` managing the bundle. At project level `npm run assets:ensure` restores bundled assets and `npm run assets:pack-audio` rebuilds the bundle. Documentation edits do not require regeneration or repacking.
