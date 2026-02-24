export function appendAmplitude(
  history: number[],
  value: number,
  maxLength: number
): number[] {
  const next = [...history, value];
  if (next.length <= maxLength) return next;
  return next.slice(next.length - maxLength);
}

const VISUALIZER_NOISE_FLOOR = 0.003;
const VISUALIZER_GAIN = 12;
const VISUALIZER_CURVE = 0.75;

export function mapRmsToAmplitude(rms: number): number {
  if (!Number.isFinite(rms) || rms <= VISUALIZER_NOISE_FLOOR) {
    return 0;
  }

  const normalized = (rms - VISUALIZER_NOISE_FLOOR) / (1 - VISUALIZER_NOISE_FLOOR);
  const amplified = Math.pow(normalized * VISUALIZER_GAIN, VISUALIZER_CURVE);
  return Math.min(1, amplified);
}

export function resampleWaveformData(data: number[], targetBars: number): number[] {
  if (targetBars <= 0) return [];
  if (data.length === 0) return new Array(targetBars).fill(0);
  if (data.length <= targetBars) {
    const padding = new Array(targetBars - data.length).fill(0);
    return [...data, ...padding];
  }

  const samplesPerBar = data.length / targetBars;
  const result: number[] = [];

  for (let i = 0; i < targetBars; i += 1) {
    const start = Math.floor(i * samplesPerBar);
    const end = Math.min(data.length, Math.floor((i + 1) * samplesPerBar));
    let sum = 0;
    let count = 0;
    for (let j = start; j < end; j += 1) {
      sum += data[j];
      count += 1;
    }
    result.push(count > 0 ? sum / count : 0);
  }

  return result;
}
