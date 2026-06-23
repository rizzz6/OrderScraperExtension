console.log("%c ⚡ Exporter Engine Connected natively to Tab View! ⚡ ", 'background: #2874f0; color: #fff; font-size: 13px; font-weight: bold;');

if (!window.scraperState) {
    window.scraperState = {
        status: "idle",
        itemCount: 0,
        orders: [],
        coinsHistory: []
    };
}

if (window.location.pathname.includes('/account/orders')) {
    // Check storage for completed state on page load
    chrome.storage.local.get(["scraperStatus", "orders", "coinsHistory"], (res) => {
        if (res.scraperStatus === "completed" && res.orders && res.orders.length > 0) {
            window.scraperState = {
                status: "completed",
                orders: res.orders,
                coinsHistory: res.coinsHistory || [],
                itemCount: res.orders.length
            };
            console.log("[Scraper Engine] Restored completed state from local storage.");
            if (document.readyState === "loading") {
                document.addEventListener("DOMContentLoaded", () => {
                    showFloatingControlPanel(res.orders, res.coinsHistory || []);
                });
            } else {
                showFloatingControlPanel(res.orders, res.coinsHistory || []);
            }
        }
    });

    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (request.action === "startScraping") {
            if (window.scraperState && window.scraperState.status !== "idle") {
                console.log(`%c 📥 [Extension] Start command received, but scraper is already in state: ${window.scraperState.status}. Returning state. `, 'background: #2874f0; color: #fff; font-weight: bold;');
                sendResponse(window.scraperState);
                return true;
            }
            console.log("%c 📥 [Extension] Start command received! Booting scraper engine... ", 'background: #2874f0; color: #fff; font-weight: bold;');

            // Set flag and open background coins tab
            chrome.storage.local.set({ coinsScrapingActive: true, coinsHistory: [] }, () => {
                chrome.runtime.sendMessage({ action: "openCoinsTab" });
            });

            runScraperEngine(request.scope);
            showFlipkartScraperOverlay("Scraping Orders...", "Initializing page scanning...");
            sendResponse({ status: "started" });
        } else if (request.action === "checkStatus") {
            sendResponse(window.scraperState);
        } else if (request.action === "stopScraping") {
            console.log("[Scraper Engine] Stop command received. Terminating processes...");
            window.scraperState.status = "idle";
            if (window.activeObserver) {
                window.activeObserver.disconnect();
                window.activeObserver = null;
            }
            if (window.activeFallbackInterval) {
                clearInterval(window.activeFallbackInterval);
                window.activeFallbackInterval = null;
            }
            if (window.activeCoinsCheckInterval) {
                clearInterval(window.activeCoinsCheckInterval);
                window.activeCoinsCheckInterval = null;
            }
            let overlay = document.getElementById('flipkartOrdersScraperOverlay');
            if (overlay) overlay.remove();
            chrome.storage.local.set({ scraperStatus: "idle", coinsScrapingActive: false }, () => {
                sendResponse({ status: "stopped" });
            });
        } else if (request.action === "resetState") {
            window.scraperState = {
                status: "idle",
                itemCount: 0,
                orders: [],
                coinsHistory: []
            };
            if (window.activeObserver) {
                window.activeObserver.disconnect();
                window.activeObserver = null;
            }
            if (window.activeFallbackInterval) {
                clearInterval(window.activeFallbackInterval);
                window.activeFallbackInterval = null;
            }
            if (window.activeCoinsCheckInterval) {
                clearInterval(window.activeCoinsCheckInterval);
                window.activeCoinsCheckInterval = null;
            }
            let dock = document.getElementById('flipkartScraperControlDock');
            if (dock) dock.remove();
            sendResponse({ status: "idle" });
        }
        return true;
    });
} else if (window.location.pathname.includes('/plus/coins-activity')) {
    chrome.storage.local.get("coinsScrapingActive", (res) => {
        if (res.coinsScrapingActive) {
            setTimeout(runCoinsScraperEngine, 1500);
        }
    });

    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (request.action === "stopScraping") {
            console.log("[Coins Scraper] Stop command received via runtime message. Terminating...");
            const stopBtn = document.getElementById('inPageStopCoinsBtn');
            if (stopBtn) {
                stopBtn.click();
            } else {
                chrome.storage.local.set({ coinsScrapingActive: false }, () => {
                    let overlay = document.getElementById('coinsScraperOverlay');
                    if (overlay) overlay.remove();
                    chrome.runtime.sendMessage({ action: "closeTab" });
                });
            }
            sendResponse({ status: "stopped" });
        }
        return true;
    });
}

