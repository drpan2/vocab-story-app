const ttsState = { queue: [], idx: 0, playing: false, onSentence: null, onDone: null };
let ttsToken = 0;

// WebKit (Safari / iOS Chrome, which is Safari under the hood) silently drops
// speak() if it's called in the same tick as a preceding cancel(). A short
// delay after cancel() avoids this — a well-known iOS Web Speech API quirk.
const CANCEL_SETTLE_MS = 80;

function speakChapter(sentences, startIndex, onSentenceStart, onDone) {
  ttsToken++;
  ttsState.playing = false;
  speechSynthesis.cancel();
  ttsState.queue = sentences;
  ttsState.idx = startIndex || 0;
  ttsState.playing = true;
  ttsState.onSentence = onSentenceStart;
  ttsState.onDone = onDone;
  setTimeout(speakNext, CANCEL_SETTLE_MS);
}

function speakNext() {
  if (!ttsState.playing || ttsState.idx >= ttsState.queue.length) {
    const wasPlaying = ttsState.playing;
    ttsState.playing = false;
    if (wasPlaying) ttsState.onDone && ttsState.onDone();
    return;
  }
  const myToken = ++ttsToken;
  const i = ttsState.idx;
  ttsState.onSentence && ttsState.onSentence(i);
  const utter = new SpeechSynthesisUtterance(ttsState.queue[i]);
  utter.lang = 'en-US';
  const advance = () => {
    if (myToken !== ttsToken) return;
    if (!ttsState.playing) return;
    ttsState.idx++;
    speakNext();
  };
  utter.onend = advance;
  utter.onerror = advance;
  speechSynthesis.speak(utter);
}

// Tapping a sentence during auto-read re-reads that exact sentence (handy for
// listening practice), then playback continues forward from there as usual.
function replaySentence(index) {
  if (!ttsState.playing) return;
  if (index < 0 || index >= ttsState.queue.length) return;
  ttsToken++;
  ttsState.idx = index;
  speechSynthesis.cancel();
  setTimeout(speakNext, CANCEL_SETTLE_MS);
}

function stopSpeak() {
  ttsToken++;
  ttsState.playing = false;
  speechSynthesis.cancel();
}

function speakSingleWord(word) {
  ttsToken++;
  ttsState.playing = false;
  speechSynthesis.cancel();
  setTimeout(() => {
    const utter = new SpeechSynthesisUtterance(word);
    utter.lang = 'en-US';
    speechSynthesis.speak(utter);
  }, CANCEL_SETTLE_MS);
}
