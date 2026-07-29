# Invisible House

**A clean, fast way to look up any Indian mutual fund's NAV history — and compare funds side by side.**

Developed by **Microintel**
Data sourced live from [mfapi.in](https://www.mfapi.in)

---

## Why We Created This

Checking a mutual fund's NAV history today usually means digging through cluttered AMC websites, ad-heavy fintech portals, or PDF factsheets that are outdated the moment they're published. There was no single place to just *type a fund name, see its NAV trend, and compare it against other funds* — without noise, logins, or paywalls.

Invisible House was built to fix that: a lightweight, no-friction tool that puts fund data first and everything else second.

---

## Mission

To make mutual fund NAV data **instantly accessible, transparent, and easy to understand** for every investor — from someone checking a single SIP to someone actively comparing fund houses before making a decision.

## Vision

To become the fastest, simplest lens through which anyone can view and compare mutual fund performance — a tool so unobtrusive that it gets out of the way and lets the data speak for itself. The name itself reflects this: an "invisible house" for your fund data — always there, never in the way.

## The Solution

Invisible House solves this with:

- **Instant search** — type a fund house or scheme name and jump straight to its live NAV data.
- **Full NAV history** — a complete, scrollable, downloadable record of every NAV entry for a scheme, not just the last few data points.
- **Interactive trend charts** — zoomable, pannable NAV graphs with quick range filters (1W, 1M, 6M, 1Y, 3Y, 5Y, MAX).
- **Two-point comparison** — tap any two points on a chart to instantly see the % and absolute NAV change between them.
- **Multi-fund Compare mode** — add up to 4 funds and see their NAV trends overlaid on a single graph, each in its own color, with the same range filters and point-to-point comparison — saved automatically so your comparison survives a page reload.
- **Recent searches** — quickly return to funds you've looked up before.
- **Light / dark themes** — for comfortable viewing anywhere.

All of this runs directly in the browser, with no sign-up and no account required.

---

## Key Features

| Feature | Description |
|---|---|
| Fund Search | Search by fund house or scheme name with live suggestions |
| Fund Details | Latest NAV, as-on date, scheme type, and category at a glance |
| NAV Trend Chart | Interactive, zoomable line chart of NAV over time |
| Range Filters | 1W / 1M / 6M / 1Y / 3Y / 5Y / MAX views |
| Tap-to-Compare | Select two points on a chart to see the NAV change between them |
| Compare Funds | Overlay up to 4 funds' NAV histories on one chart, color-coded |
| Persistent Comparison | Compare selections are saved locally (IndexedDB) and survive reloads |
| Full History Table | Paginated table of every NAV entry, with day-over-day change |
| Download | Export a fund's full details and NAV history as JSON |
| Recent Searches | A running list of funds you've recently viewed |
| Theme Toggle | Light and dark mode support |

---

## How It Works

1. **Search** for a fund house or scheme name.
2. **Select** a scheme from the suggestions to load its live details and NAV history.
3. **Explore** the trend using the range filters, zoom, and pan — or tap two points to see the change between them.
4. **Add to Compare** to send that fund into the Compare tab, and repeat for up to 4 funds.
5. **Compare** — switch to the Compare tab to see every added fund's NAV trend overlaid on one chart, with the same range filtering and tap-to-compare tools.
6. Your comparison list stays saved locally until you remove a fund or hit **Clear All** — even after closing or reloading the page.

---

## How to Access It

Invisible House is hosted as one of Microintel's projects. To find and use it:

1. **Search "Microintel" on Google.**
2. **Open the Microintel page** from the search results.
3. **Select Projects** on the Microintel page.
4. **Search for "Invisible"** within the projects list and open it.

That's it — no installation, sign-up, or account needed. It runs directly in your browser.

---

## Data Source

All NAV data is fetched live from **[mfapi.in](https://www.mfapi.in)**, a free public API for Indian mutual fund NAV history. Invisible House does not store or modify this data — it simply presents it in a fast, readable, comparable form.

---

## Tech Stack

- Vanilla HTML, CSS, and JavaScript — no build step required
- [Chart.js](https://www.chartjs.org/) with the zoom/pan plugin for interactive NAV charts
- IndexedDB for local, persistent storage of comparison selections
- localStorage for theme preference and recent searches
- [Bootstrap Icons](https://icons.getbootstrap.com/) for iconography

---

## Credits

**Developed by Microintel**
Fund data fetched live from [mfapi.in](https://www.mfapi.in)