function runScraperEngine(scope = 'all') {
    if (window.scraperState && window.scraperState.status !== "idle") {
        console.warn("⚠️ Scraper engine is already running or has run on this page.");
        return;
    }
    window.scraperState = {
        status: "running",
        itemCount: 0,
        orders: [],
        coinsHistory: []
    };
    window.hasFlipkartScraperRun = true;
    console.log(`%c 🚀 Scraper Engine Online! Scope: ${scope}. Mutation tracking & fallback scroll loops active. `, 'background: #27ae60; color: #fff; font-weight: bold; padding: 4px;');

    let currentYear = new Date().getFullYear();
    let cutoffYear = 0;
    if (scope === 'current') {
        cutoffYear = currentYear;
    } else if (scope === 'last3') {
        cutoffYear = currentYear - 2;
    }

    let lastItemCount = document.querySelectorAll('.ZcgLRi').length;
    window.scraperState.itemCount = lastItemCount;
    console.log(`📊 Initial order items count: ${lastItemCount}`);

    let fallbackInterval = null;
    let isTerminated = false;

    function scanAndProcessPage() {
        if (isTerminated) return;

        if (cutoffYear > 0) {
            let cards = document.querySelectorAll('.ZcgLRi');
            if (cards.length > 0) {
                let lastCard = cards[cards.length - 1];
                let dateEl = lastCard.querySelector('.sNKed5');
                if (dateEl) {
                    let parsed = parseDate(dateEl.innerText.trim());
                    if (parsed.valid && parsed.year < cutoffYear) {
                        console.log(`%c 🛑 Reached order year (${parsed.year}) older than cutoff (${cutoffYear}). Compiling dataset... `, 'background: #d32f2f; color: #fff; font-weight: bold; padding: 4px;');
                        compileFinalDataset();
                        return;
                    }
                }
            }
        }

        let endMarker = Array.from(document.querySelectorAll('button, span, div, p')).find(el => {
            let text = el.innerText ? el.innerText.trim().toLowerCase() : '';
            return text.includes('no more results to display');
        });

        if (endMarker) {
            console.log("%c 🛑 End of order history reached ('No more results to display' found). Compiling dataset... ", 'background: #d32f2f; color: #fff; font-weight: bold; padding: 4px;');
            compileFinalDataset();
            return;
        }

        let btn = Array.from(document.querySelectorAll('button, span')).find(el => {
            let text = el.innerText ? el.innerText.trim().toLowerCase() : '';
            return text.includes('show more orders');
        });

        if (btn && (btn.offsetWidth > 0 || btn.offsetHeight > 0)) {
            console.log("🖱️ 'Show more orders' button found. Clicking to load more...");
            btn.focus();
            btn.click();
        }
    }

    const observer = new MutationObserver(() => {
        if (isTerminated) return;
        let currentItemCount = document.querySelectorAll('.ZcgLRi').length;
        if (currentItemCount > lastItemCount) {
            console.log(`📈 New items detected. Count increased from ${lastItemCount} to ${currentItemCount}. Scrolling down...`);
            lastItemCount = currentItemCount;
            window.scraperState.itemCount = currentItemCount;
            showFlipkartScraperOverlay("Scraping Orders...", `Scanned ${currentItemCount} items...`);
            window.scrollTo(0, document.body.scrollHeight);
            setTimeout(scanAndProcessPage, 50);
        } else {
            scanAndProcessPage();
        }
    });

    observer.observe(document.body, { childList: true, subtree: true });
    window.activeObserver = observer;
    window.scrollTo(0, document.body.scrollHeight);
    setTimeout(scanAndProcessPage, 500);

    fallbackInterval = setInterval(() => {
        if (isTerminated) return;
        console.log("🔄 Fallback check scrolling and checking for new elements...");
        let currentItemCount = document.querySelectorAll('.ZcgLRi').length;
        showFlipkartScraperOverlay("Scraping Orders...", `Scanned ${currentItemCount} items...`);
        scanAndProcessPage();
        window.scrollBy(0, -150);
        window.scrollTo(0, document.body.scrollHeight);
    }, 3000);
    window.activeFallbackInterval = fallbackInterval;

    function compileFinalDataset() {
        isTerminated = true;
        window.hasFlipkartScraperTerminated = true;
        observer.disconnect();
        clearInterval(fallbackInterval);

        console.log("[Scraper Engine] Orders scrape done. Waiting for background Coins scrape to finish...");
        showFlipkartScraperOverlay("Waiting for Coins Scraper", "Orders completed. Gathering SuperCoin details...");

        let checkCount = 0;
        let checkInterval = setInterval(() => {
            chrome.storage.local.get(["coinsScrapingActive", "coinsHistory"], (res) => {
                checkCount++;
                if (!res.coinsScrapingActive || checkCount >= 60) { // Increased from 15 to 60 (waits up to 120s)
                    clearInterval(checkInterval);
                    window.activeCoinsCheckInterval = null;
                    console.log("[Scraper Engine] Coins scraping finished or timed out. Proceeding to compile final dataset...");
                    let overlay = document.getElementById('flipkartOrdersScraperOverlay');
                    if (overlay) overlay.remove();
                    processFinalCompilation(res.coinsHistory || []);
                } else {
                    console.log("[Scraper Engine] Coins scraping still in progress...");
                }
            });
        }, 2000);
        window.activeCoinsCheckInterval = checkInterval;
    }

    function processFinalCompilation(coinsHistory) {
        let orders = [];
        let cardElements = document.querySelectorAll('.ZcgLRi');
        console.log(`📦 Scraping completed! Processing ${cardElements.length} order card elements...`);

        cardElements.forEach(card => {
            let orderId = "N/A";
            let cardText = card.innerText || "";
            let odTextMatch = cardText.match(/\b(OD\d{15,20})\b/);
            if (odTextMatch) {
                orderId = odTextMatch[1];
            } else {
                let links = card.querySelectorAll('a');
                for (let link of links) {
                    let href = link.getAttribute('href') || "";
                    let odHrefMatch = href.match(/\b(OD\d{15,20})\b/);
                    if (odHrefMatch) {
                        orderId = odHrefMatch[1];
                        break;
                    }
                    let urlParams = new URLSearchParams(href.split('?')[1] || "");
                    let orderIdParam = urlParams.get('order_id') || urlParams.get('orderId');
                    if (orderIdParam) {
                        orderId = orderIdParam;
                        break;
                    }
                    let orderPathMatch = href.match(/\/orders\/(OD\w+)/i);
                    if (orderPathMatch) {
                        orderId = orderPathMatch[1];
                        break;
                    }
                }
            }

            let orderItems = card.querySelectorAll('a.kok32b, div.kok32b');
            orderItems.forEach(item => {
                let titleEl = item.querySelector('.G6wtLH') ||
                    Array.from(item.querySelectorAll('span, .row')).find(el => {
                        let text = el.innerText ? el.innerText.trim() : '';
                        return text.length > 0 && !text.includes('shared this order') && !text.includes('Delivered') && !text.includes('Cancelled');
                    });

                let priceEl = item.querySelector('.QF9IHY');
                let dateEl = item.querySelector('.sNKed5');

                if (priceEl && dateEl) {
                    let title = titleEl ? titleEl.innerText.trim().replace(/\n/g, ' ') : "Unknown Item";
                    let fullPriceText = priceEl.innerText;

                    let price = parseInt(fullPriceText.split('+')[0].replace(/[^0-9]/g, ''), 10) || 0;
                    let supercoins = 0;
                    let coinMatch = fullPriceText.match(/\+\s*([0-9]+)/);
                    if (coinMatch) supercoins = parseInt(coinMatch[1], 10) || 0;

                    let statusText = dateEl.innerText.trim();
                    let statusLower = statusText.toLowerCase();
                    let category = 'Delivered/Kept';

                    if (statusLower.includes('cancelled') || statusLower.includes('cancellation completed')) {
                        if (!statusLower.includes('cancellation cancelled')) category = 'Cancelled';
                    } else if (statusLower.includes('refund')) {
                        if (!statusLower.includes('refund cancelled')) category = 'Refunded';
                    }

                    if (price > 0 || supercoins > 0) {
                        orders.push({
                            OrderId: orderId,
                            Date: statusText,
                            Category: category,
                            Item: title,
                            CashAmount: price,
                            SupercoinsUsed: supercoins
                        });
                    }
                }
            });
        });

        if (cutoffYear > 0) {
            orders = orders.filter(o => {
                let parsed = parseDate(o.Date);
                return parsed.valid && parsed.year >= cutoffYear;
            });
        }

        // Calculate Totals per Category
        let deliveredItems = orders.filter(o => o.Category === 'Delivered/Kept');
        let totalCash = deliveredItems.reduce((sum, o) => sum + o.CashAmount, 0);
        let totalCoins = orders.reduce((sum, o) => sum + o.SupercoinsUsed, 0);

        console.table(orders);
        console.log(`%c True Cash Spent: ₹${totalCash.toLocaleString('en-IN')} | Total Supercoins Accounted: ${totalCoins} `, 'background: #2874f0; color: #fff; font-size: 15px; font-weight: bold; padding: 6px 12px;');

        // Save results in global state
        window.scraperState.status = "completed";
        window.scraperState.orders = orders;
        window.scraperState.coinsHistory = coinsHistory;
        window.scraperState.itemCount = orders.length;

        // Save to local storage for persistence across reloads/sessions
        chrome.storage.local.set({
            scraperStatus: "completed",
            orders: orders,
            coinsHistory: coinsHistory
        }, () => {
            console.log("[Scraper Engine] Complete results saved to chrome.storage.local");
            chrome.runtime.sendMessage({ action: "extractionComplete" }, (res) => {
                if (chrome.runtime.lastError) { /* ignore */ }
            });
        });

        showFloatingControlPanel(orders, coinsHistory);
    }
}

function injectGoogleFonts() {
    if (!document.getElementById('flipkartScraperGoogleFonts')) {
        let link1 = document.createElement('link');
        link1.rel = 'preconnect';
        link1.href = 'https://fonts.googleapis.com';
        let link2 = document.createElement('link');
        link2.rel = 'preconnect';
        link2.href = 'https://fonts.gstatic.com';
        link2.crossOrigin = 'anonymous';
        let link3 = document.createElement('link');
        link3.id = 'flipkartScraperGoogleFonts';
        link3.rel = 'stylesheet';
        link3.href = 'https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700&display=swap';
        document.head.appendChild(link1);
        document.head.appendChild(link2);
        document.head.appendChild(link3);
    }
}

