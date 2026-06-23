console.log("%c ⚡ Amazon Pay Exporter Connected! ⚡ ", 'background: #ff9900; color: #000; font-size: 13px; font-weight: bold;');

// Helper to decode HTML entities
function decodeHtml(html) {
    const txt = document.createElement("textarea");
    txt.innerHTML = html;
    return txt.value;
}

function injectGoogleFonts() {
    if (!document.getElementById('amazonPayScraperGoogleFonts')) {
        let link1 = document.createElement('link');
        link1.rel = 'preconnect';
        link1.href = 'https://fonts.googleapis.com';
        let link2 = document.createElement('link');
        link2.rel = 'preconnect';
        link2.href = 'https://fonts.gstatic.com';
        link2.crossOrigin = 'anonymous';
        let link3 = document.createElement('link');
        link3.id = 'amazonPayScraperGoogleFonts';
        link3.rel = 'stylesheet';
        link3.href = 'https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700&display=swap';
        document.head.appendChild(link1);
        document.head.appendChild(link2);
        document.head.appendChild(link3);
    }
}

function showStatusOverlay(message, submessage = "") {
    let overlay = document.getElementById('amazonPayScraperOverlay');
    if (!overlay) {
        injectGoogleFonts();
        overlay = document.createElement('div');
        overlay.id = 'amazonPayScraperOverlay';
        overlay.style.cssText = 'position: fixed; top: 24px; right: 24px; background: rgba(255, 255, 255, 0.85); backdrop-filter: blur(12px) saturate(180%); -webkit-backdrop-filter: blur(12px) saturate(180%); border: 1px solid rgba(255, 255, 255, 0.4); padding: 20px; border-radius: 16px; z-index: 10000000; box-shadow: 0 10px 30px rgba(0, 0, 0, 0.1), inset 0 1px 1px rgba(255, 255, 255, 0.3); font-family: "Outfit", sans-serif; width: 280px; box-sizing: border-box; transition: all 0.3s ease;';

        overlay.innerHTML = `
            <div style="display: flex; align-items: center; gap: 10px; font-weight: 700; color: #ff9900; font-size: 15px; margin-bottom: 6px;">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="spinner-icon"><line x1="12" y1="2" x2="12" y2="6"></line><line x1="12" y1="18" x2="12" y2="22"></line><line x1="4.93" y1="4.93" x2="7.76" y2="7.76"></line><line x1="16.24" y1="16.24" x2="19.07" y2="19.07"></line><line x1="2" y1="12" x2="6" y2="12"></line><line x1="18" y1="12" x2="22" y2="12"></line><line x1="6.34" y1="17.66" x2="8.46" y2="15.54"></line><line x1="15.54" y1="8.46" x2="17.66" y2="6.34"></line></svg>
                Amazon Spend History
            </div>
            <div id="payScraperMessage" style="font-size: 13px; font-weight: 600; color: #1e293b; margin-bottom: 4px;"></div>
            <div id="payScraperSubmessage" style="font-size: 11px; color: #64748b; font-weight: 500; line-height: 1.4; margin-bottom: 8px;"></div>
            <button id="inPageStopBtn" style="width: 100%; border: 1px solid #ef4444; color: #ef4444; font-weight: 600; background: rgba(239, 68, 68, 0.05); cursor: pointer; transition: all 0.2s; padding: 8px 12px; border-radius: 8px; font-family: 'Outfit', sans-serif; font-size: 12px; box-sizing: border-box;" onmouseover="this.style.background='rgba(239, 68, 68, 0.1)';" onmouseout="this.style.background='rgba(239, 68, 68, 0.05)';">Stop Extraction</button>
            <style>
                @keyframes spin { 100% { transform: rotate(360deg); } }
                .spinner-icon { animation: spin 1.5s linear infinite; }
            </style>
        `;
        document.body.appendChild(overlay);

        const stopBtn = overlay.querySelector('#inPageStopBtn');
        if (stopBtn) {
            stopBtn.addEventListener('click', () => {
                console.log("[Amazon Pay Scraper] In-page stop button clicked. Terminating...");
                if (window.amazonPayInterval) {
                    clearInterval(window.amazonPayInterval);
                    window.amazonPayInterval = null;
                }
                chrome.storage.local.set({ amazonPayScrapingActive: false }, () => {
                    overlay.remove();
                    chrome.runtime.sendMessage({ action: "closeTab" });
                });
            });
        }
    }

    document.getElementById('payScraperMessage').innerText = message;
    document.getElementById('payScraperSubmessage').innerText = submessage;
}

