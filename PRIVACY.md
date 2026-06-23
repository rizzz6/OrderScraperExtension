# Privacy Policy — Spend History: Flipkart & Amazon Order Tracker & Exporter

**Last updated:** June 2026

---

## Overview

Spend History is a browser extension that reads your own Flipkart and Amazon order history pages — pages you are actively logged into and viewing — and exports that data locally as a CSV or PDF file for personal expense tracking. We are committed to full transparency about how this extension handles your data.

**The short version: your data never leaves your device. Ever.**

---

## What Data Is Accessed

When you trigger the scraper, the extension reads the following information directly from the order history pages rendered in your browser:

- **Order ID** — the platform-assigned order reference number
- **Product name / item title** — the name of the item you ordered
- **Order date** — the date of delivery, cancellation, or refund
- **Amount paid** — the cash amount shown on your order card
- **Order status** — Delivered, Cancelled, or Refunded
- **SuperCoins** *(Flipkart only)* — coins earned or used on an order
- **Delivery recipient name** *(Amazon only)* — the name shown on the order card
- **Amazon Pay balance & ledger** *(Amazon only)* — balance figures and transaction descriptions from your Amazon Pay history page

The extension reads **only what is already rendered on-screen** in your order history. It does not access, read, or store any of the following:

- Passwords or login credentials
- Payment card or bank account numbers
- Your email address or phone number
- Cookies or session tokens
- Browsing history outside of Flipkart/Amazon order pages
- Any page content outside the specific order history URL patterns listed in the manifest

---

## How Data Is Stored

All data processed by this extension is stored **exclusively in `chrome.storage.local`** — a sandboxed, local-only storage area inside your browser on your own device.

- Data is **never uploaded** to any server
- Data is **never synced** to the cloud
- Data is **never shared** with any third party
- Data is **never used** for advertising, profiling, or any purpose other than generating your export

---

## How Data Is Used

Locally stored order data is used solely to:

1. Display spend analytics (total spend, category breakdown, monthly trend chart) inside the extension popup
2. Generate CSV and PDF exports that you download directly to your device
3. Persist scrape results between popup opens so you do not need to re-run the extraction on every visit

No automated processing, machine learning, or external analysis is performed on your data.

---

## Data Sharing & Third Parties

We do not sell, rent, trade, or transfer your data to any third party under any circumstances.

The only external network request made by this extension is loading the **Outfit typeface** from Google Fonts (`fonts.googleapis.com`) for UI rendering purposes. This is a standard CSS stylesheet request. No order data, personal data, or any user-identifiable information is included in or transmitted alongside this request.

---

## Permissions Explained

| Permission | Why It Is Needed |
|---|---|
| `activeTab` | To read the Flipkart or Amazon order history page you are currently viewing and have explicitly activated the extension on |
| `storage` | To save scraped results locally in your browser so data persists between popup opens and browser sessions |
| Host patterns (`flipkart.com`, `amazon.in`, `amazon.com`) | To inject the scraper content scripts into the specific order history and Amazon Pay pages. Scoped to the minimum required URL paths only |

No other permissions are requested or used.

---

## Data Deletion

You have full control over your locally cached data at all times.

To delete all data stored by this extension:
1. Open the extension popup
2. Click **"Clear Cache & Re-run Scraper"** at the bottom of the results screen
3. Confirm the action in the dialog

This immediately wipes all order data, coin history, and Amazon Pay data from `chrome.storage.local`.

Alternatively, you can uninstall the extension — all locally stored data is automatically deleted by the browser upon uninstallation.

---

## Remote Code

This extension does **not** use any remote code. All JavaScript executed by the extension is bundled locally within the extension package. No external scripts, modules, or WebAssembly files are loaded or evaluated at runtime.

---

## Children's Privacy

This extension is not directed at children under the age of 13 and does not knowingly collect any data from children.

---

## Changes to This Policy

If this privacy policy is updated, the "Last updated" date at the top of this document will be revised. Continued use of the extension after any changes constitutes acceptance of the updated policy.

---

## Contact

If you have any questions about this privacy policy or the extension's data practices, please open an issue on this repository or contact the developer directly via GitHub.