function showFloatingControlPanel(orders, coinsHistory) {
    if (document.getElementById('flipkartScraperControlDock')) return;

    injectGoogleFonts();

    let controlDock = document.createElement('div');
    controlDock.id = 'flipkartScraperControlDock';
    controlDock.style.cssText = 'position: fixed; bottom: 24px; right: 24px; background: rgba(255, 255, 255, 0.85); backdrop-filter: blur(12px) saturate(180%); -webkit-backdrop-filter: blur(12px) saturate(180%); border: 1px solid rgba(255, 255, 255, 0.4); padding: 20px; border-radius: 16px; z-index: 10000000; box-shadow: 0 10px 30px rgba(0, 0, 0, 0.1), inset 0 1px 1px rgba(255, 255, 255, 0.3); font-family: "Outfit", sans-serif; width: 280px; text-align: center; box-sizing: border-box;';

    controlDock.innerHTML = `
        <style>
            #flipkartScraperControlDock * { box-sizing: border-box; }
            #closeDock:hover { background: rgba(0,0,0,0.1) !important; color: #1e293b !important; }
            .dock-btn {
                font-family: 'Outfit', sans-serif;
                font-weight: 600;
                font-size: 13px;
                padding: 10px 14px;
                border: none;
                border-radius: 8px;
                cursor: pointer;
                width: 100%;
                display: flex;
                align-items: center;
                justify-content: center;
                gap: 8px;
                margin-bottom: 8px;
                color: white;
                transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
                box-shadow: 0 2px 4px rgba(0, 0, 0, 0.05);
            }
            .dock-btn:hover {
                transform: translateY(-1px);
            }
            .dock-btn-csv {
                background: linear-gradient(135deg, #10b981, #059669);
            }
            .dock-btn-csv:hover {
                background: linear-gradient(135deg, #059669, #047857);
                box-shadow: 0 4px 12px rgba(16, 185, 129, 0.3);
            }
            .dock-btn-coins {
                background: linear-gradient(135deg, #f59e0b, #d97706);
            }
            .dock-btn-coins:hover {
                background: linear-gradient(135deg, #d97706, #b45309);
                box-shadow: 0 4px 12px rgba(245, 158, 11, 0.3);
            }
            .dock-btn-pdf {
                background: linear-gradient(135deg, #475569, #334155);
            }
            .dock-btn-pdf:hover {
                background: linear-gradient(135deg, #334155, #1e293b);
                box-shadow: 0 4px 12px rgba(71, 85, 105, 0.3);
            }
        </style>
        <div style="position: absolute; top: 12px; right: 12px; cursor: pointer; display: flex; align-items: center; justify-content: center; width: 24px; height: 24px; border-radius: 50%; background: rgba(0,0,0,0.05); color: #64748b; font-size: 14px; font-weight: bold; transition: all 0.2s;" id="closeDock">×</div>
        <div style="display: flex; align-items: center; justify-content: center; gap: 8px; font-weight: 700; color: #1e293b; font-size: 15px; margin-bottom: 6px;">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>
            Scraping Complete
        </div>
        <div style="font-size: 11px; color: #64748b; margin-bottom: 16px; font-weight: 500; line-height: 1.4;">Cached ${orders.length} order entries. Select your target format:</div>
        <button id="dockCSV" class="dock-btn dock-btn-csv">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
            Download Orders CSV
        </button>
        <button id="dockCoinsCSV" class="dock-btn dock-btn-coins">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
            Download Coins CSV
        </button>
        <button id="dockPDF" class="dock-btn dock-btn-pdf" style="margin-bottom: 0;">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>
            Generate Financial PDF
        </button>
    `;
    document.body.appendChild(controlDock);

    document.getElementById('closeDock').addEventListener('click', () => {
        controlDock.remove();
    });

    document.getElementById('dockCSV').addEventListener('click', () => {
        let csvContent = "data:text/csv;charset=utf-8,OrderId,Date,Category,Item,CashAmount,SupercoinsUsed\n" +
            orders.map(e => `"${e.OrderId || 'N/A'}","${getStandardizedDateString(e.Date, 'Flipkart')}","${e.Category}","${e.Item.replace(/"/g, '""')}",${e.CashAmount},${e.SupercoinsUsed}`).join("\n");
        let link = document.createElement("a");
        link.setAttribute("href", encodeURI(csvContent));
        link.setAttribute("download", "flipkart_order_history.csv");
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    });

    document.getElementById('dockCoinsCSV').addEventListener('click', () => {
        if (!coinsHistory || coinsHistory.length === 0) {
            alert("No SuperCoin history available to export!");
            return;
        }
        let csvContent = "data:text/csv;charset=utf-8,Date,ActivityDetails,Type,Amount\n" +
            coinsHistory.map(e => `"${getStandardizedDateString(e.Date, 'Flipkart')}","${e.Title.replace(/"/g, '""')}","${e.Type}",${e.Amount}`).join("\n");
        let link = document.createElement("a");
        link.setAttribute("href", encodeURI(csvContent));
        link.setAttribute("download", "flipkart_supercoin_history.csv");
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    });

    document.getElementById('dockPDF').addEventListener('click', () => {
        let printWindow = window.open('', '_blank');
        printWindow.document.write(buildPDFHTML(orders, coinsHistory));
        printWindow.document.close();
        setTimeout(() => {
            printWindow.print();
            window.hasFlipkartScraperRun = false;
            window.hasFlipkartScraperTerminated = false;
            controlDock.remove();
        }, 1000);
    });
}