function showCompletionOverlay(count) {
    let overlay = document.getElementById('amazonPayScraperOverlay');
    if (overlay) {
        overlay.innerHTML = `
            <div style="display: flex; align-items: center; gap: 10px; font-weight: 700; color: #27ae60; font-size: 15px; margin-bottom: 6px;">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>
                Scraping Complete
            </div>
            <div style="font-size: 13px; font-weight: 600; color: #1e293b; margin-bottom: 4px;">Amazon Pay Ledger Saved!</div>
            <div style="font-size: 11px; color: #64748b; font-weight: 500; line-height: 1.4;">Extracted ${count} transactions. Closing tab in 3 seconds...</div>
        `;
    }
}

function waitForElement(selector, checkFn, callback, timeout = 10000) {
    const startTime = Date.now();
    const timer = setInterval(() => {
        const el = document.querySelector(selector);
        if (el && (!checkFn || checkFn(el))) {
            clearInterval(timer);
            callback(el);
        } else if (Date.now() - startTime > timeout) {
            clearInterval(timer);
            callback(null);
        }
    }, 250);
}

chrome.storage.local.get(["amazonPayScrapingActive"], (res) => {
    if (res.amazonPayScrapingActive) {
        initScraper();
    }
});

function initScraper() {
    const path = window.location.pathname;

    if (path.includes('/apay/landing/add-money')) {
        console.log("[Amazon Pay Scraper] Processing balances...");
        showStatusOverlay("Extracting Pay Balances", "Reading wallet and gift card details...");

        waitForElement('payui-balance-detail-widget', (el) => el.getAttribute('data'), (el) => {
            if (!el) {
                console.error("[Amazon Pay Scraper] Balance widget not found or data attribute missing.");
                chrome.storage.local.set({
                    amazonPayBalance: "₹0.00",
                    amazonWalletBalance: "₹0.00",
                    amazonGiftCardBalance: "₹0.00"
                }, () => {
                    redirectToHistory();
                });
                return;
            }

            const rawData = el.getAttribute('data');
            let parsed = [];
            try {
                const decoded = decodeHtml(rawData);
                parsed = JSON.parse(decoded);
            } catch (e) {
                console.error("[Amazon Pay Scraper] Failed to parse balance JSON:", e);
            }

            const totalBal = parsed.find(b => b.label === 'total_balance_text')?.value || '₹0.00';
            const walletBal = parsed.find(b => b.label === 'money_text')?.value || '₹0.00';
            const giftBal = parsed.find(b => b.label === 'gifts_cashbacks_refunds_text')?.value || '₹0.00';

            chrome.storage.local.set({
                amazonPayBalance: totalBal,
                amazonWalletBalance: walletBal,
                amazonGiftCardBalance: giftBal
            }, () => {
                console.log(`[Amazon Pay Scraper] Balances saved. Total: ${totalBal}. Redirecting...`);
                redirectToHistory();
            });
        });
    } else if (path.includes('/pay/history')) {
        console.log("[Amazon Pay Scraper] Processing transaction ledger...");
        showStatusOverlay("Loading Ledger", "Initializing transaction history view...");

        setupTransactionsListener();
    }
}

function redirectToHistory() {
    window.location.href = "https://" + window.location.host + "/pay/history?tab=ALL&filter={}&ref=";
}

// ---------- Direct Shadow DOM Data Extraction Array Logic ----------

let compiledTransactionsMap = new Map();
let hasMoreToFollow = true;

// Keep track of occurrences globally but reset per readTransactionsFromShadowDOM call to map screen elements correctly
let jsonOccurrences = {};
let domOccurrences = {};
let interceptedTransactions = [];

if (!window.__amazonPayListenerAttached) {
    window.__amazonPayListenerAttached = true;
    window.addEventListener('amazonPayDataIntercepted', (event) => {
        const json = event.detail;
        handleInterceptedData(json);
    });
}

function handleInterceptedData(json) {
    function search(obj) {
        if (!obj || typeof obj !== 'object') return;
        if (obj.transactionDetails) {
            const details = obj.transactionDetails;
            const isDuplicate = interceptedTransactions.some(existing => {
                const extDetails = existing.transactionDetails || {};
                return extDetails.authenticator === details.authenticator &&
                    extDetails.amount === details.amount &&
                    extDetails.authenticatorThree === details.authenticatorThree;
            });
            if (!isDuplicate) {
                interceptedTransactions.push(obj);
                console.log(`%c [Network Interceptor] Captured new transaction. Total in memory: ${interceptedTransactions.length} `, "color: #9b59b6; font-weight: bold;");
            }
            return;
        }
        for (let key in obj) {
            if (obj.hasOwnProperty(key)) {
                search(obj[key]);
            }
        }
    }
    search(json);
}

