import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { renderToStaticMarkup } from 'react-dom/server'
import { CurrencySelector } from '../src/components/currency/CurrencySelector'
import { currencyOptions, searchCurrencies } from '../src/components/currency/currencyOptions'
import { supportedCurrencyCodes, validateCurrency } from '../src/db/currency'
import { ActivityAdvancedFields } from '../src/components/program/ActivityAdvancedFields'
import { initialActivityValues } from '../src/components/program/activityFormModel'

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message) }
export function testCurrencySelector(report: (message: string) => void) {
  assert(currencyOptions.length === supportedCurrencyCodes.length, 'Catalogue incomplet.')
  assert(currencyOptions.every((item) => validateCurrency(item.code) === item.code && item.name), 'Catalogue non valide.')
  assert(currencyOptions.slice(0, 9).map((item) => item.code).join() === 'EUR,USD,GBP,JPY,CHF,CAD,AUD,MAD,THB', 'Priorités perdues.')
  assert(searchCurrencies(' gbP ').some((item) => item.code === 'GBP'), 'Recherche ISO incorrecte.')
  assert(searchCurrencies('ETATS').some((item) => item.code === 'USD'), 'Recherche pays/accent incorrecte.')
  assert(searchCurrencies('yen').some((item) => item.code === 'JPY'), 'Recherche nom incorrecte.')
  assert(searchCurrencies('inexistant-123').length === 0, 'Recherche arbitraire acceptée.')
  for (const value of ['', 'ZZZ', 'GBP']) {
    const html = renderToStaticMarkup(<CurrencySelector label="Test devise" value={value} allowEmpty onChange={() => { throw new Error('Valeur historique modifiée au rendu.') }} />)
    assert(html.includes(value || 'Devise non renseignée'), 'Valeur historique perdue.')
  }
  const form = initialActivityValues(null, null, '2028-01-01', 'GBP')
  const markup = renderToStaticMarkup(<ActivityAdvancedFields form={form} onChange={() => { throw new Error('Formulaire changé au rendu.') }} />)
  assert(markup.includes('GBP') && !markup.includes('Devise ISO (ex.'), 'Sélecteur non intégré au budget.')
  const host = document.createElement('div')
  const previous = document.activeElement
  document.body.append(host)
  const root = createRoot(host)
  let chosen = 'initial'
  let submitted = false
  try {
    flushSync(() => root.render(<form onSubmit={(event) => { event.preventDefault(); submitted = true }}>
      <CurrencySelector label="Devise test" value="GBP" onChange={(code) => { chosen = code }} />
      <button type="button" data-after>Après</button>
    </form>))
    const trigger = host.querySelector<HTMLButtonElement>('.currency-selector-trigger')!
    flushSync(() => trigger.click())
    const input = host.querySelector<HTMLInputElement>('[role="combobox"]')!
    assert(document.activeElement === input, 'Focus recherche absent.')
    const key = (value: string) => flushSync(() => input.dispatchEvent(new KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true })))
    key('ArrowDown'); key('Enter')
    assert(String(chosen) === 'USD' && !submitted && document.activeElement === trigger, 'Sélection clavier/focus incorrects.')
    flushSync(() => trigger.click())
    const currentInput = host.querySelector<HTMLInputElement>('[role="combobox"]')!
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    flushSync(() => {
      setter.call(currentInput, 'inexistant-123')
      currentInput.dispatchEvent(new Event('input', { bubbles: true }))
    })
    assert(host.querySelectorAll('[role="option"]').length === 0, 'Recherche UI non appliquée.')
    flushSync(() => currentInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })))
    assert(String(chosen) === 'USD' && !submitted, 'Recherche arbitraire enregistrée.')
    flushSync(() => currentInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })))
    assert(!host.querySelector('[role="listbox"]') && document.activeElement === trigger, 'Échap incorrect.')
    flushSync(() => trigger.click())
    const option = [...host.querySelectorAll<HTMLElement>('[role="option"]')].find((item) => item.textContent?.includes('JPY'))!
    flushSync(() => option.click())
    assert(String(chosen) === 'JPY', 'Sélection tactile/clic incorrecte.')
    flushSync(() => trigger.click())
    flushSync(() => host.querySelector<HTMLButtonElement>('[data-after]')!.focus())
    assert(!host.querySelector('[role="listbox"]'), 'Liste ouverte après sortie du focus.')
    flushSync(() => root.render(<CurrencySelector label="Historique" value="" allowEmpty onChange={(code) => { chosen = code }} />))
    flushSync(() => host.querySelector<HTMLButtonElement>('.currency-selector-trigger')!.click())
    flushSync(() => host.querySelector<HTMLElement>('[role="option"]')!.click())
    assert(String(chosen) === '', 'Absence de devise non sélectionnable.')
  } finally {
    flushSync(() => root.unmount())
    host.remove()
    if (previous instanceof HTMLElement && previous.isConnected) previous.focus()
  }
  report('Sélecteur : catalogue, priorités, recherche, valeurs historiques, formulaire budget, clavier, clic, Échap et focus (sans écriture IndexedDB).')
}
