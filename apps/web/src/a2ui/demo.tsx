import type { A2uiClientAction, A2uiMessage } from '@a2ui/web_core/v0_9'
import { useEffect, useRef, useState } from 'react'
import { A2uiHost, type A2uiDataChange, type A2uiHostHandle } from './A2uiHost.js'
import { CAR_CATALOG_ID } from './catalog.js'

/**
 * Standalone harness for the A2UI module — served at /a2ui-demo.html.
 *
 * It exists to prove three things without any server: custom components render
 * from the merged catalog, templated children fan out over a data list, and
 * both interaction channels reach the app (Button actions via `onAction`,
 * ChoicePicker/Slider edits via `onDataChange`).
 */

const SURFACE_ID = 'stage'

/**
 * A realistic turn from the agent, in the order it would arrive over SSE:
 * create the surface, seed the data, then declare the component tree.
 */
const DEMO_MESSAGES: A2uiMessage[] = [
  {
    version: 'v0.9',
    createSurface: {
      surfaceId: SURFACE_ID,
      catalogId: CAR_CATALOG_ID,
      // Lets the host hand the agent the full data model alongside an action.
      sendDataModel: true,
    },
  },
  {
    version: 'v0.9',
    updateDataModel: {
      surfaceId: SURFACE_ID,
      path: '/',
      value: {
        headline: 'Three matches for a week in Kerry',
        steps: [
          { title: 'Read your brief', detail: 'Family of four, coastal roads, 7 days', status: 'done' },
          { title: 'Searched the marketplace', detail: '48 listings within 40km of Killarney', status: 'done' },
          { title: 'Ranked and explained', detail: 'Scoring boot space, economy and pickup distance', status: 'active' },
        ],
        cars: [
          {
            id: 'lst_8801',
            title: 'Skoda Octavia Combi',
            subtitle: 'Estate · Diesel · Automatic · Killarney town, 1.2km',
            imageUrl: 'https://placehold.co/216x144/1f2933/ffffff?text=Octavia',
            tags: ['640L boot', '4.8L/100km', 'Free cancellation'],
            price: 74,
            score: 92,
            selected: true,
          },
          {
            id: 'lst_9114',
            title: 'Toyota Corolla Touring Sports',
            subtitle: 'Estate · Hybrid · Automatic · Kerry Airport, 14km',
            imageUrl: 'https://placehold.co/216x144/1f2933/ffffff?text=Corolla',
            tags: ['581L boot', '4.2L/100km', 'Airport pickup'],
            price: 81,
            score: 87,
            selected: false,
          },
          {
            id: 'lst_7420',
            title: 'Dacia Duster',
            subtitle: 'SUV · Petrol · Manual · Tralee, 32km',
            imageUrl: 'https://placehold.co/216x144/1f2933/ffffff?text=Duster',
            tags: ['478L boot', 'High clearance', 'Cheapest'],
            price: 58,
            score: 71,
            selected: false,
          },
        ],
        filters: {
          transmission: ['automatic'],
          budgetPerDay: 90,
        },
      },
    },
  },
  {
    version: 'v0.9',
    updateComponents: {
      surfaceId: SURFACE_ID,
      components: [
        { id: 'root', component: 'Column', children: ['heading', 'steps', 'cars', 'filtersCard'] },
        { id: 'heading', component: 'Text', variant: 'h3', text: { path: '/headline' } },

        // Templated children: one ReasoningStep per entry in /steps.
        { id: 'steps', component: 'Column', children: { componentId: 'stepRow', path: '/steps' } },
        {
          id: 'stepRow',
          component: 'ReasoningStep',
          title: { path: 'title' },
          detail: { path: 'detail' },
          status: { path: 'status' },
        },

        // One CarCard per entry in /cars, each with a nested meta row.
        { id: 'cars', component: 'Column', children: { componentId: 'carRow', path: '/cars' } },
        {
          id: 'carRow',
          component: 'CarCard',
          title: { path: 'title' },
          subtitle: { path: 'subtitle' },
          imageUrl: { path: 'imageUrl' },
          tags: { path: 'tags' },
          selected: { path: 'selected' },
          child: 'carMeta',
          action: {
            event: {
              name: 'selectCar',
              // Relative bindings resolve against the row's own data scope.
              context: { listingId: { path: 'id' }, price: { path: 'price' } },
            },
          },
        },
        { id: 'carMeta', component: 'Row', children: ['carScore', 'carPrice'], justify: 'spaceBetween', align: 'center' },
        { id: 'carScore', component: 'MatchScore', score: { path: 'score' }, label: 'match' },
        { id: 'carPrice', component: 'PriceBadge', amount: { path: 'price' }, currency: '€', period: 'day' },

        // Interactive controls from the standard basic catalog.
        { id: 'filtersCard', component: 'Card', child: 'filtersCol' },
        { id: 'filtersCol', component: 'Column', children: ['picker', 'budget', 'applyBtn'] },
        {
          id: 'picker',
          component: 'ChoicePicker',
          label: 'Transmission',
          variant: 'multipleSelection',
          displayStyle: 'chips',
          options: [
            { label: 'Automatic', value: 'automatic' },
            { label: 'Manual', value: 'manual' },
          ],
          value: { path: '/filters/transmission' },
        },
        {
          id: 'budget',
          component: 'Slider',
          label: 'Max € per day',
          min: 30,
          max: 200,
          value: { path: '/filters/budgetPerDay' },
        },
        {
          id: 'applyBtn',
          component: 'Button',
          variant: 'primary',
          child: 'applyLabel',
          action: {
            event: {
              name: 'applyFilters',
              context: {
                transmission: { path: '/filters/transmission' },
                budgetPerDay: { path: '/filters/budgetPerDay' },
              },
            },
          },
        },
        { id: 'applyLabel', component: 'Text', variant: 'caption', text: 'Apply filters' },
      ],
    },
  },
]

