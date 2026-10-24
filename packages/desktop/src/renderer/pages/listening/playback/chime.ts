/** Browser copy of the host chime (`trackMedia.tone`): two faded 0.35 s sine beeps 0.45 s apart. */
const BEEP_SECONDS = 0.35;
const SECOND_BEEP_AT = 0.45;
const FADE_IN = 0.02;
const FADE_OUT_AT = 0.25;
const VOLUME = 0.4;
const FREQUENCIES = { start: [660, 880], end: [880, 660] } as const;

/** Schedule the chime at context time `when`; returns a function that stops it early. */
export function scheduleChime(
  context: BaseAudioContext,
  preset: 'start' | 'end',
  when: number,
  destination: AudioNode
): () => void {
  const nodes = FREQUENCIES[preset].map((frequency, index) => {
    const start = when + index * SECOND_BEEP_AT;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.frequency.value = frequency;
    oscillator.connect(gain).connect(destination);
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(VOLUME, start + FADE_IN);
    gain.gain.setValueAtTime(VOLUME, start + FADE_OUT_AT);
    gain.gain.linearRampToValueAtTime(0, start + BEEP_SECONDS);
    oscillator.start(start);
    oscillator.stop(start + BEEP_SECONDS);
    return oscillator;
  });
  return () =>
    nodes.forEach((node) => {
      try {
        node.stop();
      } catch {
        // Already stopped.
      }
    });
}
