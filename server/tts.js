const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

// ─── Multi-language voice mapping ───────────────────────
const LANGUAGE_VOICES = {
  en: 'en-US-GuyNeural',
  hi: 'hi-IN-MadhurNeural',
  es: 'es-ES-AlvaroNeural',
  fr: 'fr-FR-HenriNeural',
  de: 'de-DE-ConradNeural',
  ja: 'ja-JP-KeitaNeural',
  ko: 'ko-KR-InJoonNeural',
  zh: 'zh-CN-YunxiNeural',
  pt: 'pt-BR-AntonioNeural',
  ar: 'ar-SA-HamedNeural',
  ru: 'ru-RU-DmitryNeural',
  it: 'it-IT-DiegoNeural',
  te: 'te-IN-MohanNeural',
  ta: 'ta-IN-ValluvarNeural',
};

// ─── Language detection (non-Latin scripts ONLY, dominance-gated) ───────
// We detect language *only* from unambiguous non-Latin Unicode scripts, and
// only when such a script clearly dominates the text.
//
// We deliberately do NOT guess Latin-script languages (es/fr/de/it/pt) from
// common-word lists. That was the cause of the "half my reply is in a weird
// accent" bug: words like "do", "as", "per", "la", "que" are everyday ENGLISH,
// so an ordinary English clause matched the Portuguese/Italian/Spanish word
// lists and got synthesized with a foreign neural voice — and because TTS runs
// clause-by-clause, one clause spoke in en-US and the next in pt-BR. For Latin
// script we now always keep the user's configured voice, which is correct for
// English (and for whatever Latin-script voice they've chosen). Real Latin
// multi-language detection needs a proper detector (e.g. `franc`), not regex.
//
// Dominance gate: a clause must have >=30% of its letters in a non-Latin script
// before we switch, so a lone foreign name inside an English sentence does not
// flip the whole clause to a foreign voice.
const NON_LATIN_SCRIPTS = [
  ['hi', /[ऀ-ॿ]/g], // Devanagari (Hindi)
  ['te', /[ఀ-౿]/g], // Telugu
  ['ta', /[஀-௿]/g], // Tamil
  ['ja', /[぀-ゟ゠-ヿ]/g], // Japanese kana
  ['ko', /[가-힯]/g], // Korean Hangul
  ['zh', /[一-鿿]/g], // Chinese Han
  ['ar', /[؀-ۿ]/g], // Arabic
  ['ru', /[Ѐ-ӿ]/g], // Cyrillic (Russian)
];

function detectLanguage(text) {
  const letters = (text.match(/\p{L}/gu) || []).length;
  if (letters === 0) return 'en';
  for (const [lang, re] of NON_LATIN_SCRIPTS) {
    const count = (text.match(re) || []).length;
    if (count / letters >= 0.3) return lang;
  }
  return 'en'; // Latin / mostly-Latin → use the configured voice
}

// ─── Emotion → TTS parameter mapping ───────────────────
const EMOTION_PARAMS = {
  excited:    { rate: '+15%', pitch: '+8Hz' },
  happy:      { rate: '+10%', pitch: '+5Hz' },
  empathetic: { rate: '-10%', pitch: '-3Hz' },
  sad:        { rate: '-15%', pitch: '-5Hz' },
  calm:       { rate: '-5%',  pitch: '-2Hz' },
  serious:    { rate: '-5%',  pitch: '-4Hz' },
  urgent:     { rate: '+12%', pitch: '+3Hz' },
  neutral:    { rate: '+5%',  pitch: '+0Hz' },
};

class TTSService {
  constructor(voice = 'en-US-GuyNeural') {
    this.voice = voice;
    this.audioDir = path.join(__dirname, '..', 'audio');
    if (!fs.existsSync(this.audioDir)) fs.mkdirSync(this.audioDir, { recursive: true });
    this.counter = 0;
    this.emotion = 'neutral';
  }

  setVoice(voice) {
    this.voice = voice;
  }

  setEmotion(emotion) {
    this.emotion = EMOTION_PARAMS[emotion] ? emotion : 'neutral';
  }

