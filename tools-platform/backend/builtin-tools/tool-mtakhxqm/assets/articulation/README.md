# Articulation base images

These two unlabelled base illustrations were generated with the built-in OpenAI
image generation tool for the Arabic pronunciation module. The page adds all
contact markers, airflow paths, lip outlines, and teaching text at runtime.

- `vocal-tract-side.png`: neutral sagittal speech-tract base, generated without
  labels or arrows so every Arabic letter can reuse it.
- `mouth-front.png`: neutral front mouth base, generated without labels or
  arrows so code can overlay vowel-dependent lip shapes.

The generation prompts requested clean, medically plausible educational
illustrations with unobstructed anatomy, a white background, cyan-compatible
accents, and no text, labels, arrows, numbers, or watermarks.

## Runtime integration (checked 2026-10-28)

These are static teaching bases, not a medical diagnostic model. The classroom code draws letter-specific overlays; replacing an image requires checking overlay alignment and all letter/vowel views in [classroom.js](../../classroom.js). Preserve filenames, aspect ratios, and unlabelled anatomy. Images ship with the built-in tool and need no remote image service at runtime. See the [audio notes](../../audio/README.md) for speech assets; these images do not produce sound.
