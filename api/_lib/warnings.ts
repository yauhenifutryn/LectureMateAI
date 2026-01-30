let warningFilterInstalled = false;

export function installWarningFilter(): void {
  if (warningFilterInstalled) return;
  warningFilterInstalled = true;

  process.on('warning', (warning) => {
    if (warning?.code === 'DEP0169') {
      return;
    }
    console.warn(warning);
  });
}

installWarningFilter();
