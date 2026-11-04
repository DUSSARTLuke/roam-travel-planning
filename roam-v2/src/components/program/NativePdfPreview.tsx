type Props = { url: string; name: string; pdfViewerEnabled?: boolean }

// The caller supplies a Blob URL from getDocument(), which checks the PDF MIME,
// size and signature. Do not accept arbitrary page/data URLs in this frame.
export function NativePdfPreview({ url, name, pdfViewerEnabled }: Props) {
  return <>
    <p className="activity-meta">L’affichage PDF dépend du lecteur intégré du navigateur. Si le document reste vide ou ne s’affiche pas, utilise Télécharger pour l’ouvrir avec ton lecteur habituel.</p>
    {!url.startsWith('blob:')
      ? <p role="status">La source du document ne permet pas son affichage. Le téléchargement reste disponible.</p>
      : pdfViewerEnabled === false
        ? <p role="status">Ce navigateur ne propose pas de lecteur PDF intégré. Le téléchargement reste disponible.</p>
        // An iframe sandbox blocks native PDF rendering in Chromium. The PDF
        // is handled by the browser, not interpreted as HTML by Roam. Removing
        // this restriction does not disable PDF scripting in the native reader.
        : <iframe className="document-pdf" src={url} title={`PDF : ${name}`} referrerPolicy="no-referrer" />}
  </>
}
