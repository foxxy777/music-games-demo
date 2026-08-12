"""
1. Take the split X Studio segments (currently named by expected note)
2. YIN detect actual pitch of each segment
3. Rename to actual detected pitch
4. Handle duplicates (keep best one)
5. For missing notes, pitch-shift from nearest
6. Normalize duration to 2000ms
7. Deploy to v10b
"""
import numpy as np
import soundfile as sf
import os
import subprocess
import tempfile

def detect_pitch_yin(data, sr, frame_size=1024, hop=256, threshold=0.15):
    pitches = []
    for start in range(0, len(data) - frame_size, hop):
        frame_data = data[start:start+frame_size]
        rms_val = np.sqrt(np.mean(frame_data**2))
        if rms_val < 0.005:
            continue
        yin = np.zeros(frame_size // 2)
        for tau in range(1, frame_size // 2):
            diff = frame_data[:-tau] - frame_data[tau:]
            yin[tau] = np.sum(diff**2)
        yin[0] = 1
        running_sum = 0
        for tau in range(1, frame_size // 2):
            running_sum += yin[tau]
            if running_sum > 0:
                yin[tau] = yin[tau] * tau / running_sum
        tau = 2
        while tau < frame_size // 2:
            if yin[tau] < threshold:
                if tau > 0 and tau < frame_size // 2 - 1:
                    x0, x1, x2 = yin[tau-1], yin[tau], yin[tau+1]
                    denom = 2 * (2*x1 - x0 - x2)
                    if abs(denom) > 1e-6:
                        shift = (x0 - x2) / denom
                        tau_refined = tau + shift
                    else:
                        tau_refined = tau
                else:
                    tau_refined = tau
                freq = sr / tau_refined
                if 80 < freq < 1200:
                    midi = 69 + 12 * np.log2(freq / 440)
                    pitches.append(midi)
                break
            tau += 1
    return pitches

note_names = ['C','Cs','D','Ds','E','F','Fs','G','Gs','A','As','B']
TARGET_NOTES = [
    (55,'3G'),(56,'3Gs'),(57,'3A'),(58,'3As'),(59,'3B'),
    (60,'4C'),(61,'4Cs'),(62,'4D'),(63,'4Ds'),(64,'4E'),
    (65,'4F'),(66,'4Fs'),(67,'4G'),(68,'4Gs'),(69,'4A'),
    (70,'4As'),(71,'4B'),
    (72,'5C'),(73,'5Cs'),(74,'5D'),(75,'5Ds'),(76,'5E'),
    (77,'5F'),(78,'5Fs'),(79,'5G'),(80,'5Gs'),(81,'5A'),
]

def midi_to_name(midi):
    rounded = round(midi)
    octave = (rounded // 12) - 1
    note = note_names[rounded % 12]
    return f"{octave}{note}"

def trim_and_normalize(data, sr, target_ms=2000):
    # Trim silence from start
    frame = 128
    if data.ndim > 1:
        mono = data[:, 0]
    else:
        mono = data
    rms = np.array([np.sqrt(np.mean(mono[i:i+frame]**2)) for i in range(0, len(mono)-frame, frame)])
    max_rms = np.max(rms) if len(rms) > 0 else 0
    if max_rms > 0:
        thr = max_rms * 0.05
        onset = int(np.argmax(rms > thr)) * frame
        if onset > sr * 0.01:
            data = data[onset:]
    
    # Normalize duration
    target_samples = int(target_ms / 1000 * sr)
    if len(data) > target_samples:
        data = data[:target_samples]
    elif len(data) < target_samples:
        if data.ndim > 1:
            pad = np.zeros((target_samples - len(data), data.shape[1]), dtype=data.dtype)
        else:
            pad = np.zeros(target_samples - len(data), dtype=data.dtype)
        data = np.concatenate([data, pad])
    return data

# === Step 1: Analyze all split files ===
src_dir = r'E:\git_repo\music-games\voice_test\xstudio_split_new'
print("=== Analyzing X Studio segments ===")

detected_notes = {}  # actual_midi -> (filepath, cents_off, quality)

for fname in sorted(os.listdir(src_dir)):
    if not fname.endswith('.wav'):
        continue
    path = os.path.join(src_dir, fname)
    data, sr = sf.read(path)
    if data.ndim > 1:
        data = data[:, 0]
    
    pitches = detect_pitch_yin(data, sr)
    if not pitches:
        print(f"  {fname}: NO PITCH")
        continue
    
    median_midi = np.median(pitches)
    rounded = round(median_midi)
    cents = (median_midi - rounded) * 100
    actual_name = midi_to_name(median_midi)
    
    # Quality = how close to exact semitone + how many frames detected
    quality = abs(cents)
    
    print(f"  {fname} -> actual={actual_name} (MIDI {median_midi:.1f}, {cents:+.0f}c)")
    
    # Keep best quality per actual note
    if rounded not in detected_notes or quality < detected_notes[rounded][2]:
        detected_notes[rounded] = (path, median_midi, quality)

print(f"\nDetected {len(detected_notes)} unique notes:")
for midi in sorted(detected_notes.keys()):
    name = midi_to_name(midi)
    path, actual_midi, cents = detected_notes[midi]
    print(f"  MIDI {midi} = {name}  ({cents:.0f}c off)")

# === Step 2: Plan generation ===
print("\n=== Planning ===")
plan = []  # (target_name, target_midi, source_path, shift_semitones)

for target_midi, target_name in TARGET_NOTES:
    if target_midi in detected_notes:
        src = detected_notes[target_midi][0]
        plan.append((target_name, target_midi, src, 0))
    else:
        # Find nearest
        available = sorted(detected_notes.keys())
        nearest = min(available, key=lambda m: abs(m - target_midi))
        shift = target_midi - nearest
        src = detected_notes[nearest][0]
        plan.append((target_name, target_midi, src, shift))
        print(f"  {target_name} (MIDI {target_midi}): shift {shift:+d} from MIDI {nearest} ({midi_to_name(nearest)})")

# === Step 3: Generate ===
print("\n=== Generating ===")
tmp_dir = tempfile.mkdtemp()
out_dir = r'E:\git_repo\music-games-demo\v10b\assets\audio'

# Clear old files
for f in os.listdir(out_dir):
    if f.endswith('.wav'):
        os.remove(os.path.join(out_dir, f))

for target_name, target_midi, src_path, shift in plan:
    if shift != 0:
        ratio = 2 ** (shift / 12.0)
        tmp_path = os.path.join(tmp_dir, f"{target_name}_shifted.wav")
        subprocess.run(['ffmpeg', '-y', '-i', src_path, '-af', f'rubberband=pitch={ratio}', tmp_path], capture_output=True)
        work_path = tmp_path
    else:
        work_path = src_path
    
    data, sr = sf.read(work_path)
    data = trim_and_normalize(data, sr, 2000)
    
    # Verify
    mono = data[:, 0] if data.ndim > 1 else data
    pitches = detect_pitch_yin(mono, sr)
    if pitches:
        actual = np.median(pitches)
        diff = actual - target_midi
        status = f"OK ({diff:+.1f})" if abs(diff) < 0.6 else f"warn ({diff:+.1f})"
    else:
        status = "no pitch"
    
    # Save both answer and question
    sf.write(os.path.join(out_dir, f"{target_name}.wav"), data, sr)
    sf.write(os.path.join(out_dir, f"question_{target_name}.wav"), data, sr)
    
    print(f"  {target_name:<5} (MIDI {target_midi}): {status}  [2000ms]")

# Cleanup
import shutil
shutil.rmtree(tmp_dir, ignore_errors=True)

# === Summary ===
files = [f for f in os.listdir(out_dir) if f.endswith('.wav')]
print(f"\nDone! {len(files)} files ({len(files)//2} notes x 2)")
