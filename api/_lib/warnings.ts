let warningFilterInstalled = false;

export function installWarningFilter(): void {
  if (warningFilterInstalled) return;
  warningFilterInstalled = true;

  process.on('warning', (warning) => {
    const code =
      typeof warning === 'object' && warning && 'code' in warning
        ? (warning as { code?: string }).code
        : undefined;
    if (code === 'DEP0169') {
      return;
    }
    console.warn(warning);
  });
}

installWarningFilter();
