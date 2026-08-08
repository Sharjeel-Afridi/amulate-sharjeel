import { A2uiSurface, basicCatalog, type ReactComponentImplementation } from '@a2ui/react/v0_9'
import {
  MessageProcessor,
  type A2uiClientAction,
  type A2uiClientDataModel,
  type A2uiMessage,
  type Catalog,
  type SurfaceModel,
} from '@a2ui/web_core/v0_9'
import { useEffect, useImperativeHandle, useRef, useState, type ReactNode, type Ref } from 'react'
import { carCatalog } from './catalog.js'
import './a2ui.css'

/**
 * A2UI rendering host.
 *
 * Owns one `MessageProcessor`, feeds it the agent's v0.9 message stream, and
 * renders every surface the agent created. Two things travel back out:
 *
 * - `onAction` — a component with an `action: {event: …}` was activated. This is
 *   the protocol's own client-to-server channel; forward it to the agent as-is.
 * - `onDataChange` — a bound input (ChoicePicker, Slider, TextField,
 *   DateTimeInput, CheckBox) wrote a new value into the surface data model.
 *   A2UI does NOT emit an action for these, so we surface them separately for
 *   apps that want live echo rather than waiting for a submit button.
 */

/** A user edit that landed in a surface's data model. */
export interface A2uiDataChange {
  surfaceId: string
  /** The surface's full data model after the edit, as a plain JSON object. */
  value: unknown
}

/** Imperative escape hatch, mostly for building client-to-server payloads. */
export interface A2uiHostHandle {
  processor: MessageProcessor<ReactComponentImplementation>
  /** Aggregated data model for surfaces created with `sendDataModel: true`. */
  getClientDataModel(): A2uiClientDataModel | undefined
  /** Capability advertisement to send to the agent so it knows our catalog. */
  getClientCapabilities(includeInlineCatalogs?: boolean): unknown
}

export interface A2uiHostProps {
  /**
   * The messages seen so far, oldest first. Append to this array as the stream
   * arrives — the host applies only the new tail. Replacing it with a shorter
   * array is treated as a reset and rebuilds the processor.
   */
  messages: A2uiMessage[]
  /** Fires when the user activates a component carrying an `action`. */
  onAction?: (action: A2uiClientAction) => void
  /** Fires when a bound input writes a user value into the data model. */
  onDataChange?: (change: A2uiDataChange) => void
  /** Malformed or out-of-order messages, plus surface-level runtime errors. */
  onError?: (error: unknown) => void
  /** Defaults to our merged catalog; the standard basic catalog also resolves. */
  catalog?: Catalog<ReactComponentImplementation>
  /** Render only this surface. Omit to render all of them. */
  surfaceId?: string
  className?: string
  children?: ReactNode
  ref?: Ref<A2uiHostHandle>
}