  // ─── Natural speech preprocessing ───────────────────────
  // Add prosody hints for more natural-sounding TTS
  static preprocessForNaturalSpeech(text) {
    let processed = text
      .replace(/[*_~`#]/g, '')           // Remove markdown
      .replace(/\n+/g, '. ')             // Newlines to pauses
      .replace(/\.{3}/g, '... ')         // Ellipsis → longer pause
      .replace(/—/g, ', ')               // Em-dash → comma pause
      .replace(/\(([^)]+)\)/g, ', $1, ') // Parentheticals → commas
      .replace(/(\d+)\s*%/g, '$1 percent') // 50% → 50 percent
      .replace(/&/g, ' and ')            // & → and
      .replace(/\s{2,}/g, ' ')           // Collapse whitespace
      .trim();

    return processed;
  }

  // Generate audio file from text, return the file path
  synthesize(text, emotion = null) {
    return new Promise((resolve, reject) => {
      const filename = `tts_${Date.now()}_${this.counter++}.mp3`;
      const filepath = path.join(this.audioDir, filename);

      // Natural speech preprocessing
      const cleanText = TTSService.preprocessForNaturalSpeech(text);
      if (!cleanText) return reject(new Error('Empty text'));

      // Get emotion parameters
      const emo = emotion || this.emotion;
      const params = EMOTION_PARAMS[emo] || EMOTION_PARAMS.neutral;

      // Auto-detect language and switch voice if needed
      const lang = detectLanguage(cleanText);
      const voice = (lang !== 'en' && LANGUAGE_VOICES[lang]) ? LANGUAGE_VOICES[lang] : this.voice;

      const proc = spawn('python3', [
        '-m', 'edge_tts',
        '--text', cleanText,
        '--voice', voice,
        '--write-media', filepath,
        '--rate', params.rate,
        '--pitch', params.pitch,
      ]);

      let stderr = '';
      let settled = false;
      proc.stderr.on('data', d => stderr += d.toString());

      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        proc.kill();
        reject(new Error('TTS timeout'));
      }, 10000);

      proc.on('close', code => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (code === 0 && fs.existsSync(filepath)) {
          resolve({ filepath, filename });
        } else {
          reject(new Error(`TTS failed: ${stderr}`));
        }
      });

      proc.on('error', err => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(err);
      });
    });
  }

  // Clean up old audio files
  cleanup(maxAge = 300000) { // 5 minutes
    const now = Date.now();
    try {
      const files = fs.readdirSync(this.audioDir);
      files.forEach(f => {
        const fp = path.join(this.audioDir, f);
        const stat = fs.statSync(fp);
        if (now - stat.mtimeMs > maxAge) fs.unlinkSync(fp);
      });
    } catch (e) { /* ignore */ }
  }
}

// ─── Reduced Latency: Clause-level splitting ─────────────
// Instead of waiting for full sentences (. ! ?), also split on
// clauses (commas, dashes, colons) once we have enough text.
// This means TTS starts ~40-60% sooner on long sentences.

const SENTENCE_END = /[.!?;]\s|[.!?]$/;
const CLAUSE_SPLIT = /[,\-:—]\s/;
const MIN_CLAUSE_LENGTH = 30; // Only split clauses if buffer > 30 chars

function shouldSplitForTTS(buffer) {
  // Always split on sentence end
  if (SENTENCE_END.test(buffer)) {
    return 'sentence';
  }
  // Split on clause boundary if buffer is getting long
  if (buffer.length >= MIN_CLAUSE_LENGTH && CLAUSE_SPLIT.test(buffer)) {
    return 'clause';
  }
  return null;
}

// Split buffer at the best TTS break point
// Returns { toSpeak, remaining }
function splitAtBreak(buffer, splitType) {
  if (splitType === 'sentence') {
    const match = buffer.match(SENTENCE_END);
    if (match) {
      const idx = match.index + match[0].length;
      return { toSpeak: buffer.slice(0, idx).trim(), remaining: buffer.slice(idx) };
    }
  }
  if (splitType === 'clause') {
    // Find the last clause boundary
    let lastIdx = -1;
    let m;
    const re = new RegExp(CLAUSE_SPLIT.source, 'g');
    while ((m = re.exec(buffer)) !== null) {
      if (m.index >= 15) { // Don't split too early
        lastIdx = m.index + m[0].length;
      }
    }
    if (lastIdx > 0) {
      return { toSpeak: buffer.slice(0, lastIdx).trim(), remaining: buffer.slice(lastIdx) };
    }
  }
  return null;
}

TTSService.shouldSplitForTTS = shouldSplitForTTS;
TTSService.splitAtBreak = splitAtBreak;

module.exports = TTSService;
