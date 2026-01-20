export const formatUploadCheckpoint = (count: number): string | null => {
  if (!count || count <= 0) return null;
  if (count === 1) return 'Uploaded 1 file successfully.';
  return `Uploaded ${count} files successfully.`;
};