export function A2uiHost({
  messages,
  onAction,
  onDataChange,
  onError,
  catalog = carCatalog,
  surfaceId,
  className,
  children,
  ref,
}: A2uiHostProps) {
  // Callbacks live in refs so a new inline arrow from the parent never forces
  // the processor (and with it the whole surface tree) to be rebuilt.
  const onActionRef = useRef(onAction)
  const onDataChangeRef = useRef(onDataChange)
  const onErrorRef = useRef(onError)
  onActionRef.current = onAction
  onDataChangeRef.current = onDataChange
  onErrorRef.current = onError

  // Agent-driven data model writes must not masquerade as user edits.
  const applyingRef = useRef(false)

  const [processor, setProcessor] = useState(() => createProcessor(catalog, onActionRef))
  const [surfaces, setSurfaces] = useState<SurfaceModel<ReactComponentImplementation>[]>([])
  const appliedRef = useRef(0)

  useImperativeHandle(
    ref,
    () => ({
      processor,
      getClientDataModel: () => processor.getClientDataModel(),
      getClientCapabilities: (includeInlineCatalogs = false) =>
        processor.getClientCapabilities({ includeInlineCatalogs }),
    }),
    [processor],
  )

  // Track surfaces, and watch each one's data model for user edits.
  useEffect(() => {
    const watchers = new Map<string, () => void>()

    const watch = (surface: SurfaceModel<ReactComponentImplementation>) => {
      if (watchers.has(surface.id)) return
      // Subscribing at the root reports descendant changes too, which is what
      // we want: any bound input anywhere on the surface shows up here.
      const data = surface.dataModel.subscribe('/', () => {
        if (applyingRef.current) return
        onDataChangeRef.current?.({ surfaceId: surface.id, value: surface.dataModel.get('/') })
      })
      const errors = surface.onError.subscribe((error) => onErrorRef.current?.(error))
      watchers.set(surface.id, () => {
        data.unsubscribe()
        errors.unsubscribe()
      })
    }

    const sync = () => {
      const list = Array.from(processor.model.surfacesMap.values())
      list.forEach(watch)
      for (const [id, stop] of watchers) {
        if (!processor.model.getSurface(id)) {
          stop()
          watchers.delete(id)
        }
      }
      setSurfaces(list)
    }

    const created = processor.onSurfaceCreated(sync)
    const deleted = processor.onSurfaceDeleted(sync)
    sync()

    return () => {
      created.unsubscribe()
      deleted.unsubscribe()
      watchers.forEach((stop) => stop())
      watchers.clear()
    }
  }, [processor])

  // Apply the new tail of the stream.
  useEffect(() => {
    if (messages.length < appliedRef.current) {
      const next = createProcessor(catalog, onActionRef)
      applyMessages(next, messages, applyingRef, onErrorRef.current)
      appliedRef.current = messages.length
      setProcessor(next)
      return
    }
    const pending = messages.slice(appliedRef.current)
    appliedRef.current = messages.length
    if (pending.length === 0) return
    applyMessages(processor, pending, applyingRef, onErrorRef.current)
    // `catalog` is intentionally not a dependency: swapping catalogs mid-stream
    // would invalidate every already-rendered surface.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages, processor])

  const visible = surfaceId ? surfaces.filter((s) => s.id === surfaceId) : surfaces

  return (
    <div className={className ? `a2ui-host ${className}` : 'a2ui-host'}>
      {visible.length === 0
        ? children
        : visible.map((surface) => (
            <div key={surface.id} className="a2ui-host__surface" data-surface-id={surface.id}>
              <A2uiSurface surface={surface} />
            </div>
          ))}
    </div>
  )
}

function createProcessor(
  catalog: Catalog<ReactComponentImplementation>,
  onActionRef: { current: ((action: A2uiClientAction) => void) | undefined },
) {
  // The action handler is the protocol's round-trip: SurfaceModel.dispatchAction
  // validates the payload against A2uiClientActionSchema, stamps surfaceId,
  // sourceComponentId and timestamp, then emits it here. An action's context is
  // resolved against the data model at dispatch time, so the user's current
  // slider/chip values are already inside it.
  // The stock catalog is registered alongside ours so a surface that names the
  // spec's own catalogId still resolves instead of throwing "Catalog not found".
  const catalogs = catalog.id === basicCatalog.id ? [catalog] : [catalog, basicCatalog]
  return new MessageProcessor<ReactComponentImplementation>(catalogs, (action) => {
    onActionRef.current?.(action)
  })
}

function applyMessages(
  processor: MessageProcessor<ReactComponentImplementation>,
  messages: A2uiMessage[],
  applyingRef: { current: boolean },
  onError: ((error: unknown) => void) | undefined,
) {
  applyingRef.current = true
  try {
    // One at a time: a single malformed message should not discard the rest of
    // the batch, and the processor throws on the first failure.
    for (const message of messages) {
      try {
        processor.processMessages([message])
      } catch (error) {
        onError?.(error)
      }
    }
  } finally {
    applyingRef.current = false
  }
}
