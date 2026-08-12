"""
Rebuild all audio files from scratch.
1. Take X Studio source files, detect their ACTUAL pitch
2. Rename to correct pitch names
3. For missing notes, pitch-shift from nearest available
4. Normalize all to same duration (trim or pad to 2000ms)
5. Trim silence from start
"""
import numpy as np
import soundfile as sf
import os
import subprocess
import tempfile

def detect_pitch_yin(data, sr, frame_size=1024, hop=256, threshold=0.15):
    results = []
    for start in range(0, len(data) - frame_size, hop):
        frame = data[start:start+frame_size]
        rms = np.sqrt(np.mean(frame**2))
        if rms < 0.005:
            continue
        yin = np.zeros(frame_size // 2)
        for tau in range(1, frame_size // 2):
            diff = frame[:-tau] - frame[tau:]
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
                    results.append((freq, midi))
                break
            tau += 1
    return results

def get_actual_pitch(path):
    data, sr = sf.read(path)
    if data.ndim > 1:
        data = data[:, 0]
    pitches = detect_pitch_yin(data, sr)
    if not pitches:
        return None
    return round(np.median([p[1] for p in pitches]))

def trim_silence(data, sr, threshold_ratio=0.03):
    if data.ndim > 1:
        mono = data[:, 0]
    else:
        mono = data
    frame = 256
    rms = np.array([np.sqrt(np.mean(mono[i:i+frame]**2)) for i in range(0, len(mono)-frame, frame)])
    max_rms = np.max(rms) if len(rms) > 0 else 0
    if max_rms < 1e-6:
        return data
    thr = max_rms * threshold_ratio
    onset = int(np.argmax(rms > thr)) * frame
    if onset > sr * 0.01:
        return data[onset:]
    return data

def normalize_duration(data, sr, target_ms=2000):
    target_samples = int(target_ms / 1000 * sr)
    if len(data) > target_samples:
        # Trim from end
        return data[:target_samples]
    elif len(data) < target_samples:
        # Pad with silence at end
        if data.ndim > 1:
            pad = np.zeros((target_samples - len(data), data.shape[1]), dtype=data.dtype)
        else:
            pad = np.zeros(target_samples - len(data), dtype=data.dtype)
        return np.concatenate([data, pad])
    return data

# === Step 1: Build correct map from X Studio sources ===
print("Step 1: Detecting actual pitches of X Studio sources...")
seg_dir = r'E:\git_repo\music-games\voice_test\xstudio_segments'

note_names = ['C','Cs','D','Ds','E','F','Fs','G','Gs','A','As','B']
TARGET_NOTES = [
    (55, '3G'), (56, '3Gs'), (57, '3A'), (58, '3As'), (59, '3B'),
    (60, '4C'), (61, '4Cs'), (62, '4D'), (63, '4Ds'), (64, '4E'),
    (65, '4F'), (66, '4Fs'), (67, '4G'), (68, '4Gs'), (69, '4A'),
    (70, '4As'), (71, '4B'),
    (72, '5C'), (73, '5Cs'), (74, '5D'), (75, '5Ds'), (76, '5E'),
    (77, '5F'), (78, '5Fs'), (79, '5G'), (81, '5A'),
]

# Map: midi_note -> source_file
actual_pitches = {}  # actual_midi -> filepath

for fname in sorted(os.listdir(seg_dir)):
    if not fname.endswith('.wav'):
        continue
    path = os.path.join(seg_dir, fname)
    midi = get_actual_pitch(path)
    if midi:
        rounded = round(midi)
        cents_off = abs(midi - rounded)
        if rounded not in actual_pitches or cents_off < actual_pitches[rounded][2]:
            actual_pitches[rounded] = (path, midi, cents_off)

print(f"X Studio provides {len(actual_pitches)} actual notes:")
for midi in sorted(actual_pitches.keys()):
    path, actual_midi, cents = actual_pitches[midi]
    octave = (midi // 12) - 1
    note = note_names[midi % 12]
    name = f"{octave}{note}"
    print(f"  MIDI {midi} = {name}  (from {os.path.basename(path)}, {cents:.0f}c off)")

# === Step 2: For each target note, find source ===
print("\nStep 2: Planning generation...")
TARGET_DURATION = 2000  # ms

generation_plan = []  # (target_name, target_midi, source_path, semitone_shift)

for midi, name in TARGET_NOTES:
    if midi in actual_pitches:
        # Direct use
        src_path = actual_pitches[midi][0]
        generation_plan.append((name, midi, src_path, 0))
    else:
        # Find nearest available
        available_midis = sorted(actual_pitches.keys())
        nearest = min(available_midis, key=lambda m: abs(m - midi))
        semitone_shift = midi - nearest
        src_path = actual_pitches[nearest][0]
        generation_plan.append((name, midi, src_path, semitone_shift))
        print(f"  {name} (MIDI {midi}): shift {semitone_shift:+d} from MIDI {nearest}")

# === Step 3: Generate all files ===
print("\nStep 3: Generating files...")
out_dir = r'E:\git_repo\music-games-demo\v10b\assets\audio'
tmp_dir = tempfile.mkdtemp()

# Clear old files
for f in os.listdir(out_dir):
    if f.endswith('.wav'):
        os.remove(os.path.join(out_dir, f))

for target_name, target_midi, src_path, shift in generation_plan:
    # Step 3a: pitch shift if needed
    if shift != 0:
        ratio = 2 ** (shift / 12.0)
        tmp_path = os.path.join(tmp_dir, f"{target_name}_shifted.wav")
        subprocess.run([
            'ffmpeg', '-y', '-i', src_path,
            '-af', f'rubberband=pitch={ratio}',
            tmp_path
        ], capture_output=True)
        work_path = tmp_path
    else:
        work_path = src_path
    
    # Step 3b: load, trim silence, normalize duration
    data, sr = sf.read(work_path)
    data = trim_silence(data, sr)
    data = normalize_duration(data, sr, TARGET_DURATION)
    
    # Step 3c: verify pitch
    pitches = detect_pitch_yin(data, sr)
    if pitches:
        actual_midi = np.median([p[1] for p in pitches])
        diff = actual_midi - target_midi
        status = f"OK ({diff:+.1f})" if abs(diff) < 0.6 else f"WARNING diff={diff:+.1f}"
    else:
        status = "NO PITCH DETECTED"
    
    # Save as answer file
    answer_path = os.path.join(out_dir, f"{target_name}.wav")
    sf.write(answer_path, data, sr)
    
    # Copy as question file too
    question_path = os.path.join(out_dir, f"question_{target_name}.wav")
    sf.write(question_path, data, sr)
    
    print(f"  {target_name:<5} (MIDI {target_midi}): {status}  [{TARGET_DURATION}ms]")

# Cleanup tmp
import shutil
shutil.rmtree(tmp_dir, ignore_errors=True)

# === Summary ===
print(f"\nDone! Generated {len(generation_plan)} notes x 2 (question+answer) = {len(generation_plan)*2} files")
print(f"Duration: {TARGET_DURATION}ms each")
