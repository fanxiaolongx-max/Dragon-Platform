import os, torch, numpy as np, wave, sys
from transformers import AutoProcessor, MusicgenForConditionalGeneration
out=sys.argv[1]; total=float(sys.argv[2]); seed=int(sys.argv[3]) if len(sys.argv)>3 else 7
torch.manual_seed(seed)
import os
dev=os.environ.get("BGM_DEV","cpu")
name="facebook/musicgen-small"
proc=AutoProcessor.from_pretrained(name); model=MusicgenForConditionalGeneration.from_pretrained(name).to(dev)
sr=model.config.audio_encoder.sampling_rate
prompt=os.environ["BGM_PROMPT"]
TOK=50  # tokens per second
inp=proc(text=[prompt],padding=True,return_tensors="pt").to(dev)
audio=model.generate(**inp,do_sample=True,guidance_scale=3.5,max_new_tokens=int(10*TOK))[0,0].float().cpu().numpy()
print("chunk",len(audio)/sr,flush=True)
while len(audio)/sr<total:
    ctx=audio[-int(5*sr):]
    inp=proc(audio=ctx,sampling_rate=sr,text=[prompt],padding=True,return_tensors="pt").to(dev)
    new=model.generate(**inp,do_sample=True,guidance_scale=3.5,max_new_tokens=int(10*TOK))[0,0].float().cpu().numpy()
    audio=np.concatenate([audio[:-int(5*sr)],new]); print("len",len(audio)/sr,flush=True)
audio=audio/ (np.abs(audio).max()+1e-9)*0.89
with wave.open(out,"wb") as w:
    w.setnchannels(1);w.setsampwidth(2);w.setframerate(sr);w.writeframes((audio*32767).astype(np.int16).tobytes())
print("done",out,len(audio)/sr)
