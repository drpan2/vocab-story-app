const ttsState = { queue: [], idx: 0, playing: false, onSentence: null, onDone: null };
let ttsToken = 0;

function speakChapter(sentences, onSentenceStart, onDone) {
  stopSpeak();
  ttsState.queue = sentences;
  ttsState.idx = 0;
  ttsState.playing = true;
  ttsState.onSentence = onSentenceStart;
  ttsState.onDone = onDone;
  speakNext();
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

function advanceOneSentence() {
  if (!ttsState.playing) return;
  ttsToken++;
  ttsState.idx++;
  speechSynthesis.cancel();
  speakNext();
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
  const utter = new SpeechSynthesisUtterance(word);
  utter.lang = 'en-US';
  speechSynthesis.speak(utter);
}
