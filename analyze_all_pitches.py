import numpy as np
import soundfile as sf
import os

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

def analyze_file(path):
    data, sr = sf.read(path)
    if data.ndim > 1:
        data = data[:, 0]
    duration_ms = int(len(data) / sr * 1000)
    pitches = detect_pitch_yin(data, sr)
    if not pitches:
        return None, None, None, duration_ms
    midi_vals = [p[1] for p in pitches]
    median_midi = np.median(midi_vals)
    rounded = round(median_midi)
    note_names = ['C','Cs','D','Ds','E','F','Fs','G','Gs','A','As','B']
    octave = (rounded // 12) - 1
    note_idx = rounded % 12
    detected = f"{octave}{note_names[note_idx]}"
    cents = (median_midi - rounded) * 100
    return median_midi, detected, round(cents), duration_ms

note_names = ['C','Cs','D','Ds','E','F','Fs','G','Gs','A','As','B']

# === X Studio segments ===
print("=" * 70)
print("X Studio segments: ACTUAL pitch + duration")
print("=" * 70)
seg_dir = r'E:\git_repo\music-games\voice_test\xstudio_segments'

actual_map = {}  # actual_note -> (filename, midi, cents, duration)

for fname in sorted(os.listdir(seg_dir)):
    if not fname.endswith('.wav'):
        continue
    path = os.path.join(seg_dir, fname)
    midi, detected, cents, dur = analyze_file(path)
    print(f"  {fname:<10}  actual={detected:<5} (MIDI {midi:.1f}, {cents:+.0f}c)  duration={dur}ms")
    actual_map[detected] = (fname, midi, cents, dur)

print()
print("=" * 70)
print("SUMMARY: What notes do we actually HAVE from X Studio?")
print("=" * 70)
for note in sorted(actual_map.keys(), key=lambda n: (int(n[0]), note_names.index(n[1:]))):
    fname, midi, cents, dur = actual_map[note]
    print(f"  {note:<5}  (from {fname:<10}, MIDI {midi:.1f}, {cents:+.0f}c, {dur}ms)")

# === v10b answer files ===
print()
print("=" * 70)
print("v10b answer files: actual pitch + duration")
print("=" * 70)
v10b_dir = r'E:\git_repo\music-games-demo\v10b\assets\audio'
for fname in sorted(os.listdir(v10b_dir)):
    if not fname.endswith('.wav') or fname.startswith('question_'):
        continue
    path = os.path.join(v10b_dir, fname)
    midi, detected, cents, dur = analyze_file(path)
    base = fname.replace('.wav','')
    match = "OK" if detected == base else f"WRONG (is {detected})"
    print(f"  {fname:<10}  labeled={base:<5} actual={detected:<5}  dur={dur}ms  {match}")