interface LogEntry {
  id: number
  kind: 'action' | 'data' | 'error'
  text: string
}

export function A2uiDemo() {
  const [messages, setMessages] = useState<A2uiMessage[]>([])
  const [run, setRun] = useState(0)
  const [log, setLog] = useState<LogEntry[]>([])
  const hostRef = useRef<A2uiHostHandle>(null)
  const logId = useRef(0)

  const append = (kind: LogEntry['kind'], text: string) => {
    setLog((prev) => [{ id: logId.current++, kind, text }, ...prev].slice(0, 40))
  }

  // Deliver the messages one at a time, the way an SSE stream would, so the
  // incremental-apply path is what gets exercised rather than a single batch.
  // Bumping `run` empties the array first, which is the host's reset path.
  useEffect(() => {
    setMessages([])
    let index = 0
    const timer = setInterval(() => {
      if (index >= DEMO_MESSAGES.length) {
        clearInterval(timer)
        return
      }
      const next = DEMO_MESSAGES[index++]
      setMessages((prev) => [...prev, next])
    }, 350)
    return () => clearInterval(timer)
  }, [run])

  const handleAction = (action: A2uiClientAction) => {
    append('action', `${action.name} from ${action.sourceComponentId} — ${JSON.stringify(action.context)}`)
    // What the app would post to the agent, per client_to_server.json.
    console.log('[a2ui] action', { version: 'v0.9', action }, hostRef.current?.getClientDataModel())
  }

  const handleDataChange = (change: A2uiDataChange) => {
    const filters = (change.value as { filters?: unknown } | undefined)?.filters
    append('data', `${change.surfaceId} filters → ${JSON.stringify(filters)}`)
  }

  return (
    <div className="demo">
      <header className="demo__head">
        <h1>A2UI host harness</h1>
        <p>
          Catalog <code>{CAR_CATALOG_ID}</code> — basic catalog plus CarCard, MatchScore, PriceBadge, ReasoningStep.{' '}
          <button type="button" className="demo__replay" onClick={() => setRun((n) => n + 1)}>
            Replay stream
          </button>
        </p>
      </header>

      <div className="demo__cols">
        <section className="demo__stage">
          <A2uiHost
            ref={hostRef}
            messages={messages}
            onAction={handleAction}
            onDataChange={handleDataChange}
            onError={(error) => append('error', String(error))}
          >
            <p className="demo__empty">Waiting for the agent…</p>
          </A2uiHost>
        </section>

        <section className="demo__log">
          <h2>Round-trip log</h2>
          <p className="demo__hint">
            Click a car card or Apply filters for an action; drag the slider or toggle a chip for a data change.
          </p>
          {log.length === 0 && <p className="demo__empty">No events yet.</p>}
          <ul>
            {log.map((entry) => (
              <li key={entry.id} className={`demo__entry demo__entry--${entry.kind}`}>
                <span className="demo__kind">{entry.kind}</span>
                {entry.text}
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  )
}
