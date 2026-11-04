import { renderToStaticMarkup } from 'react-dom/server'
import { NativePdfPreview } from '../src/components/program/NativePdfPreview'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

export function testNativePdfPreview(report: (message: string) => void) {
  function render(url: string, pdfViewerEnabled?: boolean) {
    const template = document.createElement('template')
    template.innerHTML = renderToStaticMarkup(<NativePdfPreview url={url} name={'Billet <test>.pdf'} pdfViewerEnabled={pdfViewerEnabled} />)
    return template.content
  }
  // Parse inert markup only: no test iframe is attached or document loaded.
  for (const enabled of [true, undefined]) {
    const content = render('blob:https://roam.test/test-pdf', enabled)
    const frame = content.querySelector('iframe')
    assert(frame, 'Lecteur natif absent alors que la capacité n’est pas désactivée.')
    assert(!frame.hasAttribute('sandbox'), 'Régression : sandbox bloque le PDF natif.')
    assert(frame.getAttribute('src') === 'blob:https://roam.test/test-pdf', 'URL Blob modifiée.')
    assert(frame.getAttribute('referrerpolicy') === 'no-referrer', 'Politique de referrer perdue.')
    assert(frame.title === 'PDF : Billet <test>.pdf', 'Nom du document incorrect.')
    assert(content.textContent?.includes('Télécharger'), 'Message de repli absent.')
    assert(!content.querySelector('test'), 'Nom du document interprété comme HTML.')
  }
  const unsupported = render('blob:https://roam.test/test-pdf', false)
  assert(!unsupported.querySelector('iframe') && unsupported.querySelector('[role="status"]'), 'Repli sans lecteur PDF incorrect.')
  for (const url of ['https://example.com/page.html', 'data:text/html,<script>alert(1)</script>', 'javascript:alert(1)']) {
    assert(!render(url, true).querySelector('iframe'), 'URL arbitraire autorisée dans la visionneuse PDF.')
  }
  report('PDF natif : iframe sans sandbox, Blob uniquement, nom échappé, referrer et replis vérifiés (rendu réel à tester visuellement).')
}
