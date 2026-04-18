// Typing test logic — word stream, stats, event emission
(function () {
  const BEGINNER = (
    "the of and to in a is that for it as with on be by at this from you or have an not but are which one they we will all their can her if would there been has so what when who about our out into up out other more some could said two like your time only its"
    + " do these do then than them these over also new any work first well way even want because any these same those after through before under between during where why how while until each how much many still good great right back too part because must again much never still young little old big small long short high low next under next first last much less more own own same under even most less now before again still then where why both own people world hand life day"
  ).split(/\s+/).filter(Boolean);

  // Famous book quotes — classic literature, public domain. Original phrasing preserved.
  const QUOTES = [
    "it was the best of times it was the worst of times it was the age of wisdom it was the age of foolishness",
    "all happy families are alike every unhappy family is unhappy in its own way",
    "call me ishmael some years ago never mind how long precisely having little or no money in my purse",
    "it is a truth universally acknowledged that a single man in possession of a good fortune must be in want of a wife",
    "in a hole in the ground there lived a hobbit not a nasty dirty wet hole filled with the ends of worms",
    "all this happened more or less the war parts anyway are pretty much true",
    "happy families are all alike every unhappy family is unhappy in its own way",
    "who is john galt the man asked the question he did not know he was about to change the world",
    "the sky above the port was the color of television tuned to a dead channel",
    "it was a bright cold day in april and the clocks were striking thirteen",
    "mother died today or maybe yesterday i cannot be sure the telegram from the home does not say",
    "you dont know about me without you have read a book by the name of the adventures of tom sawyer",
    "many years later as he faced the firing squad colonel aureliano buendia was to remember that distant afternoon",
    "there was no possibility of taking a walk that day we had been wandering in the leafless shrubbery",
    "last night i dreamt i went to manderley again it seemed to me i stood by the iron gate",
    "all children except one grow up they soon know that they will grow up and she knew",
    "the past is a foreign country they do things differently there",
    "not all those who wander are lost the old that is strong does not wither deep roots are not reached by the frost",
    "to be or not to be that is the question whether tis nobler in the mind to suffer",
    "we shall fight on the beaches we shall fight on the landing grounds we shall fight in the fields and in the streets",
  ];

  function shuffle(a) {
    const out = a.slice();
    for (let i = out.length - 1; i > 0; i--) {
      const j = (Math.random() * (i + 1)) | 0;
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  }

  function makeText(n, mode) {
    if (mode === 'quotes') {
      const out = [];
      const queue = shuffle(QUOTES);
      let qi = 0;
      while (out.length < n) {
        if (qi >= queue.length) qi = 0;
        out.push(...queue[qi].split(/\s+/));
        qi++;
      }
      return out.slice(0, Math.max(n, 60));
    }
    // beginner
    const pool = Array.from(new Set(BEGINNER));
    const out = [];
    let prev = '';
    for (let i = 0; i < n; i++) {
      let w;
      do { w = pool[(Math.random() * pool.length) | 0]; } while (w === prev);
      out.push(w);
      prev = w;
    }
    return out;
  }

  class TypingTest {
    constructor({ promptEl, inputEl, onEvent, durationSec = 30, mode = 'beginner' }) {
      this.promptEl = promptEl;
      this.inputEl = inputEl;
      this.onEvent = onEvent || (() => {});
      this.durationSec = durationSec;
      this.mode = mode;
      this.reset();

      inputEl.addEventListener('keydown', (e) => this._onKey(e));
      inputEl.addEventListener('input', () => this._onInput());
    }

    reset(durationSec, mode) {
      if (durationSec) this.durationSec = durationSec;
      if (mode) this.mode = mode;
      this.words = makeText(80, this.mode);
      this.wordIndex = 0;       // index of current word
      this.charIndex = 0;       // index within current word
      this.typed = this.words.map(w => '');
      this.correctPerWord = this.words.map(w => new Array(w.length).fill(null)); // null|true|false
      this.errorCount = 0;
      this.correctChars = 0;
      this.typedChars = 0;
      this.completedWords = 0;
      this.started = false;
      this.ended = false;
      this.startMs = 0;
      this.endMs = 0;
      this.currentWPM = 0;
      this.currentAcc = 100;
      this.inputEl.value = '';
      this.render();
    }

    start() {
      if (this.started) return;
      this.started = true;
      this.startMs = performance.now();
      this.onEvent({ type: 'start' });
      this._tickHandle = setInterval(() => this._tick(), 120);
    }

    end() {
      if (this.ended) return;
      this.ended = true;
      this.endMs = performance.now();
      clearInterval(this._tickHandle);
      this.onEvent({
        type: 'end',
        wpm: this.currentWPM, accuracy: this.currentAcc,
        errors: this.errorCount, chars: this.typedChars,
      });
    }

    _tick() {
      const now = performance.now();
      const elapsed = (now - this.startMs) / 1000;
      const remaining = Math.max(0, this.durationSec - elapsed);

      // WPM = (correct chars / 5) / minutes
      const mins = Math.max(0.001, elapsed / 60);
      this.currentWPM = Math.round((this.correctChars / 5) / mins);
      this.currentAcc = this.typedChars === 0 ? 100
        : Math.max(0, Math.round(100 * (this.correctChars / this.typedChars)));

      this.onEvent({
        type: 'tick',
        wpm: this.currentWPM, accuracy: this.currentAcc,
        errors: this.errorCount, remaining,
      });

      if (remaining <= 0) this.end();
    }

    _onKey(e) {
      if (this.ended) return;
      if (e.key === 'Escape' || e.key === 'Tab') {
        e.preventDefault();
        this.onEvent({ type: 'restart' });
        return;
      }
      if (e.key === ' ') {
        e.preventDefault();
        this._handleSpace();
        return;
      }
      if (e.key === 'Backspace') {
        e.preventDefault();
        this._handleBackspace();
        return;
      }
      if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        this._handleChar(e.key);
      }
    }

    _onInput() {
      // we handle via keydown; clear any noise
      this.inputEl.value = '';
    }

    _handleChar(ch) {
      if (!this.started) this.start();
      if (this.ended) return;

      const word = this.words[this.wordIndex];
      const expected = word[this.charIndex];
      this.typedChars++;

      if (this.charIndex < word.length) {
        const ok = ch === expected;
        this.correctPerWord[this.wordIndex][this.charIndex] = ok;
        this.typed[this.wordIndex] += ch;
        this.charIndex++;
        if (ok) {
          this.correctChars++;
          this.onEvent({ type: 'char-ok' });
        } else {
          this.errorCount++;
          // grid approximation of X position for rock drop (0..1 across prompt)
          const progress = this.wordIndex / this.words.length;
          this.onEvent({ type: 'typo', progress });
        }
      } else {
        // overshoot (typed past word length) — count as error, don't advance
        this.typed[this.wordIndex] += ch;
        this.errorCount++;
        this.onEvent({ type: 'typo', progress: this.wordIndex / this.words.length });
      }
      this.render();
    }

    _handleBackspace() {
      if (this.charIndex === 0) {
        if (this.wordIndex === 0) return;
        // move to end of previous word
        this.wordIndex--;
        this.charIndex = this.typed[this.wordIndex].length;
        // undo completion
        if (this.completedWords > 0) this.completedWords--;
      } else {
        this.charIndex--;
        const ch = this.typed[this.wordIndex].slice(-1);
        this.typed[this.wordIndex] = this.typed[this.wordIndex].slice(0, -1);
        // undo correctPerWord state
        if (this.charIndex < this.correctPerWord[this.wordIndex].length) {
          const wasCorrect = this.correctPerWord[this.wordIndex][this.charIndex];
          this.correctPerWord[this.wordIndex][this.charIndex] = null;
          if (wasCorrect === true) this.correctChars = Math.max(0, this.correctChars - 1);
          this.typedChars = Math.max(0, this.typedChars - 1);
        }
      }
      this.render();
    }

    _handleSpace() {
      if (!this.started) this.start();
      if (this.ended) return;
      const word = this.words[this.wordIndex];

      // Word is considered "completed correctly" only if fully typed correctly
      const allCorrect = this.charIndex === word.length
        && this.correctPerWord[this.wordIndex].every(v => v === true);

      // Count space char
      this.typedChars++;
      this.correctChars++; // treat space as correct if word was right-ish; simple

      if (allCorrect) {
        this.completedWords++;
        this.onEvent({ type: 'word-complete', progress: this.wordIndex / this.words.length });
      } else {
        // incomplete word skip — mark remainders as errors once
        const missing = word.length - this.charIndex;
        if (missing > 0) this.errorCount += missing;
        this.onEvent({ type: 'word-skipped', progress: this.wordIndex / this.words.length });
      }
      this.wordIndex++;
      this.charIndex = 0;

      // top up if near end
      if (this.wordIndex > this.words.length - 10) {
        const extra = makeText(40, this.mode);
        this.words.push(...extra);
        this.typed.push(...extra.map(_ => ''));
        this.correctPerWord.push(...extra.map(w => new Array(w.length).fill(null)));
      }
      this.render();
    }

    render() {
      // Show 3 lines worth — scroll so current word is on second line.
      const el = this.promptEl;
      // Render all words with markup; CSS will clip to 2 lines.
      // We'll compute a sliding window to keep current visible.
      const frag = document.createDocumentFragment();
      // Show ~24 words around current
      const start = Math.max(0, this.wordIndex - 6);
      const end = Math.min(this.words.length, start + 40);
      for (let i = start; i < end; i++) {
        const wspan = document.createElement('span');
        wspan.className = 'w';
        const w = this.words[i];
        const typed = this.typed[i];
        const marks = this.correctPerWord[i];
        for (let j = 0; j < w.length; j++) {
          const ch = document.createElement('span');
          ch.className = 'ch';
          ch.textContent = w[j];
          if (i < this.wordIndex) {
            if (marks[j] === true) ch.classList.add('ok');
            else if (marks[j] === false) ch.classList.add('bad');
          } else if (i === this.wordIndex) {
            if (j < this.charIndex) {
              if (marks[j] === true) ch.classList.add('ok');
              else ch.classList.add('bad');
            }
            if (j === this.charIndex) ch.classList.add('cur');
          }
          wspan.appendChild(ch);
        }
        // extra-typed characters beyond word length
        if (i === this.wordIndex && typed.length > w.length) {
          const extra = typed.slice(w.length);
          for (const c of extra) {
            const ch = document.createElement('span');
            ch.className = 'ch bad';
            ch.textContent = c;
            wspan.appendChild(ch);
          }
        }
        // trailing space caret for a word fully typed but space not yet pressed
        if (i === this.wordIndex && this.charIndex === w.length) {
          const spacer = document.createElement('span');
          spacer.className = 'ch cur';
          spacer.textContent = '\u00a0';
          wspan.appendChild(spacer);
        }
        frag.appendChild(wspan);
      }
      el.innerHTML = '';
      el.appendChild(frag);
    }
  }

  window.TypingTest = TypingTest;
})();
