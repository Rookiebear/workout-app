import { render } from 'preact'
import { registerSW } from 'virtual:pwa-register'
import { ensureSeeded } from './db/db'
import { App } from './ui/App'
import './ui/styles.css'

registerSW({ immediate: true })

ensureSeeded().then(() => render(<App />, document.getElementById('app')!))
