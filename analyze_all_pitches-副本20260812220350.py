import numpy as np
import soundfile as sf
import os
import sys

def detect_pitch_yin(data, sr, frame_size=1024, hop=256, threshold=0.15):
    """Simple YIN pitch detection"""
    results = []
    for start in range(0, len(data) - frame_size, hop):
        frame = data[start:start+frame_size]
        rms = np.sqrt(np.mean(frame**2))
        if rms < 0.005:
            continue
        
        # YIN difference function
        yin = np.zeros(frame_size // 2)
        for tau in range(1, frame_size // 2):
            diff = frame[:-tau] - frame[tau:]
            yin[tau] = np.sum(diff**2)
        
        # Cumulative mean normalized difference
        yin[0] = 1
        running_sum = 0
        for tau in range(1, frame_size // 2):
            running_sum += yin[tau]
            if running_sum > 0:
                yin[tau] = yin[tau] * tau / running_sum
        
        # Find first dip below threshold
        tau = 2
        while tau < frame_size // 2:
            if yin[tau] < threshold:
                # Refine with parabolic interpolation
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
    
    pitches = detect_pitch_yin(data, sr)
    if not pitches:
        return None, None, None, None
    
    midi_vals = [p[1] for p in pitches]
    median_midi = np.median(midi_vals)
    rounded = round(median_midi)
    
    note_names = ['C','Cs','D','Ds','E','F','Fs','G','Gs','A','As','B']
    octave = (rounded // 12) - 1
    note_idx = rounded % 12
    detected = f"{octave}{note_names[note_idx]}"
    cents = (median_midi - rounded) * 100
    
    return median_midi, detected, round(cents), len(pitches)

# Analyze X Studio segments
print("=" * 60)
print("X Studio segments (source files)")
print("=" * 60)
seg_dir = r'E:\git_repo\music-games\voice_test\xstudio_segments'

# Expected MIDI mapping
note_to_midi = {'C':0,'Cs':1,'D':2,'Ds':3,'E':4,'F':5,'Fs':6,'G':7,'Gs':8,'A':9,'As':10,'B':11}

for fname in sorted(os.listdir(seg_dir)):
    if not fname.endswith('.wav'):
        continue
    path = os.path.join(seg_dir, fname)
    midi, detected, cents, n = analyze_file(path)
    
    # Parse expected from filename
    base = fname.replace('.wav', '')
    if '#' in base:
        note_name = base[:-1].replace('#','s')
        oct_num = int(base[-1])
        expected_midi = (oct_num + 1) * 12 + note_to_midi[note_name]
    else:
        note_name = base[:-1]
        oct_num = int(base[-1])
        expected_midi = (oct_num + 1) * 12 + note_to_midi[note_name]
    
    # Our naming convention (4Ds = D#4)
    our_name = f"{oct_num}{note_name}"
    
    diff = midi - expected_midi if midi else 0
    match = "OK" if abs(diff) < 0.5 else ("OFF by " + str(round(diff, 1)))
    
    print(f"  {fname:<10} -> MIDI {midi:>5.1f} = {detected:<5} ({cents:+.0f}c) | expected MIDI {expected_midi} = {our_name:<5} | {match}")

# Analyze v10b answer files
print()
print("=" * 60)
print("v10b answer files (all)")
print("=" * 60)
v10b_dir = r'E:\git_repo\music-games-demo\v10b\assets\audio'

for fname in sorted(os.listdir(v10b_dir)):
    if not fname.endswith('.wav') or fname.startswith('question_'):
        continue
    path = os.path.join(v10b_dir, fname)
    midi, detected, cents, n = analyze_file(path)
    
    base = fname.replace('.wav', '')
    oct_num = int(base[0])
    note_part = base[1:]
    expected_midi = (oct_num + 1) * 12 + note_to_midi.get(note_part, -99)
    
    diff = midi - expected_midi if midi and expected_midi > 0 else 0
    match = "OK" if abs(diff) < 0.5 else ("*** OFF by " + str(round(diff, 1)) + " ***")
    
    print(f"  {fname:<10} -> MIDI {midi:>5.1f} = {detected:<5} ({cents:+.0f}c) | expected MIDI {expected_midi} = {base:<5} | {match}")
