/* V16 防空版 · 谜底曲数据 → 波次构建
 * 数据源：tools/make_song.py 生成 assets/songs/canghai.js|json（window.V16_SONG）
 * 一波导弹 = 谜底曲一段的音符集：音高=哪格，时值=何时到
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.V16 = root.V16 || {};
  Object.assign(root.V16, api);
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';
  const R = typeof self !== 'undefined' ? self : globalThis;
  const { foldCell, midiToCell, clamp } = (R.V16 || {});

  // 时值（拍）→ 导弹血量：短音 1 / 中音 2 / 长音 3
  function durHp(w) { return w < 1.5 ? 1 : (w < 2.5 ? 2 : 3); }

  // 取一波：tierIdx 移调档（0..2），segIdx 段号（0..3，3=Boss 高潮段）
  function getWave(songData, tierIdx, segIdx) {
    if (!songData || !songData.tiers || !songData.segments) throw new Error('谜底曲数据未生成（先跑 tools/make_song.py）');
    const tier = songData.tiers[tierIdx];
    if (!tier) throw new Error('移调档不存在: ' + tierIdx);
    const seg = songData.segments[segIdx];
    if (!seg) throw new Error('曲段不存在: ' + segIdx);
    const tseg = tier.segs[segIdx];
    const beatSec = 60 / songData.tempo;
    const notes = tseg.notes.map((n, i) => {
      const cell = foldCell(midiToCell(n.m));
      return {
        id: 'm' + segIdx + '_' + i,
        cell,
        beat: n.b,          // 到达拍（时值=何时到）
        dur: n.w,
        hp: durHp(n.w),
        midi: n.m,
      };
    });
    const beats = Math.max(...notes.map(n => n.beat + n.dur));
    return {
      idx: segIdx,
      name: seg.name,
      boss: !!seg.boss,
      beats,
      tempo: songData.tempo,
      listenBeatSec: beatSec,     // 听辨阶段节拍（原速）
      notes,
      total: notes.length,
    };
  }

  // 全部波次（TB 用）
  function getAllWaves(songData, tierIdx) {
    return songData.segments.map((_, i) => getWave(songData, tierIdx, i));
  }

  // 移调档随机（白键框架内 ±2~+9 半音的 3 档预生成：C=-2 / D=0 / G=+5）
  function pickTier(songData, rng) {
    return rng.int(0, songData.tiers.length - 1);
  }

  // 音频文件路径（MuseScore4 预渲染；assets/audio/t{档}s{段}.mp3）
  function audioFile(tierIdx, segIdx) {
    return 'assets/audio/t' + tierIdx + 's' + segIdx + '.mp3';
  }

  return { getWave, getAllWaves, pickTier, audioFile, durHp };
});
