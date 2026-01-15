export function shouldEnableUploadWaveform(fileSizeBytes: number, limitBytes: number): boolean {
  return fileSizeBytes <= limitBytes;
}
