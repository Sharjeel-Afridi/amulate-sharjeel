import { useCallback, useEffect, useRef } from 'react'

/** Below this many pixels from the bottom, the user is considered "following". */
const FOLLOW_THRESHOLD = 96

/**
 * Keeps a scroller pinned to the bottom while the user is following along, and
 * gets out of the way the moment they scroll up to re-read something.
 *
 * Watching the message count is not enough here. The conversation hosts MCP App
 * iframes that report their own height after mounting, and again on every step
 * the widget advances through — each one a layout change that arrives well after
 * React has finished rendering. A ResizeObserver on the content is what actually
 * tracks them; a mutation observer catches nodes that change size without the
 * scroller itself resizing.
 */
export function useStickyScroll<T extends HTMLElement>() {
  const ref = useRef<T | null>(null)
  const followingRef = useRef(true)

  const toBottom = useCallback((behavior: ScrollBehavior) => {
    const el = ref.current
    if (!el || !followingRef.current) return
    el.scrollTo({ top: el.scrollHeight, behavior })
  }, [])

  useEffect(() => {
    const el = ref.current
    if (!el) return

    const onScroll = () => {
      const distance = el.scrollHeight - el.scrollTop - el.clientHeight
      followingRef.current = distance <= FOLLOW_THRESHOLD
    }
    el.addEventListener('scroll', onScroll, { passive: true })

    // 'auto' rather than 'smooth': a widget that resizes twice in quick
    // succession leaves a smooth scroll chasing a target that has already moved,
    // and the thread visibly drifts.
    const resize = new ResizeObserver(() => toBottom('auto'))
    for (const child of Array.from(el.children)) resize.observe(child)
    resize.observe(el)

    const mutate = new MutationObserver(() => {
      for (const child of Array.from(el.children)) resize.observe(child)
      toBottom('smooth')
    })
    mutate.observe(el, { childList: true, subtree: true })

    toBottom('auto')

    return () => {
      el.removeEventListener('scroll', onScroll)
      resize.disconnect()
      mutate.disconnect()
    }
  }, [toBottom])

  return ref
}
