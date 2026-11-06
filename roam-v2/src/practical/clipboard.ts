// Never read the clipboard or claim success without a fulfilled write.
// In insecure HTTP/permission-denied contexts the UI offers manual selection.
export async function copyPracticalText(text: string, clipboard: Pick<Clipboard, 'writeText'> | undefined = navigator.clipboard): Promise<'copied' | 'manual'> {
  if (!clipboard?.writeText) return 'manual'
  try { await clipboard.writeText(text); return 'copied' } catch { return 'manual' }
}