// 100% Robust Deep Recursive Shadow DOM query selector
function getAllElementsIncludingShadows(selector, root = document) {
    const elements = [];

    function recurse(node) {
        if (!node) return;

        // If it's an element and matches our selector
        if (node.nodeType === Node.ELEMENT_NODE) {
            if (node.matches(selector)) {
                elements.push(node);
            }
            // Dive into shadow root if present
            if (node.shadowRoot) {
                recurse(node.shadowRoot);
            }
        }

        // Process child nodes (works for Element, Document, DocumentFragment/ShadowRoot)
        let child = node.firstChild;
        while (child) {
            recurse(child);
            child = child.nextSibling;
        }
    }

    recurse(root);
    return elements;
}

// Deterministic key generation to identify and deduplicate transactions across JSON attributes and DOM nodes
function getUniqueKey(title, amount, date, status, type) {
    const cleanTitle = (title || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');

    // Strip everything except numbers and decimals
    const cleanAmount = (amount || '').trim().replace(/[^0-9.]/g, '');
    // Force evaluation as floating point numbers to normalize "839.00" and "839" to exactly "839.00"
    const parsedFloat = parseFloat(cleanAmount);
    const uniformAmount = isNaN(parsedFloat) ? '0.00' : parsedFloat.toFixed(2);

    // Strip out common date headers and keep clean alphanumerics
    const cleanDate = (date || '')
        .replace(/(delivered on|cancelled on|refund completed|ordered on)/gi, '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '');

    const cleanStatus = (status || 'success').trim().toLowerCase();
    const cleanType = (type || 'debit').trim().toLowerCase();

    // Included type (credit/debit) and status in the primary hash to prevent cross-type collisions on identical amounts
    return `${cleanTitle}_${uniformAmount}_${cleanDate}_${cleanStatus}_${cleanType}`;
}

// Dynamic, robust date boundary verification engine
function isTransactionTooOld(dateStr, minTargetYear) {
    if (!dateStr) return false;

    let cleanStr = dateStr.trim();

    // CRITICAL FIX: Ignore standalone month banners (like "Dec 2025" or "Jan 2026")
    // Real transactions always contain timestamps like "AM", "PM", or a colon ":" signature
    const hasTimestamp = /([0-9]{1,2}:[0-9]{2})|AM|PM/i.test(cleanStr);
    if (!hasTimestamp) {
        return false;
    }

    // Strip helper labels to leave the clean calendar framework
    let datePart = cleanStr.replace(/(Delivered on|Cancelled on|Refund Completed|Refund completed|Ordered on)/gi, '').trim();

    // Scan for explicit years (e.g. 2025, 2024)
    let yearMatch = datePart.match(/\b(20\d{2})\b/);

    // If a transaction has a valid timestamp but no explicit year, it's from the current year (2026)
    let transactionYear = yearMatch ? parseInt(yearMatch[1], 10) : 2026;

    if (transactionYear < minTargetYear) {
        console.log(`%c [Date Anchor] Cutoff triggered! Transaction year ${transactionYear} (${cleanStr}) is older than target year boundary ${minTargetYear}. `, 'background: #d32f2f; color: #fff; font-weight: bold;');
        return true;
    }
    return false;
}

// Helper function to safely insert a transaction and resolve duplicate copy collisions
function insertTransaction(source, title, amount, date, type, status, url = null, orderId = null) {
    const cleanAmount = (amount || '').trim().replace(/[^0-9.]/g, '');
    const baseKey = getUniqueKey(title, cleanAmount, date, status, type);
    const isJson = source.includes('JSON') || source.includes('Wrapper') || source.includes('Network');

    if (isJson) {
        // Track how many times this transaction signature appeared in the JSON data stream
        jsonOccurrences[baseKey] = (jsonOccurrences[baseKey] || 0) + 1;
        const occNum = jsonOccurrences[baseKey];
        const uniqueKey = `${baseKey}_occ_${occNum}`;

        if (compiledTransactionsMap.has(uniqueKey)) {
            const existing = compiledTransactionsMap.get(uniqueKey);
            if (existing.Source.includes('DOM Element')) {
                existing.Source = `JSON & DOM Verified`;
            }
            if (url && !existing.transactionDetailPageURL) {
                existing.transactionDetailPageURL = url;
            }
            if (orderId && !existing.transactionDetails.orderId) {
                existing.transactionDetails.orderId = orderId;
            }
        } else {
            compiledTransactionsMap.set(uniqueKey, {
                Source: source,
                transactionDetails: {
                    authenticator: title,
                    amount: cleanAmount,
                    authenticatorThree: date,
                    type: type.toUpperCase(),
                    status: status.toUpperCase(),
                    orderId: orderId
                },
                transactionDetailPageURL: url
            });
        }
    } else {
        // Track how many times this transaction signature appeared in the raw DOM nodes
        domOccurrences[baseKey] = (domOccurrences[baseKey] || 0) + 1;
        const occNum = domOccurrences[baseKey];
        const uniqueKey = `${baseKey}_occ_${occNum}`;

        if (compiledTransactionsMap.has(uniqueKey)) {
            // Perfect matching index cross-verification pairing!
            const existing = compiledTransactionsMap.get(uniqueKey);
            existing.Source = `JSON & DOM Verified`;
            if (existing.transactionDetails.authenticator === 'Amazon Pay Transaction' && title !== 'Amazon Pay Transaction') {
                existing.transactionDetails.authenticator = title;
            }
            if (url && !existing.transactionDetailPageURL) {
                existing.transactionDetailPageURL = url;
            }
            if (orderId && !existing.transactionDetails.orderId) {
                existing.transactionDetails.orderId = orderId;
            }
        } else {
            // DOM has more copies than JSON, or JSON data for this item was missing entirely
            compiledTransactionsMap.set(uniqueKey, {
                Source: source,
                transactionDetails: {
                    authenticator: title,
                    amount: cleanAmount,
                    authenticatorThree: date,
                    type: type.toUpperCase(),
                    status: status.toUpperCase(),
                    orderId: orderId
                },
                transactionDetailPageURL: url
            });
        }
    }
}

// FIXED: Mutually exclusive parsing that guarantees no duplicate mappings and resists scroll container virtualization
function readTransactionsFromShadowDOM() {
    // Reset occurrences counters on each scan so occurrences map correctly to current DOM layout state
    jsonOccurrences = {};
    domOccurrences = {};

    // 0. --- PHASE 0: PARSE NETWORK INTERCEPTED TRANSACTIONS ---
    if (interceptedTransactions && Array.isArray(interceptedTransactions)) {
        interceptedTransactions.forEach(tx => {
            const details = tx.transactionDetails || {};
            const url = tx.transactionDetailPageURL || '';
            const orderIdMatch = url.match(/[?&]orderId=([^&]+)/);
            const orderId = orderIdMatch ? orderIdMatch[1] : details.orderId || null;

            insertTransaction(
                `Network Intercepted`,
                details.authenticator || 'Unknown',
                details.amount ? `₹${details.amount}` : '₹0',
                details.authenticatorThree || 'Unknown',
                details.type || 'DEBIT',
                details.status || 'SUCCESS',
                url,
                orderId
            );
        });
    }

    // 1. --- PHASE 1: PARSE STRUCTURED WIDGET ATTRIBUTES (JSON FALLBACK) ---
    const wrappers = getAllElementsIncludingShadows('payui-transaction-history-wrapper');
    const listViews = getAllElementsIncludingShadows('payui-transaction-history-list-view');

    // Check wrappers for JSON transactions
    wrappers.forEach((wrap, idx) => {
        let parsed = wrap.transactions;
        if (!parsed) {
            const txsAttr = wrap.getAttribute('transactions');
            if (txsAttr) {
                try {
                    parsed = JSON.parse(decodeHtml(txsAttr));
                } catch (err) {
                    console.warn(`[Diagnostic] Failed to parse Wrapper ${idx} transactions JSON attribute.`);
                }
            }
        }

        if (parsed) {
            try {
                if (typeof parsed === 'string') {
                    parsed = JSON.parse(parsed);
                }
                if (Array.isArray(parsed)) {
                    parsed.forEach(tx => {
                        if (!tx) return;
                        const details = tx.transactionDetails || {};
                        const title = details.authenticator || 'Unknown';
                        const amount = details.amount ? `₹${details.amount}` : '₹0';
                        const date = details.authenticatorThree || 'Unknown';
                        const type = details.type || 'DEBIT';
                        const status = details.status || 'SUCCESS';
                        const url = tx.transactionDetailPageURL || '';
                        const orderIdMatch = url.match(/[?&]orderId=([^&]+)/);
                        const orderId = orderIdMatch ? orderIdMatch[1] : details.orderId || null;

                        insertTransaction(
                            `Wrapper JSON (Index ${idx})`,
                            title,
                            amount,
                            date,
                            type,
                            status,
                            url,
                            orderId
                        );
                    });
                }
            } catch (e) {
                console.error("[Amazon Pay Scraper] Error parsing Wrapper JSON property:", e);
            }
        }

        const hasMoreAttr = wrap.getAttribute('has-more-to-follow');
        hasMoreToFollow = (hasMoreAttr !== 'false');
    });

    // Check listViews for JSON data
    listViews.forEach((lv, idx) => {
        let parsedData = lv.data;
        if (!parsedData) {
            const dataAttr = lv.getAttribute('data');
            if (dataAttr) {
                try {
                    parsedData = JSON.parse(decodeHtml(dataAttr));
                } catch (err) {
                    console.warn(`[Diagnostic] Failed to parse List-View ${idx} data JSON attribute.`);
                }
            }
        }

        if (parsedData) {
            try {
                if (typeof parsedData === 'string') {
                    parsedData = JSON.parse(parsedData);
                }
                if (Array.isArray(parsedData)) {
                    parsedData.forEach(tx => {
                        if (!tx) return;
                        const details = tx.transactionDetails || {};
                        const title = details.authenticator || 'Unknown';
                        const amount = details.amount ? `₹${details.amount}` : '₹0';
                        const date = details.authenticatorThree || 'Unknown';
                        const type = details.type || 'DEBIT';
                        const status = details.status || 'SUCCESS';
                        const url = tx.transactionDetailPageURL || '';
                        const orderIdMatch = url.match(/[?&]orderId=([^&]+)/);
                        const orderId = orderIdMatch ? orderIdMatch[1] : details.orderId || null;

                        insertTransaction(
                            `List JSON (Index ${idx})`,
                            title,
                            amount,
                            date,
                            type,
                            status,
                            url,
                            orderId
                        );
                    });
                }
            } catch (e) {
                console.error("[Amazon Pay Scraper] Error parsing List-View JSON property:", e);
            }
        }
    });

    // 2. --- PHASE 2: DIRECT DEEP SHADOW DOM ELEMENT SCANNING ---
    const items = getAllElementsIncludingShadows('.transaction-item');

    items.forEach((item, itemIdx) => {
        // A. Title Extraction: Check slots first, fallback to the internal Shadow DOM title inside <tux-avatar>
        const titleEl = getAllElementsIncludingShadows('.transaction-name, [slot="avatar-title"], .transaction-title', item)[0];
        let title = 'Amazon Pay Transaction';

        if (titleEl) {
            title = titleEl.innerText.trim().replace(/\n/g, ' ');
        } else {
            const tuxAvatar = item.querySelector('tux-avatar');
            if (tuxAvatar && tuxAvatar.shadowRoot) {
                const shadowTitle = tuxAvatar.shadowRoot.querySelector('[part="title"] span') ||
                    tuxAvatar.shadowRoot.querySelector('[part="title"]');
                if (shadowTitle) {
                    title = shadowTitle.innerText.trim().replace(/\n/g, ' ');
                }
            }
        }

        // B. Amount: Find span inside slot avatar-right, or fallback currency scanning
        const amtEl = getAllElementsIncludingShadows('[slot="avatar-right"] .amount-section span, .amount-container span, .amount-section span', item)[0];
        let amountText = '₹0';
        if (amtEl) {
            amountText = amtEl.innerText.trim();
        } else {
            const spans = getAllElementsIncludingShadows('span', item);
            const currencySpan = spans.find(s => s.innerText.includes('₹') || s.innerText.includes('Rs') || s.innerText.includes('+') || s.innerText.includes('-'));
            if (currencySpan) {
                amountText = currencySpan.innerText.trim();
            }
        }

        // C. Date: Located inside the sealed shadow subtext part of the custom avatar component
        const dateEl = getAllElementsIncludingShadows('[part="lower-subtext"] span, [part="lower-subtext"]', item)[0];
        const date = dateEl ? dateEl.innerText.trim() : 'Unknown Date';

        // FIXED: Exclude month headers strictly matching Format "Month Name + Year" (e.g. "May 2026", "Jul 2025")
        // This ensures refund dates like "Expected Credit on: 06 Aug 2025" are NOT ignored!
        const isMonthHeader = /^[a-zA-Z]{3,10}\s+\d{4}$/.test(date.trim());
        if (isMonthHeader) {
            return; // Skip month separator headers safely
        }

        const type = amountText.includes('+') ? 'CREDIT' : 'DEBIT';
        const lowerText = item.innerText.toLowerCase();
        const titleLower = title.toLowerCase();
        const status = lowerText.includes('failed') ? 'FAILED' :
            ((lowerText.includes('cancelled') || titleLower.includes('ordered on amazon')) ? 'CANCELLED' : 'SUCCESS');

        let url = null;
        let orderId = null;
        const linkEl = item.querySelector('a') || item;
        if (linkEl && linkEl.href) {
            url = linkEl.href;
            const match = url.match(/[?&]orderId=([^&]+)/);
            if (match) {
                orderId = match[1];
            }
        }

        insertTransaction(
            `DOM Element (Row ${itemIdx})`,
            title,
            amountText,
            date,
            type,
            status,
            url,
            orderId
        );
    });
}

function countRenderedTransactionItems() {
    return getAllElementsIncludingShadows('.transaction-item').length;
}

// Dynamic layout headroom padding to overcome the "Short-Page Bottom-Out" scroll deadlock
function ensureScrollHeadroom(parent) {
    let spacer = document.getElementById('amazon-pay-scroll-spacer');
    if (!spacer) {
        spacer = document.createElement('div');
        spacer.id = 'amazon-pay-scroll-spacer';
        spacer.style.height = '120vh'; // Generous scroll runway depth
        spacer.style.width = '100%';
        spacer.style.pointerEvents = 'none';
        spacer.style.backgroundColor = 'transparent';

        if (parent && parent !== window) {
            parent.appendChild(spacer);
            console.log("%c [Spacer Debug] Appended a 120vh spacer to the custom scroll container.", "color: #9b59b6; font-weight: bold;");
        } else {
            document.body.appendChild(spacer);
            console.log("%c [Spacer Debug] Appended a 120vh spacer to document.body.", "color: #9b59b6; font-weight: bold;");
        }
    }
}

// Locates the correct loading observer component inside Shadow DOM roots
function findScrollSentinel() {
    const primarySentinels = getAllElementsIncludingShadows('intersection-observer-component, payui-loading-spinner');
    for (let el of primarySentinels) {
        const rect = el.getBoundingClientRect();
        if (rect.width > 0 || rect.height > 0) {
            return el;
        }
    }

    const fallbackSentinels = getAllElementsIncludingShadows('.spinner, svg.spinner-icon, [class*="spinner"]');
    for (let el of fallbackSentinels) {
        if (el.id && el.id.includes('rufus')) {
            continue; // Avoid matching Rufus virtual shopping assistant loader
        }
        const rect = el.getBoundingClientRect();
        if (rect.width > 0 || rect.height > 0) {
            return el;
        }
    }

    return null;
}

// Tracks parent elements upward to find scrolling container contexts
function getScrollParent(node) {
    if (!node) return null;
    if (node === document.body || node === document.documentElement) {
        return window;
    }
    if (node.scrollHeight > node.clientHeight) {
        const overflowY = window.getComputedStyle(node).overflowY;
        if (overflowY === 'auto' || overflowY === 'scroll') {
            return node;
        }
    }
    return getScrollParent(node.parentNode || node.host);
}

// Dispatches scroll lifecycle triggers up parent chains to refresh observers
function triggerSyntheticScroll(element) {
    try {
        window.dispatchEvent(new Event('scroll'));
        document.dispatchEvent(new Event('scroll'));

        let parent = element.parentElement || element.parentNode;
        while (parent) {
            parent.dispatchEvent(new Event('scroll', { bidi: true, bubbles: true }));
            if (parent.shadowRoot) {
                parent.shadowRoot.dispatchEvent(new Event('scroll', { bidi: true, bubbles: true }));
            }
            if (parent.host) {
                parent = parent.host;
            } else {
                parent = parent.parentElement || parent.parentNode;
            }
        }
    } catch (e) {
        console.warn("[Scroll Tester] Failed to dispatch synthetic scroll events:", e);
    }
}

function setupTransactionsListener() {
    waitForElement('payui-transaction-history-wrapper', null, (el) => {
        if (!el) {
            console.error('[Amazon Pay Scraper] History wrapper element not found.');
            finishWithError('Transaction wrapper not found.');
            return;
        }

        readTransactionsFromShadowDOM();
        console.log(`[Amazon Pay Scraper] Active listening pipeline spooled. Starting adaptive scroll loop...`);
        startScrollLoop();
    });
}

// Unified, high-speed, dynamic scroll loop with latency checking
function startScrollLoop() {
    let consecutiveStables = 0;
    let lastMapSize = 0;
    let scrollAttempts = 0;
    const maxScrolls = 250;
    const stableThreshold = 10; // Gives it ~25 seconds of patience on sluggish batches

    // Retrieve selected years dynamically from storage
    chrome.storage.local.get(["amazonTargetYears"], (res) => {
        // CRITICAL FIXED: Force default fallback if target years storage is unassigned, empty, or not an array to prevent Infinity minimum year values
        let targetYears = res.amazonTargetYears;
        if (!Array.isArray(targetYears) || targetYears.length === 0) {
            targetYears = [2026];
        }

        const minTargetYear = Math.min(...targetYears.map(y => parseInt(String(y).replace(/[^0-9]/g, ''), 10)));
        console.log(`[Amazon Pay Scraper] Selected years: ${JSON.stringify(targetYears)}. Minimum year target boundary set to: ${minTargetYear}`);

        const interval = setInterval(() => {
            const sentinel = findScrollSentinel();
            const scrollParent = getScrollParent(sentinel);
            ensureScrollHeadroom(scrollParent);

            // Check if Amazon's loading spinner is actively rotating in shadow root
            let isAmazonActiveLoading = false;
            const listViews = document.querySelectorAll('payui-transaction-history-list-view');
            listViews.forEach(lv => {
                if (lv.shadowRoot) {
                    const spinner = lv.shadowRoot.querySelector('payui-loading-spinner, .spinner, .loading-text, svg.spinner-icon, [class*="spinner"]');
                    if (spinner && (spinner.offsetWidth > 0 || spinner.offsetHeight > 0)) {
                        isAmazonActiveLoading = true;
                    }
                }
            });

            if (sentinel) {
                const sRect = sentinel.getBoundingClientRect();
                // console.log(`[Sentinel Found] Tag: <${sentinel.tagName.toLowerCase()}> | Viewport Bounds: top=${sRect.top.toFixed(1)}px, bottom=${sRect.bottom.toFixed(1)}px | Height=${sRect.height.toFixed(1)}px | IsIntersecting? ${sRect.top < window.innerHeight && sRect.bottom > 0}`);

                if (consecutiveStables > 0) {
                    // console.log("🔄 [Jitter Jolt Triggered] Counter is stable. Executing Double-Paint layout shift...");

                    const startY = window.scrollY || window.pageYOffset;
                    if (scrollParent && scrollParent !== window) {
                        scrollParent.scrollTop -= 400;
                    }
                    window.scrollBy({ top: -400, behavior: 'auto' });
                    triggerSyntheticScroll(sentinel);

                    setTimeout(() => {
                        sentinel.scrollIntoView({ behavior: 'auto', block: 'center' });
                        triggerSyntheticScroll(sentinel);
                    }, 80);

                } else {
                    // console.log("🎯 Sentinel found in active viewport. Centering instantly...");
                    sentinel.scrollIntoView({ behavior: 'auto', block: 'center' });
                    triggerSyntheticScroll(sentinel);
                }
            } else {
                // console.log("⚠️ Sentinel not visible/rendered yet. Nudging page down manually...");
                window.scrollBy({ top: 400, behavior: 'auto' });
            }

            scrollAttempts++;

            readTransactionsFromShadowDOM();
            const currentMapSize = compiledTransactionsMap.size;

            showStatusOverlay(
                isAmazonActiveLoading ? "Amazon Loading New Batch..." : "Scraping Ledger...",
                `Batch ${scrollAttempts} — ${currentMapSize} transactions recorded`
            );

            // Scan actual transaction dates for cutoffs
            let shouldDateStop = false;
            for (let tx of compiledTransactionsMap.values()) {
                let txDate = tx.transactionDetails?.authenticatorThree || '';
                if (isTransactionTooOld(txDate, minTargetYear)) {
                    shouldDateStop = true;
                    break;
                }
            }

            // console.log(`[Amazon Pay Scraper] Loop Check: mapSize=${currentMapSize}, ActiveNetLoading=${isAmazonActiveLoading}, DateCutoffTriggered=${shouldDateStop}`);

            // Update stability arrays logic based strictly on the unique map size
            if (currentMapSize === lastMapSize && currentMapSize > 0) {
                // If Amazon is actively downloading network streams, reset stables to 0 to keep the scraper alive!
                if (isAmazonActiveLoading) {
                    consecutiveStables = 0;
                } else {
                    consecutiveStables++;
                }
            } else {
                consecutiveStables = 0;
            }

            lastMapSize = currentMapSize;

            // CRITICAL FIXED: Do not exit through layout stability or end triggers if we have processed 0 items to survive page hydration intervals
            const isEndReached = (hasMoreToFollow === false && currentMapSize > 0);
            const isLayoutStable = (consecutiveStables >= stableThreshold && currentMapSize > 0);

            // Halt criteria evaluation
            const shouldStop = shouldDateStop ||
                isEndReached ||
                isLayoutStable ||
                (scrollAttempts >= maxScrolls) ||
                (currentMapSize === 0 && scrollAttempts >= 15); // Safeguard: 15 scroll attempts with absolutely 0 elements resolves as completed empty state

            if (shouldStop) {
                clearInterval(interval);
                window.amazonPayInterval = null;

                // Cleanup scroll headroom spacer
                const spacer = document.getElementById('amazon-pay-scroll-spacer');
                if (spacer) spacer.remove();

                // Filter out any trailing records that triggered the stop
                const finalTransactionsList = Array.from(compiledTransactionsMap.values()).filter(tx => {
                    let txDate = tx.transactionDetails?.authenticatorThree || '';
                    return !isTransactionTooOld(txDate, minTargetYear);
                });

                saveAndClose(finalTransactionsList);
            }
        }, 2500);

        window.amazonPayInterval = interval;
    });
}

function parseAmazonPayDate(dateStr) {
    if (!dateStr) return new Date(0);
    let clean = dateStr.replace(/(Expected Credit on:|Refund Completed:|Delivered on:|Cancelled on:|Refund completed:|Ordered on:|Credited on:)/gi, '').trim();
    const dateMatch = clean.match(/(\d{1,2})\s+([a-zA-Z]{3,10})\s+(\d{4})/);
    if (dateMatch) {
        const day = parseInt(dateMatch[1], 10);
        const monthStr = dateMatch[2].substring(0, 3).toLowerCase();
        const year = parseInt(dateMatch[3], 10);
        const months = {
            jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
            jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11
        };
        const month = months[monthStr] !== undefined ? months[monthStr] : 0;
        let hours = 0;
        let minutes = 0;
        const timeMatch = clean.match(/(\d{1,2}):(\d{2})\s*(AM|PM)?/i);
        if (timeMatch) {
            hours = parseInt(timeMatch[1], 10);
            minutes = parseInt(timeMatch[2], 10);
            const ampm = timeMatch[3];
            if (ampm) {
                if (ampm.toUpperCase() === 'PM' && hours < 12) {
                    hours += 12;
                } else if (ampm.toUpperCase() === 'AM' && hours === 12) {
                    hours = 0;
                }
            }
        }
        return new Date(year, month, day, hours, minutes);
    }
    const parsed = Date.parse(clean);
    return isNaN(parsed) ? new Date(0) : new Date(parsed);
}

function saveAndClose(transactions) {
    // Sort transactions descending (newest to oldest) before mapping
    transactions.sort((a, b) => {
        const dateA = parseAmazonPayDate(a.transactionDetails?.authenticatorThree);
        const dateB = parseAmazonPayDate(b.transactionDetails?.authenticatorThree);
        return dateB - dateA;
    });

    const processed = transactions.map((t, index) => {
        const details = t.transactionDetails || {};
        const rawAmount = details.amount ? String(details.amount).replace(/[^0-9.]/g, '') : '0';
        const amount = parseFloat(rawAmount) || 0;
        const url = t.transactionDetailPageURL || '';
        const orderIdMatch = url.match(/[?&]orderId=([^&]+)/);
        const orderId = orderIdMatch ? orderIdMatch[1] : details.orderId || null;

        return {
            Index: index,
            Title: details.authenticator || 'Amazon Pay Transaction',
            AmountText: `₹${rawAmount}`,
            Amount: amount,
            Type: details.type || 'DEBIT',
            Date: details.authenticatorThree || 'Unknown Date',
            Status: details.status || 'SUCCESS',
            OrderId: orderId
        };
    });

    chrome.storage.local.get("amazonScraperStatus", (ordersRes) => {
        chrome.storage.local.set({
            amazonPayHistory: processed,
            amazonPayScrapingActive: false
        }, () => {
            showCompletionOverlay(processed.length);
            if (ordersRes.amazonScraperStatus === "completed") {
                chrome.runtime.sendMessage({ action: "extractionComplete" }, (res) => {
                    if (chrome.runtime.lastError) { /* ignore */ }
                });
            }
            setTimeout(() => {
                chrome.runtime.sendMessage({ action: "closeTab" });
            }, 3000);
        });
    });
}

function finishWithError(err) {
    console.error(`[Amazon Pay Scraper] Error: ${err}`);
    chrome.storage.local.set({ amazonPayScrapingActive: false }, () => {
        chrome.runtime.sendMessage({ action: "closeTab" });
    });
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "stopScraping") {
        console.log("[Amazon Pay Scraper] Stop command received. Terminating processes...");
        if (window.amazonPayInterval) {
            clearInterval(window.amazonPayInterval);
            window.amazonPayInterval = null;
        }
        const spacer = document.getElementById('amazon-pay-scroll-spacer');
        if (spacer) spacer.remove();
        chrome.storage.local.set({ amazonPayScrapingActive: false }, () => {
            const overlay = document.getElementById('amazonPayScraperOverlay');
            if (overlay) overlay.remove();
            sendResponse({ status: "stopped" });
            chrome.runtime.sendMessage({ action: "closeTab" });
        });
    }
    return true;
});