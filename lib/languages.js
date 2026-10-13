'use strict';

// Single source of truth for supported languages and verified bulbul:v4-flash speakers.
// The browser receives this list via GET /api/config.
const LANGUAGES = {
  'hi-IN': {
    label: 'Hindi / Hinglish',
    short: 'हिं',
    speakers: [
      { id: 'ratan_hi_sports', label: 'Ratan (sports)' },
      { id: 'simran_hi_social_excited', label: 'Simran (excited)' },
      { id: 'sunny_hi_reels', label: 'Sunny (reels)' },
      { id: 'ritu_hi_reels', label: 'Ritu (reels)' },
      { id: 'shubh_enhi_ads', label: 'Shubh (Hinglish ads)' },
    ],
    style:
      'Hinglish: Hindi written in Devanagari, naturally mixed with English cricket words ' +
      '(सिक्स, फोर, बाउंड्री, विकेट, यॉर्कर, कैच, एलबीडब्ल्यू) also written in Devanagari.',
  },
  'ta-IN': {
    label: 'Tamil / Tanglish',
    short: 'த',
    speakers: [
      { id: 'aravind_ta_ads', label: 'Aravind (ads)' },
      { id: 'gokul_ta_narration', label: 'Gokul (narration)' },
    ],
    style:
      'Tanglish: Tamil written in Tamil script, naturally mixed with English cricket words ' +
      '(சிக்ஸ், ஃபோர், பவுண்டரி, விக்கெட், யார்க்கர், கேட்ச்) also written in Tamil script.',
  },
  'te-IN': {
    label: 'Telugu',
    short: 'తె',
    speakers: [
      { id: 'tarun_te_narration', label: 'Tarun (narration)' },
      { id: 'kavitha_te_conversation', label: 'Kavitha (conversation)' },
    ],
    style:
      'Telugu written in Telugu script, naturally mixed with English cricket words ' +
      '(సిక్స్, ఫోర్, బౌండరీ, వికెట్, యార్కర్, క్యాచ్) also written in Telugu script.',
  },
  'bn-IN': {
    label: 'Bengali',
    short: 'বা',
    speakers: [
      { id: 'bimal_bn_suspense', label: 'Bimal (suspense)' },
      { id: 'arnab_bn_conversation', label: 'Arnab (conversation)' },
    ],
    style:
      'Bengali written in Bengali script, naturally mixed with English cricket words ' +
      '(ছক্কা, চার, বাউন্ডারি, উইকেট, ইয়র্কার, ক্যাচ) also written in Bengali script.',
  },
  'en-IN': {
    label: 'English',
    short: 'EN',
    speakers: [
      { id: 'ashwin_en_sports_energetic', label: 'Ashwin (sports, energetic)' },
      { id: 'shubh_en_sports', label: 'Shubh (sports)' },
      { id: 'ritu_en_reels', label: 'Ritu (reels)' },
    ],
    style:
      'Indian English, the way a TV commentator in India would say it; a desi phrase now and then is welcome.',
  },
};

const DEFAULT_LANG = 'hi-IN';

function isLang(code) {
  return Object.prototype.hasOwnProperty.call(LANGUAGES, code);
}

function resolveSpeaker(lang, speaker) {
  const list = LANGUAGES[lang].speakers;
  return list.some((s) => s.id === speaker) ? speaker : list[0].id;
}

function publicConfig() {
  return {
    defaultLang: DEFAULT_LANG,
    languages: Object.entries(LANGUAGES).map(([code, l]) => ({
      code,
      label: l.label,
      short: l.short,
      speakers: l.speakers,
    })),
  };
}

module.exports = { LANGUAGES, DEFAULT_LANG, isLang, resolveSpeaker, publicConfig };
