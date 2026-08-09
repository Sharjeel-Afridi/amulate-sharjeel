import { writeFileSync, mkdirSync } from 'node:fs'
import { catalog, findListing } from '@car/catalog'
import { isRental } from '@car/shared'
import { bookingFormHtml } from './apps/booking-form.js'

/**
 * Renders each MCP App to a standalone page under the web app's public
 * directory, so the widget can be opened directly at
 * `http://localhost:5173/__widget-rent.html` and driven step by step.
 *
 * In the product these widgets live in a `srcdoc` iframe under
 * `sandbox="allow-scripts"`, which gives them an opaque origin — nothing
 * outside can reach in, which is the point, but it also means no test harness
 * or devtools console can drive them. Rendering the same HTML as a top-level
 * page costs nothing and makes the whole flow inspectable.
 *
 * `callTool` is stubbed, since there is no host to answer the bridge. Only the
 * generated pages are affected; the widget source is shipped unmodified.
 */
const STUB = `
<script>
window.addEventListener('load', function () {
  window.callTool = function (name, args) {
    console.log('[stub] ' + name + ' ' + JSON.stringify(args));
    var payload = name === 'submit_booking'
      ? { bookingId: 'BK-STUB-1', listing: 'Stub Car', total: 1234 }
      : { bookingId: 'BK-STUB-1', status: 'paid', listing: 'Stub Car', total: 1234 };
    return new Promise(function (r) {
      setTimeout(function () { r({ content: [{ type: 'text', text: JSON.stringify(payload) }] }); }, 250);
    });
  };
});
</script>`

const all = catalog()
const rental = all.find((l) => isRental(l))!
const purchase = all.find((l) => !isRental(l))!
const dir = process.argv[2] ?? '.'
mkdirSync(dir, { recursive: true })

for (const [name, listing] of [['rent', rental], ['buy', purchase]] as const) {
  const html = bookingFormHtml(findListing(listing.id)!).replace('</body>', `${STUB}</body>`)
  writeFileSync(`${dir}/__widget-${name}.html`, html)
  console.log(`${dir}/__widget-${name}.html — ${html.length} bytes`)
}