function parseDate(dateStr) {
    if (!dateStr) return { valid: false };

    // A valid date string in Flipkart must contain a month name
    const monthRegex = /(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i;
    if (!monthRegex.test(dateStr)) {
        return { valid: false };
    }

    let clean = dateStr
        .replace(/delivered on/i, '')
        .replace(/cancelled on/i, '')
        .replace(/refund completed/i, '')
        .replace(/refund completed on/i, '')
        .replace(/refund/i, '')
        .replace(/completed/i, '')
        .replace(/credited on/i, '')
        .replace(/debited on/i, '')
        .replace(/credited/i, '')
        .replace(/debited/i, '')
        .replace(/on/i, '')
        .trim();

    let yearMatch = clean.match(/\b(20\d{2})\b/);
    let year;
    if (yearMatch) {
        year = parseInt(yearMatch[1], 10);
    } else {
        year = new Date().getFullYear();
        clean = `${clean}, ${year}`;
    }

    let parsed = Date.parse(clean);
    if (!isNaN(parsed)) {
        let d = new Date(parsed);
        return { valid: true, month: d.getMonth(), year: d.getFullYear(), clean: clean };
    }

    let months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
    let lower = clean.toLowerCase();
    let monthIndex = months.findIndex(m => lower.includes(m));
    if (monthIndex !== -1) {
        return { valid: true, month: monthIndex, year: year, clean: clean };
    }

    return { valid: false };
}

function getAnalytics(orders) {
    let delivered = orders.filter(o => o.Category === 'Delivered/Kept');

    let highestCosting = null;
    let lowestCosting = null;

    if (delivered.length > 0) {
        let sortedDelivered = [...delivered].sort((a, b) => b.CashAmount - a.CashAmount);
        highestCosting = sortedDelivered[0];

        let nonZeroDelivered = sortedDelivered.filter(o => o.CashAmount > 0);
        if (nonZeroDelivered.length > 0) {
            lowestCosting = nonZeroDelivered[nonZeroDelivered.length - 1];
        }
    }

    let monthlySpend = {};
    let monthlyCount = {};
    let yearlySpend = {};

    orders.forEach(o => {
        let parsed = parseDate(o.Date);
        if (parsed.valid) {
            let monthLabel = new Date(parsed.year, parsed.month).toLocaleString('en-IN', { month: 'short', year: 'numeric' });
            let yearLabel = String(parsed.year);

            monthlyCount[monthLabel] = (monthlyCount[monthLabel] || 0) + 1;

            if (o.Category === 'Delivered/Kept') {
                monthlySpend[monthLabel] = (monthlySpend[monthLabel] || 0) + o.CashAmount;

                if (!yearlySpend[yearLabel]) {
                    yearlySpend[yearLabel] = { cash: 0, coins: 0 };
                }
                yearlySpend[yearLabel].cash += o.CashAmount;
                yearlySpend[yearLabel].coins += o.SupercoinsUsed;
            }
        }
    });

    let peakSpendMonth = { label: "N/A", amount: 0 };
    for (let month in monthlySpend) {
        if (monthlySpend[month] > peakSpendMonth.amount) {
            peakSpendMonth = { label: month, amount: monthlySpend[month] };
        }
    }

    let mostActiveMonth = { label: "N/A", count: 0 };
    for (let month in monthlyCount) {
        if (monthlyCount[month] > mostActiveMonth.count) {
            mostActiveMonth = { label: month, count: monthlyCount[month] };
        }
    }

    let totalSpent = delivered.reduce((sum, o) => sum + o.CashAmount, 0);
    let avgOrderValue = delivered.length > 0 ? Math.round(totalSpent / delivered.length) : 0;
    let successRate = orders.length > 0 ? Math.round((delivered.length / orders.length) * 100) : 0;

    return {
        highestCosting,
        lowestCosting,
        peakSpendMonth,
        mostActiveMonth,
        averageOrderValue: avgOrderValue,
        successRate,
        yearlySpend
    };
}

function getCoinsAnalytics(coinsHistory, orders = []) {
    let totalEarned = 0;
    let totalUsed = 0;
    let totalExpired = 0;

    let monthlyGained = {};
    let monthlyExpired = {};

    // 1. Calculate purchase coins used from Order History (complete lifetime data)
    let delivered = orders.filter(o => o.Category === 'Delivered/Kept');
    let orderCoinsUsed = delivered.reduce((sum, o) => sum + o.SupercoinsUsed, 0);
    totalUsed = orderCoinsUsed;

    // 2. Loop through coins history to find earnings, expirations, and non-order debits
    coinsHistory.forEach(c => {
        let amount = Math.abs(c.Amount);
        let parsed = parseDate(c.Date);
        let monthLabel = "Unknown";
        if (parsed.valid) {
            monthLabel = new Date(parsed.year, parsed.month).toLocaleString('en-IN', { month: 'short', year: 'numeric' });
        }

        if (c.Type === "Credited") {
            totalEarned += amount;
            if (monthLabel !== "Unknown") {
                monthlyGained[monthLabel] = (monthlyGained[monthLabel] || 0) + amount;
            }
        } else if (c.Type === "Debited") {
            if (c.Title.toLowerCase().includes("expire")) {
                totalExpired += amount;
                if (monthLabel !== "Unknown") {
                    monthlyExpired[monthLabel] = (monthlyExpired[monthLabel] || 0) + amount;
                }
            } else {
                // Check if this is a partner redemption / non-order debit
                // (e.g. JioMart, vouchers, coupons, subscriptions, memberships, etc.)
                let titleLower = c.Title.toLowerCase();
                let isNonOrderDebit = titleLower.includes("jiomart") ||
                    titleLower.includes("redeemed for") ||
                    titleLower.includes("voucher") ||
                    titleLower.includes("coupon") ||
                    titleLower.includes("subscription") ||
                    titleLower.includes("membership") ||
                    titleLower.includes("play store") ||
                    titleLower.includes("google play") ||
                    titleLower.includes("pass") ||
                    titleLower.includes("ticket") ||
                    titleLower.includes("deal");

                if (isNonOrderDebit) {
                    totalUsed += amount; // Add partner redemptions to total coins used
                }
            }
        }
    });

    let peakGainMonth = { label: "N/A", amount: 0 };
    for (let month in monthlyGained) {
        if (monthlyGained[month] > peakGainMonth.amount) {
            peakGainMonth = { label: month, amount: monthlyGained[month] };
        }
    }

    let peakExpireMonth = { label: "N/A", amount: 0 };
    for (let month in monthlyExpired) {
        if (monthlyExpired[month] > peakExpireMonth.amount) {
            peakExpireMonth = { label: month, amount: monthlyExpired[month] };
        }
    }

    return {
        totalEarned,
        totalUsed,
        totalExpired,
        peakGainMonth,
        peakExpireMonth
    };
}

function categorizeItem(title) {
    const t = title.toLowerCase();

    // Check Grocery basket items first
    if (t.includes("basket") || t.includes("items") && (t.includes("kilos") || t.includes("minutes"))) {
        return "Grocery";
    }

    // Books & Education
    if (
        t.includes("semester") || t.includes("class 12") || t.includes("suggestions") ||
        t.includes("wb jee") || t.includes("practice papers") || t.includes("exam") ||
        t.includes("book") || t.includes("unruled paper") || t.includes("paper yellow") ||
        t.includes("madhyamik") || t.includes("wbbse") || t.includes("wbjee") ||
        t.includes("syllabus") || t.includes("dictionary") || t.includes("notebook") ||
        t.includes("pen") || t.includes("pencil")
    ) {
        return "Books & Education";
    }

    // Beauty & Personal Care
    if (
        t.includes("glutafine") || t.includes("mcaffeine") || t.includes("detan") ||
        t.includes("body wash") || t.includes("sunscreen") || t.includes("solasafe") ||
        t.includes("serum") || t.includes("brightening") || t.includes("tongue cleaner") ||
        t.includes("mulethi") || t.includes("coconut oil") || t.includes("hair removal") ||
        t.includes("razor") || t.includes("tide") || t.includes("nivea") ||
        t.includes("glycerine") || t.includes("colgate") || t.includes("toothpaste") ||
        t.includes("dove") || t.includes("acnilite") || t.includes("tresme") ||
        t.includes("veet") || t.includes("condoms") || t.includes("deodorant") ||
        t.includes("perfume") || t.includes("lipstick") || t.includes("eye shadow") ||
        t.includes("gillette") || t.includes("moisturizing") || t.includes("waxing") ||
        t.includes("lotion") || t.includes("body milk") || t.includes("rose water") ||
        t.includes("soap") || t.includes("facial") || t.includes("shampoo") ||
        t.includes("cream") || t.includes("facewash") || t.includes("face wash") ||
        t.includes("cleaner") || t.includes("cleanser") || t.includes("l'oréal") ||
        t.includes("loreal") || t.includes("lakmé") || t.includes("lakme") ||
        t.includes("grooming") || t.includes("whisper") || t.includes("hygiene") ||
        t.includes("scrunchies") || t.includes("lip") || t.includes("blush") ||
        t.includes("eyeliner") || t.includes("mascara") || t.includes("hair color") ||
        t.includes("durex") || t.includes("pears") || t.includes("after shave") ||
        t.includes("shaving") || t.includes("panties") || t.includes("period") ||
        t.includes("cramp") || t.includes("acno fight") || t.includes("face mist") ||
        t.includes("leaves") || t.includes("nail cutter") || t.includes("dry glove") ||
        t.includes("glove")
    ) {
        return "Beauty & Personal Care";
    }

    // Electronics & Gadgets
    if (
        t.includes("led") || t.includes("panel") || t.includes("guard") ||
        t.includes("tempered") || t.includes("glass") || t.includes("cmf") ||
        t.includes("nothing") || t.includes("pixel") || t.includes("galaxy") ||
        t.includes("charger") || t.includes("aux") || t.includes("cable") ||
        t.includes("geyser") || t.includes("induction") || t.includes("remote") ||
        t.includes("calculator") || t.includes("samsung") || t.includes("oneplus") ||
        t.includes("laptop") || t.includes("backpack") || t.includes("casio") ||
        t.includes("electronic") || t.includes("water heater") || t.includes("phone") ||
        t.includes("mobile") || t.includes("smartwatch") || t.includes("watch") ||
        t.includes("headphone") || t.includes("earphone") || t.includes("adapter") ||
        t.includes("power bank") || t.includes("router") || t.includes("camera") ||
        t.includes("tv") || t.includes("television") || t.includes("speaker") ||
        t.includes("fan") || t.includes("atomberg") || t.includes("wi-fi") ||
        t.includes("purifier") || t.includes("keyboard") || t.includes("mouse") ||
        t.includes("refrigerator") || t.includes("washing machine") || t.includes("appliances")
    ) {
        return "Electronics & Gadgets";
    }

    // Fashion & Apparel
    if (
        t.includes("girls") || t.includes("cotton top") || t.includes("flats") ||
        t.includes("women casual") || t.includes("slides") || t.includes("sneakers") ||
        t.includes("bata") || t.includes("puma") || t.includes("shrug") ||
        t.includes("shirt") || t.includes("casual t-shirt") || t.includes("nightdress") ||
        t.includes("hotpants") || t.includes("trousers") || t.includes("socks") ||
        t.includes("women") || t.includes("men") || t.includes("casual") ||
        t.includes("flats") || t.includes("slides") || t.includes("sneakers") ||
        t.includes("sandals") || t.includes("shoes") || t.includes("slippers") ||
        t.includes("apparel") || t.includes("clothing") || t.includes("tshirt") ||
        t.includes("t-shirt") || t.includes("kurti") || t.includes("jeans") ||
        t.includes("top") || t.includes("dress") || t.includes("suit") ||
        t.includes("shrug") || t.includes("blouse") || t.includes("saree") ||
        t.includes("shorts") || t.includes("romper") || t.includes("babygo") ||
        t.includes("kuchipoo") || t.includes("boys") || t.includes("track") ||
        t.includes("shoelace") || t.includes("belt") || t.includes("wallet") ||
        t.includes("glove") || t.includes("scarf") || t.includes("sunglasses") ||
        t.includes("earrings") || t.includes("mangalsutra") || t.includes("tanmaniya") ||
        t.includes("jewellery") || t.includes("bracelet") || t.includes("bangle") ||
        t.includes("watch") || t.includes("titan") || t.includes("raga") ||
        t.includes("asian") || t.includes("flip flops")
    ) {
        return "Fashion & Apparel";
    }

    // Home & Living
    if (
        t.includes("mop") || t.includes("stick") || t.includes("table plac") ||
        t.includes("pruner") || t.includes("trigger") || t.includes("plugs") ||
        t.includes("toilet brush") || t.includes("kitchen") || t.includes("cushions") ||
        t.includes("covers") || t.includes("kettle") || t.includes("gas saver") ||
        t.includes("burner") || t.includes("bean bag") || t.includes("blanket") ||
        t.includes("dohar") || t.includes("rack") || t.includes("vase") ||
        t.includes("shelf") || t.includes("plier") || t.includes("taparia") ||
        t.includes("screwdriver") || t.includes("tool") || t.includes("gardening") ||
        t.includes("seed") || t.includes("plant") || t.includes("nursery") ||
        t.includes("fertilizer") || t.includes("juicer") || t.includes("mixer") ||
        t.includes("blender") || t.includes("kitchen") || t.includes("bottle") ||
        t.includes("vacuum insulated") || t.includes("sieve") || t.includes("sifter") ||
        t.includes("mosquito") || t.includes("racquet") || t.includes("bat") ||
        t.includes("curtain") || t.includes("towel") || t.includes("bedsheet") ||
        t.includes("pillow") || t.includes("cushion") || t.includes("furniture") ||
        t.includes("dressing table") || t.includes("extension board") || t.includes("multi plug") ||
        t.includes("tile") || t.includes("seal") || t.includes("door") ||
        t.includes("drain") || t.includes("stand") || t.includes("knife") ||
        t.includes("pipe") || t.includes("purifier") || t.includes("candle") ||
        t.includes("holder") || t.includes("hook") || t.includes("hanger") ||
        t.includes("juicer") || t.includes("mop") || t.includes("brush") ||
        t.includes("dustpan") || t.includes("spotzero") || t.includes("gas chula") ||
        t.includes("gas stove")
    ) {
        return "Home & Living";
    }

    // Grocery
    if (
        t.includes("grocery") || t.includes("fresh") || t.includes("food") ||
        t.includes("tea") || t.includes("coffee") || t.includes("oil") ||
        t.includes("spices") || t.includes("ghee") || t.includes("salt") ||
        t.includes("sugar") || t.includes("rice") || t.includes("wheat") ||
        t.includes("flour") || t.includes("dal") || t.includes("pulses") ||
        t.includes("snacks") || t.includes("biscuits") || t.includes("beverage") ||
        t.includes("cadbury") || t.includes("chocolair") || t.includes("bites") ||
        t.includes("chocolate") || t.includes("candy") || t.includes("tamarind") ||
        t.includes("jaggery") || t.includes("go desi") || t.includes("pista") ||
        t.includes("almonds") || t.includes("cashew") || t.includes("dry fruits") ||
        t.includes("honey") || t.includes("complan")
    ) {
        return "Grocery";
    }

    return "Others / Miscellaneous";
}

function parseAmazonDate(dateStr) {
    if (!dateStr) return { valid: false };
    let parsed = Date.parse(dateStr.trim());
    if (!isNaN(parsed)) {
        let d = new Date(parsed);
        return { valid: true, month: d.getMonth(), year: d.getFullYear(), clean: dateStr };
    }
    return { valid: false };
}

function getStandardizedDateString(dateStr, store) {
    if (!dateStr) return 'N/A';
    let parsed = store === 'Amazon' ? parseAmazonDate(dateStr) : parseDate(dateStr);
    if (parsed.valid) {
        let months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
        let d = new Date(Date.parse(parsed.clean));
        if (!isNaN(d.getTime())) {
            let day = d.getDate();
            return `${String(day).padStart(2, '0')}-${months[d.getMonth()]}-${d.getFullYear()}`;
        }
        // Fallback using parsed month and year, extract day from clean text if present
        let dayMatch = parsed.clean.replace(String(parsed.year), '').match(/\b(\d{1,2})\b/);
        let day = dayMatch ? parseInt(dayMatch[1], 10) : 15;
        return `${String(day).padStart(2, '0')}-${months[parsed.month]}-${parsed.year}`;
    }
    return dateStr;
}

function buildPDFHTML(orders, coinsHistory = []) {
    let delivered = orders.filter(o => o.Category === 'Delivered/Kept');
    let refunded = orders.filter(o => o.Category === 'Refunded');
    let cancelled = orders.filter(o => o.Category === 'Cancelled');

    let delCash = delivered.reduce((sum, o) => sum + o.CashAmount, 0);
    let delCoins = delivered.reduce((sum, o) => sum + o.SupercoinsUsed, 0);
    let refCash = refunded.reduce((sum, o) => sum + o.CashAmount, 0);
    let refCoins = refunded.reduce((sum, o) => sum + o.SupercoinsUsed, 0);
    let canCash = cancelled.reduce((sum, o) => sum + o.CashAmount, 0);
    let canCoins = cancelled.reduce((sum, o) => sum + o.SupercoinsUsed, 0);

    let currentDate = new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

    let analytics = getAnalytics(orders);
    let coinsAnalytics = getCoinsAnalytics(coinsHistory, orders);

    const makeTableRows = (items, coinSubLabel) => {
        return items.map(o => {
            let displayDate = getStandardizedDateString(o.Date, 'Flipkart');
            return `<tr><td>${displayDate}</td><td><small>${o.OrderId || 'N/A'}</small></td><td class="title-cell" title="${o.Item}">${o.Item}</td><td class="center">${o.SupercoinsUsed > 0 ? o.SupercoinsUsed : '-'}</td><td class="right font-bold">₹${o.CashAmount.toLocaleString('en-IN')}</td></tr>`;
        }).join('') + `<tr class="total-row"><td colspan="3" class="right">Total Section Summary:</td><td class="center">${items.reduce((s, o) => s + o.SupercoinsUsed, 0).toLocaleString('en-IN')} Coins<br><small style="font-weight:normal;color:#7f8c8d">${coinSubLabel}</small></td><td class="right">₹${items.reduce((s, o) => s + o.CashAmount, 0).toLocaleString('en-IN')}</td></tr>`;
    };

    let yearlyRows = Object.keys(analytics.yearlySpend)
        .sort((a, b) => b - a)
        .map(year => `
            <tr>
                <td class="font-bold" style="font-size:11px;">${year}</td>
                <td class="font-bold" style="font-size:11px;color:#27ae60;">₹${analytics.yearlySpend[year].cash.toLocaleString('en-IN')}</td>
                <td style="font-size:11px;">${analytics.yearlySpend[year].coins.toLocaleString('en-IN')} Coins</td>
            </tr>
        `).join('');

    let catTotals = {
        "Electronics & Gadgets": 0,
        "Home & Living": 0,
        "Fashion & Apparel": 0,
        "Beauty & Personal Care": 0,
        "Books & Education": 0,
        "Grocery": 0,
        "Others / Miscellaneous": 0
    };
    delivered.forEach(o => {
        let cat = categorizeItem(o.Item);
        catTotals[cat] = (catTotals[cat] || 0) + o.CashAmount;
    });
    let totalDelCash = delivered.reduce((sum, o) => sum + o.CashAmount, 0) || 1;
    let sortedCats = Object.entries(catTotals).sort((a, b) => b[1] - a[1]);

    let categoryHtml = sortedCats.map(([catName, amt]) => {
        if (amt === 0) return '';
        let pct = Math.round((amt / totalDelCash) * 100);
        return `
            <tr>
                <td style="font-weight:bold; font-size:10px; padding: 4px 8px;">${catName}</td>
                <td style="font-size:10px; padding: 4px 8px;">₹${amt.toLocaleString('en-IN')}</td>
                <td style="font-size:10px; padding: 4px 8px;">${pct}%</td>
                <td style="padding: 4px 8px;">
                    <div style="background:#eaeded; height:6px; border-radius:3px; width:100%; overflow:hidden;">
                        <div style="background:#1b3a4b; height:100%; width:${pct}%;"></div>
                    </div>
                </td>
            </tr>
        `;
    }).join('');

    let peakSpendText = analytics.peakSpendMonth.amount > 0
        ? `${analytics.peakSpendMonth.label} (₹${analytics.peakSpendMonth.amount.toLocaleString('en-IN')})`
        : 'N/A';

    let mostActiveText = analytics.mostActiveMonth.count > 0
        ? `${analytics.mostActiveMonth.label} (${analytics.mostActiveMonth.count} orders)`
        : 'N/A';

    return `
        <html>
        <head>
            <meta charset="UTF-8">
            <title>Flipkart Financial Statement</title>
            <style>
                body { font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; color: #2c3e50; padding: 20px; font-size: 11px; }
                .header-banner { background-color: #1b3a4b; color: white; padding: 15px 20px; border-radius: 4px; margin-bottom: 20px; display: flex; justify-content: space-between; align-items: center; }
                .header-banner h1 { margin: 0; font-size: 20px; font-weight: bold; }
                
                .kpi-grid { display: grid; grid-template-columns: repeat(6, 1fr); gap: 8px; margin-bottom: 20px; }
                .kpi-card { background-color: #f8f9fa; border: 1px solid #eaeded; padding: 8px; border-radius: 4px; text-align: center; }
                .kpi-label { font-size: 8px; font-weight: bold; color: #7f8c8d; text-transform: uppercase; margin-bottom: 4px; }
                .kpi-val { font-size: 13px; font-weight: bold; }
                .kpi-green { color: #27ae60; } .kpi-orange { color: #d35400; }
                .kpi-subtext { font-size: 8px; color: #7f8c8d; margin-top: 2px; }

                .dashboard-container { background: #fdfefe; border: 1px solid #d5dbdb; border-radius: 6px; padding: 12px; margin-bottom: 20px; }
                .dashboard-title { margin-top: 0; margin-bottom: 10px; font-size: 13px; color: #1b3a4b; border-bottom: 2px solid #1b3a4b; padding-bottom: 3px; font-weight: bold; text-transform: uppercase; }
                
                .insights-grid { display: grid; grid-template-columns: repeat(5, 1fr); gap: 8px; margin-bottom: 12px; }
                .insight-card { background: #f2f4f4; border: 1px solid #eaeded; padding: 8px; border-radius: 4px; text-align: center; }
                .insight-val { font-size: 12px; font-weight: bold; color: #1b3a4b; }
                .insight-desc { font-size: 8px; color: #7f8c8d; margin-top: 2px; }

                .extremes-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 12px; }
                .extreme-card { background: #f8f9fa; border: 1px solid #eaeded; padding: 8px; border-radius: 4px; }
                .extreme-title { font-size: 9px; font-weight: 500; color: #2c3e50; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-top: 2px; }
                .extreme-price { font-size: 11px; font-weight: bold; color: #27ae60; }

                h2 { font-size: 12px; color: #1b3a4b; border-bottom: 1px solid #1b3a4b; padding-bottom: 4px; margin-top: 20px; margin-bottom: 8px; text-transform: uppercase; }
                table { width: 100%; border-collapse: collapse; margin-bottom: 15px; }
                th { background-color: #1b3a4b; color: white; font-weight: bold; text-align: left; padding: 5px 8px; font-size: 9px; text-transform: uppercase; }
                td { padding: 5px 8px; border-bottom: 1px solid #f2f4f4; vertical-align: middle; }
                tr:nth-child(even):not(.total-row) { background-color: #fafafa; }
                .title-cell { max-width: 320px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
                .center { text-align: center; } .right { text-align: right; } .font-bold { font-weight: bold; }
                .total-row { background-color: #eaeded !important; font-weight: bold; border-top: 1px solid #1b3a4b; }
                
                .yearly-table th { background-color: #34495e; color: white; }
                
                @media print { body { padding: 0; margin: 0; } @page { size: letter; margin: 0.5in; } }
            </style>
        </head>
        <body>
            <div class="header-banner">
                <h1>Flipkart Financial Spending Statement</h1>
                <span>Report Created: ${currentDate}</span>
            </div>
            
            <div class="kpi-grid">
                <div class="kpi-card"><div class="kpi-label">Net Spent</div><div class="kpi-val kpi-green">₹${delCash.toLocaleString('en-IN')}</div><div class="kpi-subtext">Delivered & Kept</div></div>
                <div class="kpi-card"><div class="kpi-label">Total Refunded</div><div class="kpi-val">₹${refCash.toLocaleString('en-IN')}</div><div class="kpi-subtext">Reversed Account</div></div>
                <div class="kpi-card"><div class="kpi-label">Total Saved</div><div class="kpi-val">₹${canCash.toLocaleString('en-IN')}</div><div class="kpi-subtext">Cancelled Pipeline</div></div>
                <div class="kpi-card"><div class="kpi-label">Coins Burned</div><div class="kpi-val kpi-orange">${delCoins.toLocaleString('en-IN')}</div><div class="kpi-subtext">Used on Purchases</div></div>
                <div class="kpi-card"><div class="kpi-label">Coins Returned</div><div class="kpi-val">${refCoins.toLocaleString('en-IN')}</div><div class="kpi-subtext">Returned on Returns</div></div>
                <div class="kpi-card"><div class="kpi-label">Coins Restored</div><div class="kpi-val">${canCoins.toLocaleString('en-IN')}</div><div class="kpi-subtext">Restored on Cancel</div></div>
            </div>
 
            <div class="dashboard-container">
                <div class="dashboard-title">Shopping Analytics Dashboard</div>
                
                <div class="insights-grid" style="grid-template-columns: repeat(4, 1fr);">
                    <div class="insight-card">
                        <div class="kpi-label">Peak Spend Month</div>
                        <div class="insight-val">${peakSpendText}</div>
                        <div class="insight-desc">Highest monthly expense</div>
                    </div>
                    <div class="insight-card">
                        <div class="kpi-label">Average Order Value</div>
                        <div class="insight-val">₹${analytics.averageOrderValue.toLocaleString('en-IN')}</div>
                        <div class="insight-desc">AOV per delivered item</div>
                    </div>
                    <div class="insight-card">
                        <div class="kpi-label">Order Success Rate</div>
                        <div class="insight-val">${analytics.successRate}%</div>
                        <div class="insight-desc">Delivered vs. total orders</div>
                    </div>
                    <div class="insight-card">
                        <div class="kpi-label">Most Active Month</div>
                        <div class="insight-val">${mostActiveText}</div>
                        <div class="insight-desc">Highest order frequency</div>
                    </div>
                </div>
 
                <div class="extremes-grid">
                    <div class="extreme-card">
                        <div class="kpi-label">Highest Costing Purchase</div>
                        <div class="extreme-title" title="${analytics.highestCosting ? analytics.highestCosting.Item : ''}">${analytics.highestCosting ? analytics.highestCosting.Item : 'N/A'}</div>
                        <div class="extreme-price">₹${analytics.highestCosting ? analytics.highestCosting.CashAmount.toLocaleString('en-IN') : '0'}</div>
                    </div>
                    <div class="extreme-card">
                        <div class="kpi-label">Lowest Costing Purchase</div>
                        <div class="extreme-title" title="${analytics.lowestCosting ? analytics.lowestCosting.Item : ''}">${analytics.lowestCosting ? analytics.lowestCosting.Item : 'N/A'}</div>
                        <div class="extreme-price">₹${analytics.lowestCosting ? analytics.lowestCosting.CashAmount.toLocaleString('en-IN') : '0'}</div>
                    </div>
                </div>

                <div class="kpi-label" style="margin-bottom: 6px; margin-top: 10px;">Category Spend Distribution</div>
                <table style="width:100%; margin-bottom:12px; border:1px solid #eaeded; border-radius:4px; overflow:hidden;">
                    <thead>
                        <tr style="background:#f2f4f4;">
                            <th style="color:#2c3e50; padding:4px 8px; font-size:9px; width:30%;">Category</th>
                            <th style="color:#2c3e50; padding:4px 8px; font-size:9px; width:20%;">Spent</th>
                            <th style="color:#2c3e50; padding:4px 8px; font-size:9px; width:15%;">Share</th>
                            <th style="color:#2c3e50; padding:4px 8px; font-size:9px; width:35%;">Distribution</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${categoryHtml || '<tr><td colspan="4" style="text-align:center; padding:8px; font-style:italic; color:#7f8c8d;">No delivered purchases.</td></tr>'}
                    </tbody>
                </table>
 
                ${yearlyRows ? `
                <div class="kpi-label" style="margin-bottom: 6px;">Yearly Spending Summary</div>
                <table class="yearly-table">
                    <thead>
                        <tr>
                            <th>Year</th>
                            <th>Cash Spent</th>
                            <th>Coins Used</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${yearlyRows}
                    </tbody>
                </table>
                ` : ''}
            </div>

            ${coinsHistory && coinsHistory.length > 0 ? `
            <div class="dashboard-container" style="border-color:#f5c043; margin-top: 15px;">
                <div class="dashboard-title" style="color:#d35400; border-bottom-color:#f5c043;">SuperCoin Shopping Insights</div>
                <div class="insights-grid" style="grid-template-columns: repeat(5, 1fr); margin-bottom: 0;">
                    <div class="insight-card" style="background:#fef9e7; border-color:#f5c043;">
                        <div class="kpi-label" style="color:#d35400;">Total Coins Earned</div>
                        <div class="insight-val" style="color:#d35400;">${coinsAnalytics.totalEarned.toLocaleString('en-IN')}</div>
                        <div class="insight-desc">Since Dec 2023 (Ledger)</div>
                    </div>
                    <div class="insight-card" style="background:#fdf2e9; border-color:#e59866;">
                        <div class="kpi-label" style="color:#a04000;">Total Coins Used</div>
                        <div class="insight-val" style="color:#a04000;">${coinsAnalytics.totalUsed.toLocaleString('en-IN')}</div>
                        <div class="insight-desc">Lifetime Spend (Orders + Ledger)</div>
                    </div>
                    <div class="insight-card" style="background:#fbeee6; border-color:#f5b041;">
                        <div class="kpi-label" style="color:#78281f;">Total Coins Expired</div>
                        <div class="insight-val" style="color:#78281f;">${coinsAnalytics.totalExpired.toLocaleString('en-IN')}</div>
                        <div class="insight-desc">Loss due to validity end</div>
                    </div>
                    <div class="insight-card">
                        <div class="kpi-label">Peak Gained Month</div>
                        <div class="insight-val" style="font-size:10px;">${coinsAnalytics.peakGainMonth.label}</div>
                        <div class="insight-desc">${coinsAnalytics.peakGainMonth.amount > 0 ? `+${coinsAnalytics.peakGainMonth.amount} Coins` : 'N/A'}</div>
                    </div>
                    <div class="insight-card">
                        <div class="kpi-label">Peak Expired Month</div>
                        <div class="insight-val" style="font-size:10px;">${coinsAnalytics.peakExpireMonth.label}</div>
                        <div class="insight-desc">${coinsAnalytics.peakExpireMonth.amount > 0 ? `-${coinsAnalytics.peakExpireMonth.amount} Coins` : 'N/A'}</div>
                    </div>
                </div>
                <div style="font-size: 8px; color: #7f8c8d; font-style: italic; margin-top: 8px; text-align: left; line-height: 1.2;">
                    * Note: Flipkart archives SuperCoin ledger history older than Dec 2023. Lifetime coins used/spent are computed from your complete Order History, while earnings and expirations are from the ledger period (Dec 2023 onwards).
                </div>
            </div>
            ` : ''}

            <h2>1. Total Capital Expenditure (Delivered & Kept Purchases)</h2>
            <table><thead><tr><th style="width:15%">Date</th><th style="width:20%">Order ID</th><th style="width:40%">Description</th><th style="width:12%;text-align:center">Coins Used</th><th style="width:13%;text-align:right">Amount</th></tr></thead><tbody>${makeTableRows(delivered, "Permanently Burned")}</tbody></table>
            
            <h2>2. Total Returned Value & Account Reversals (Refunded)</h2>
            <table><thead><tr><th style="width:15%">Date</th><th style="width:20%">Order ID</th><th style="width:40%">Description</th><th style="width:12%;text-align:center">Coins Used</th><th style="width:13%;text-align:right">Amount</th></tr></thead><tbody>${makeTableRows(refunded, "Credited Back")}</tbody></table>
            
            <h2>3. Total Cancelled Pipeline Value (Saved)</h2>
            <table><thead><tr><th style="width:15%">Date</th><th style="width:20%">Order ID</th><th style="width:40%">Description</th><th style="width:12%;text-align:center">Coins Used</th><th style="width:13%;text-align:right">Amount</th></tr></thead><tbody>${makeTableRows(cancelled, "Restored to Wallet")}</tbody></table>

            ${coinsHistory && coinsHistory.length > 0 ? `
            <h2>4. SuperCoin Transaction Ledger</h2>
            <table class="yearly-table">
                <thead>
                    <tr style="background-color: #f39c12;">
                        <th style="width:18%;">Date</th>
                        <th style="width:52%;">Activity Details</th>
                        <th style="width:15%;">Type</th>
                        <th style="width:15%;text-align:right;">Amount</th>
                    </tr>
                </thead>
                <tbody>
                    ${coinsHistory.map(c => {
        let displayDate = getStandardizedDateString(c.Date, 'Flipkart');
        let badgeColor = c.Type === 'Credited' ? 'color:#196f3d;background-color:#d4efdf;' : 'color:#7a0010;background-color:#ffadad;';
        let amountColor = c.Type === 'Credited' ? 'color:#27ae60;' : 'color:#d35400;';
        let amountPrefix = c.Type === 'Credited' ? '+' : '-';
        return `
                            <tr>
                                <td>${displayDate}</td>
                                <td class="title-cell">${c.Title}</td>
                                <td><span style="padding:2px 6px;border-radius:4px;font-size:8px;font-weight:bold;text-transform:uppercase;${badgeColor}">${c.Type}</span></td>
                                <td class="right font-bold" style="${amountColor}">${amountPrefix}${Math.abs(c.Amount)}</td>
                            </tr>
                        `;
    }).join('')}
                </tbody>
            </table>
            ` : ''}
        </body>
        </html>
    `;
}

function showCoinsScraperOverlay() {
    if (document.getElementById('coinsScraperOverlay')) return;

    injectGoogleFonts();

    let overlay = document.createElement('div');
    overlay.id = 'coinsScraperOverlay';
    overlay.style.cssText = 'position: fixed; top: 24px; right: 24px; background: rgba(255, 255, 255, 0.85); backdrop-filter: blur(12px) saturate(180%); -webkit-backdrop-filter: blur(12px) saturate(180%); border: 1px solid rgba(255, 255, 255, 0.4); padding: 20px; border-radius: 16px; z-index: 10000000; box-shadow: 0 10px 30px rgba(0, 0, 0, 0.1), inset 0 1px 1px rgba(255, 255, 255, 0.3); font-family: "Outfit", sans-serif; width: 280px; box-sizing: border-box; transition: all 0.3s ease;';

    overlay.innerHTML = `
        <div style="display: flex; align-items: center; gap: 10px; font-weight: 700; color: #f59e0b; font-size: 15px; margin-bottom: 6px;">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="spinner-icon"><line x1="12" y1="2" x2="12" y2="6"></line><line x1="12" y1="18" x2="12" y2="22"></line><line x1="4.93" y1="4.93" x2="7.76" y2="7.76"></line><line x1="16.24" y1="16.24" x2="19.07" y2="19.07"></line><line x1="2" y1="12" x2="6" y2="12"></line><line x1="18" y1="12" x2="22" y2="12"></line><line x1="6.34" y1="17.66" x2="8.46" y2="15.54"></line><line x1="15.54" y1="8.46" x2="17.66" y2="6.34"></line></svg>
            Flipkart SuperCoins
        </div>
        <div style="font-size: 13px; font-weight: 600; color: #1e293b; margin-bottom: 4px;">Scraping Coins Ledger...</div>
        <div id="coinsScrapedCount" style="font-size: 11px; color: #64748b; font-weight: 500; line-height: 1.4; margin-bottom: 12px;">0 transactions found so far...</div>
        <button id="inPageStopCoinsBtn" style="width: 100%; border: 1px solid #ef4444; color: #ef4444; font-weight: 600; background: rgba(239, 68, 68, 0.05); cursor: pointer; transition: all 0.2s; padding: 8px 12px; border-radius: 8px; font-family: 'Outfit', sans-serif; font-size: 12px; box-sizing: border-box;" onmouseover="this.style.background='rgba(239, 68, 68, 0.1)';" onmouseout="this.style.background='rgba(239, 68, 68, 0.05)';">Stop Extraction</button>
        <style>
            @keyframes spin { 100% { transform: rotate(360deg); } }
            .spinner-icon { animation: spin 1.5s linear infinite; }
        </style>
    `;
    document.body.appendChild(overlay);
}

function updateCoinsOverlayCount(count) {
    let el = document.getElementById('coinsScrapedCount');
    if (el) {
        el.innerText = `${count} transactions found so far...`;
    }
}

function runCoinsScraperEngine() {
    console.log("%c 🚀 Coins Scraper Engine Online! Scanning transaction history... ", 'background: #f39c12; color: #fff; font-weight: bold; padding: 4px;');

    showCoinsScraperOverlay();

    let lastCardCount = document.querySelectorAll('.y3UZOh').length;
    updateCoinsOverlayCount(lastCardCount);
    let fallbackInterval = null;
    let isTerminated = false;

    // Attach in-page stop listener
    const stopBtn = document.getElementById('inPageStopCoinsBtn');
    if (stopBtn) {
        stopBtn.addEventListener('click', () => {
            console.log("[Coins Scraper] In-page stop button clicked. Terminating...");
            isTerminated = true;
            if (fallbackInterval) {
                clearInterval(fallbackInterval);
            }
            chrome.storage.local.set({ coinsScrapingActive: false }, () => {
                let overlay = document.getElementById('coinsScraperOverlay');
                if (overlay) overlay.remove();
                chrome.runtime.sendMessage({ action: "closeTab" });
            });
        });
    }

    function scanAndProcessCoinsPage() {
        if (isTerminated) return;
        window.scrollTo(0, document.body.scrollHeight);
    }

    let noChangeCount = 0;
    fallbackInterval = setInterval(() => {
        if (isTerminated) return;

        let currentCardCount = document.querySelectorAll('.y3UZOh').length;
        console.log(`[Coins Scraper] Scroll check: count changed from ${lastCardCount} to ${currentCardCount}`);

        if (currentCardCount > lastCardCount) {
            lastCardCount = currentCardCount;
            noChangeCount = 0;
            updateCoinsOverlayCount(currentCardCount);
            window.scrollTo(0, document.body.scrollHeight);
        } else {
            noChangeCount++;
            window.scrollTo(0, document.body.scrollHeight);
            if (noChangeCount >= 12) { // Increased from 3 to 12 (waits up to 24s of no change for lazy-load throttling)
                console.log("[Coins Scraper] End of transaction history reached. Compiling coin records...");
                compileCoinsDataset();
            }
        }
    }, 2000);

    function compileCoinsDataset() {
        isTerminated = true;
        clearInterval(fallbackInterval);

        let cardElements = document.querySelectorAll('.y3UZOh');
        let coinsHistory = [];

        cardElements.forEach(card => {
            let titleEl = card.querySelector('.stM_pt');
            let amountEl = card.querySelector('.qrldEo');
            let dateEl = card.querySelector('.QNGAZj .HZ0E6r');

            if (titleEl && amountEl && dateEl) {
                let title = titleEl.innerText.trim();
                let amountText = amountEl.innerText.trim();
                let dateText = dateEl.innerText.trim();

                let amount = parseInt(amountText.replace(/\s+/g, ''), 10) || 0;
                let type = amount >= 0 ? "Credited" : "Debited";

                coinsHistory.push({
                    Title: title,
                    Amount: amount,
                    Type: type,
                    Date: dateText
                });
            }
        });

        console.log(`[Coins Scraper] Scraped ${coinsHistory.length} coin transactions. Saving to storage...`);

        // Remove overlay
        let overlay = document.getElementById('coinsScraperOverlay');
        if (overlay) overlay.remove();

        chrome.storage.local.set({
            coinsHistory: coinsHistory,
            coinsScrapingActive: false
        }, () => {
            console.log("[Coins Scraper] State saved. Requesting tab closure...");
            chrome.runtime.sendMessage({ action: "closeTab" });
        });
    }
}

function showFlipkartScraperOverlay(message, submessage = "") {
    let overlay = document.getElementById('flipkartOrdersScraperOverlay');
    if (!overlay) {
        injectGoogleFonts();
        overlay = document.createElement('div');
        overlay.id = 'flipkartOrdersScraperOverlay';
        overlay.style.cssText = 'position: fixed; top: 24px; right: 24px; background: rgba(255, 255, 255, 0.85); backdrop-filter: blur(12px) saturate(180%); -webkit-backdrop-filter: blur(12px) saturate(180%); border: 1px solid rgba(255, 255, 255, 0.4); padding: 20px; border-radius: 16px; z-index: 10000000; box-shadow: 0 10px 30px rgba(0, 0, 0, 0.1), inset 0 1px 1px rgba(255, 255, 255, 0.3); font-family: "Outfit", sans-serif; width: 280px; box-sizing: border-box; transition: all 0.3s ease;';

        overlay.innerHTML = `
            <div style="display: flex; align-items: center; gap: 10px; font-weight: 700; color: #2874f0; font-size: 15px; margin-bottom: 6px;">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="spinner-icon"><line x1="12" y1="2" x2="12" y2="6"></line><line x1="12" y1="18" x2="12" y2="22"></line><line x1="4.93" y1="4.93" x2="7.76" y2="7.76"></line><line x1="16.24" y1="16.24" x2="19.07" y2="19.07"></line><line x1="2" y1="12" x2="6" y2="12"></line><line x1="18" y1="12" x2="22" y2="12"></line><line x1="6.34" y1="17.66" x2="8.46" y2="15.54"></line><line x1="15.54" y1="8.46" x2="17.66" y2="6.34"></line></svg>
                Flipkart Spend History
            </div>
            <div id="fkOrdersMessage" style="font-size: 13px; font-weight: 600; color: #1e293b; margin-bottom: 4px;"></div>
            <div id="fkOrdersSubmessage" style="font-size: 11px; color: #64748b; font-weight: 500; line-height: 1.4; margin-bottom: 8px;"></div>
            <button id="inPageStopFkOrdersBtn" style="width: 100%; border: 1px solid #ef4444; color: #ef4444; font-weight: 600; background: rgba(239, 68, 68, 0.05); cursor: pointer; transition: all 0.2s; padding: 8px 12px; border-radius: 8px; font-family: 'Outfit', sans-serif; font-size: 12px; box-sizing: border-box;" onmouseover="this.style.background='rgba(239, 68, 68, 0.1)';" onmouseout="this.style.background='rgba(239, 68, 68, 0.05)';">Stop Extraction</button>
            <style>
                @keyframes spin { 100% { transform: rotate(360deg); } }
                .spinner-icon { animation: spin 1.5s linear infinite; }
            </style>
        `;
        document.body.appendChild(overlay);

        // Attach stop listener
        const stopBtn = overlay.querySelector('#inPageStopFkOrdersBtn');
        if (stopBtn) {
            stopBtn.addEventListener('click', () => {
                console.log("[Flipkart Scraper] In-page stop button clicked. Terminating...");
                window.scraperState.status = "idle";
                if (window.activeObserver) {
                    window.activeObserver.disconnect();
                    window.activeObserver = null;
                }
                if (window.activeFallbackInterval) {
                    clearInterval(window.activeFallbackInterval);
                    window.activeFallbackInterval = null;
                }
                if (window.activeCoinsCheckInterval) {
                    clearInterval(window.activeCoinsCheckInterval);
                    window.activeCoinsCheckInterval = null;
                }
                chrome.storage.local.set({ scraperStatus: "idle", coinsScrapingActive: false }, () => {
                    overlay.remove();
                });
            });
        }
    }

    document.getElementById('fkOrdersMessage').innerText = message;
    document.getElementById('fkOrdersSubmessage').innerText = submessage;
}