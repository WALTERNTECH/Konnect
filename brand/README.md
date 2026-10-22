# Konnect brand

**The mark** is a K whose two arms meet at a single point, set in laterite: the place where two people, or a guest and a host, meet. The wordmark is Instrument Serif, outlined to paths so the files render the same everywhere.

| File | Use |
| --- | --- |
| `konnect-logo.svg` | Horizontal lockup on light backgrounds |
| `konnect-logo-reversed.svg` | Horizontal lockup on dark backgrounds and photography |
| `konnect-mark.svg`, `konnect-mark-reversed.svg` | The mark alone, from 16 px up |
| `konnect-wordmark.svg` | Wordmark alone |
| `konnect-app-icon.svg`, `konnect-app-icon-512.png` | App icon and favicon |
| `konnect-og.png` | Link previews (1200 × 630) |

Keep clear space around the lockup equal to the height of the node. Don't recolour the node, stretch the mark, or set the wordmark in another typeface.

## Colour

| Name | Light | Dark | Use |
| --- | --- | --- | --- |
| Paper | `#F6F4EF` | `#0E0D0B` | Page background, with a fine film grain |
| Ink | `#17140F` | `#F2EEE7` | Text and the mark |
| Laterite | `#A3472A` | `#CC6845` | Primary actions and the node — Kenya's red earth |
| Brass | `#977443` | `#C8A56B` | Membership only |
| Surface | `#FFFFFF` | `#161512` | Cards and sheets |

## Type

- **Instrument Serif** for display: page titles, prices, names in Connect.
- **Inter** for everything else, with tabular figures for money.
- Small labels are uppercase Inter at 11–12 px with wide tracking.

## Voice

Plain and specific. Say what something is and what it costs; don't sell it. No exclamation marks, no "amazing", no urgency. Prices are written `KES 6,500`. Dates and times are Nairobi time.

## Regenerating

The logo files and `frontend/src/components/brand/paths.ts` come from the Instrument Serif font file via opentype.js; the share image and PNG icons are rendered from the SVGs with sharp.
