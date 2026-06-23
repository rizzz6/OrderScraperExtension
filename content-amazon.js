console.log("%c ⚡ Amazon Exporter Engine Connected! ⚡ ", 'background: #ff9900; color: #000; font-size: 13px; font-weight: bold;');

if (!window.amazonScraperState) {
    window.amazonScraperState = {
        status: "idle",
        itemCount: 0,
        orders: []
    };
}

// Read state on load to see if we should resume scraping or show control panel
chrome.storage.local.get(["amazonScraperStatus", "amazonOrders", "amazonTargetYears", "amazonCurrentYearIndex"], (res) => {
    if (res.amazonScraperStatus === "completed" && res.amazonOrders && res.amazonOrders.length > 0) {
        window.amazonScraperState = {
            status: "completed",
            orders: res.amazonOrders,
            itemCount: res.amazonOrders.length
        };
        console.log("[Amazon Scraper] Restored completed state from local storage.");
        if (document.readyState === "loading") {
            document.addEventListener("DOMContentLoaded", () => {
                showAmazonFloatingControlPanel(res.amazonOrders);
            });
        } else {
            showAmazonFloatingControlPanel(res.amazonOrders);
        }
    } else if (res.amazonScraperStatus === "running") {
        window.amazonScraperState = {
            status: "running",
            orders: res.amazonOrders || [],
            itemCount: (res.amazonOrders || []).length
        };
        console.log("[Amazon Scraper] Resuming scrape task...");

        let currentYear = res.amazonTargetYears && res.amazonTargetYears[res.amazonCurrentYearIndex]
            ? res.amazonTargetYears[res.amazonCurrentYearIndex].replace('year-', '')
            : '...';
        showAmazonScraperOverlay("Scraping Orders...", `Collected: ${window.amazonScraperState.itemCount} orders\nYear: ${currentYear}`);

        if (document.readyState === "loading") {
            document.addEventListener("DOMContentLoaded", () => {
                setTimeout(runAmazonScraperEngine, 1500); // 1.5s human-like loading delay
            });
        } else {
            setTimeout(runAmazonScraperEngine, 1500);
        }
    }
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "startScraping") {
        if (window.amazonScraperState && window.amazonScraperState.status === "running") {
            console.log("[Amazon Scraper] Already running. Returning status.");
            sendResponse(window.amazonScraperState);
            return true;
        }

        // Determine the actual current calendar year to ensure the list always starts from the true starting year
        let currentYear = new Date().getFullYear();

        let dropdownOptions = Array.from(document.querySelectorAll('#time-filter option'));
        let dropdownYears = dropdownOptions
            .map(opt => opt.value)
            .filter(val => val.startsWith('year-'))
            .map(val => parseInt(val.replace('year-', ''), 10));

        // Find the oldest year in the dropdown, default to 2015
        let oldestYear = dropdownYears.length > 0 ? Math.min(...dropdownYears) : 2015;

        // Generate the complete sequential year list from the current calendar year down to the oldest year
        let yearValues = [];
        for (let y = currentYear; y >= oldestYear; y--) {
            yearValues.push(`year-${y}`);
        }

        let targetYears = [];
        let scope = request.scope || "last3";

        if (scope === "current") {
            targetYears = yearValues.slice(0, 1);
        } else if (scope === "last3") {
            targetYears = yearValues.slice(0, 3);
        } else {
            targetYears = yearValues; // All Time
        }

        console.log(`[Amazon Scraper] Initiating scrape. Scope: ${scope}. Target Years:`, targetYears);

        chrome.storage.local.set({
            amazonScraperStatus: "running",
            amazonOrders: [],
            amazonTargetYears: targetYears,
            amazonCurrentYearIndex: 0
        }, () => {
            window.amazonScraperState = {
                status: "running",
                itemCount: 0,
                orders: []
            };

            let startYear = targetYears[0] ? targetYears[0].replace('year-', '') : '...';
            showAmazonScraperOverlay("Scraping Orders...", `Collected: 0 orders\nYear: ${startYear}`);

            // Check if we are already on the first target year AND on page 1 (no startIndex)
            let currentUrl = window.location.href;
            let targetYearFilter = targetYears[0];
            if (currentUrl.includes(`timeFilter=${targetYearFilter}`) && !currentUrl.includes("startIndex=")) {
                runAmazonScraperEngine();
            } else {
                // Redirect to the first year page (page 1) to start the loop
                let base = window.location.origin + window.location.pathname;
                window.location.href = `${base}?timeFilter=${targetYearFilter}`;
            }
        });

        sendResponse({ status: "started" });
    } else if (request.action === "checkStatus") {
        sendResponse(window.amazonScraperState);
    } else if (request.action === "stopScraping") {
        chrome.storage.local.set({
            amazonScraperStatus: "idle",
            amazonTargetYears: [],
            amazonCurrentYearIndex: 0
        }, () => {
            window.amazonScraperState.status = "idle";
            if (window.amazonScraperTimeout) {
                clearTimeout(window.amazonScraperTimeout);
                window.amazonScraperTimeout = null;
            }
            let overlay = document.getElementById('amazonOrdersScraperOverlay');
            if (overlay) overlay.remove();
            console.log("[Amazon Scraper] Stop command received. Terminated redirect timers.");
            sendResponse({ status: "stopped" });
        });
    } else if (request.action === "resetState") {
        chrome.storage.local.set({
            amazonScraperStatus: "idle",
            amazonOrders: [],
            amazonTargetYears: [],
            amazonCurrentYearIndex: 0
        }, () => {
            window.amazonScraperState = {
                status: "idle",
                itemCount: 0,
                orders: []
            };
            if (window.amazonScraperTimeout) {
                clearTimeout(window.amazonScraperTimeout);
                window.amazonScraperTimeout = null;
            }
            let dock = document.getElementById('amazonScraperControlDock');
            if (dock) dock.remove();
            sendResponse({ status: "idle" });
        });
    }
    return true;
});

function runAmazonScraperEngine() {
    console.log("[Amazon Scraper] Scanning page content...");

    let orderCards = document.querySelectorAll('div.order-card.js-order-card');
    let pageOrders = [];

    orderCards.forEach(card => {
        // 1. Extract Order Date
        let dateEl = Array.from(card.querySelectorAll('.order-header .a-column'))
            .find(col => col.innerText.toLowerCase().includes('order placed'));
        let dateText = 'Unknown Date';
        if (dateEl) {
            let valEl = dateEl.querySelector('.aok-break-word');
            if (valEl) dateText = valEl.innerText.trim();
        }

        // 2. Extract Order ID
        let orderIdEl = card.querySelector('.yohtmlc-order-id span[dir="ltr"]');
        let orderId = orderIdEl ? orderIdEl.innerText.trim() : 'Unknown ID';

        // 3. Extract Total Cash Amount
        let totalEl = Array.from(card.querySelectorAll('.order-header .a-column'))
            .find(col => col.innerText.toLowerCase().includes('total'));
        let priceText = '₹0';
        if (totalEl) {
            let valEl = totalEl.querySelector('.aok-break-word');
            if (valEl) priceText = valEl.innerText.trim();
        }
        // Clean price text to float value
        let price = parseFloat(priceText.replace(/₹/g, '').replace(/,/g, '').replace(/[^0-9.]/g, '').trim()) || 0;

        // 4. Extract Recipient Name
        let recipientEl = card.querySelector('.yohtmlc-recipient .insert-encrypted-trigger-text');
        if (!recipientEl) recipientEl = card.querySelector('.yohtmlc-recipient a.a-popover-trigger');
        let recipient = recipientEl ? recipientEl.innerText.trim() : 'Unknown';
        // Clean recipient name from trailing popover triggers
        recipient = recipient.replace(/\s*Recipient address\s*/i, '').trim();

        // 5. Extract Item Titles
        let itemTitleEls = card.querySelectorAll('.yohtmlc-product-title a.a-link-normal');
        let itemsList = Array.from(itemTitleEls).map(el => el.innerText.trim());
        let itemsText = itemsList.length > 0 ? itemsList.join('; ') : "Amazon Order Item";

        // 6. Extract Category/Status (Delivered, Cancelled, Refunded)
        let cardText = card.innerText.toLowerCase();
        let category = 'Delivered/Kept';
        if (cardText.includes('cancelled') || cardText.includes('cancellation completed') || cardText.includes('cancellation request')) {
            category = 'Cancelled';
        } else if (cardText.includes('refund') || cardText.includes('returned') || cardText.includes('return complete') || cardText.includes('return received')) {
            category = 'Refunded';
        }

        pageOrders.push({
            Date: dateText,
            Category: category,
            Item: itemsText,
            CashAmount: price,
            SupercoinsUsed: 0, // Set to 0 for Flipkart compatibility in PDF layout
            OrderId: orderId,
            Recipient: recipient
        });
    });

    console.log(`[Amazon Scraper] Extracted ${pageOrders.length} orders from current page.`);

    // Read stored list, add new ones without duplicates, and write back
    chrome.storage.local.get(["amazonOrders", "amazonTargetYears", "amazonCurrentYearIndex"], (res) => {
        let currentOrdersList = res.amazonOrders || [];
        let updatedOrdersList = [...currentOrdersList];

        pageOrders.forEach(o => {
            if (!updatedOrdersList.some(existing => existing.OrderId === o.OrderId)) {
                updatedOrdersList.push(o);
            }
        });

        // Update state count for popup polling
        window.amazonScraperState.itemCount = updatedOrdersList.length;
        window.amazonScraperState.orders = updatedOrdersList;

        chrome.storage.local.set({ amazonOrders: updatedOrdersList }, () => {
            // Update the overlay display
            let currentYear = res.amazonTargetYears && res.amazonTargetYears[res.amazonCurrentYearIndex]
                ? res.amazonTargetYears[res.amazonCurrentYearIndex].replace('year-', '')
                : '...';
            showAmazonScraperOverlay("Scraping Orders...", `Collected: ${updatedOrdersList.length} orders\nYear: ${currentYear}`);

            // Check for next page pagination link
            let nextBtn = document.querySelector('li.a-last a');
            let isNextBtnDisabled = !nextBtn || nextBtn.closest('li').classList.contains('a-disabled');

            if (nextBtn && !isNextBtnDisabled) {
                console.log("[Amazon Scraper] Navigating to next page in 2 seconds...");
                window.amazonScraperTimeout = setTimeout(() => {
                    window.location.href = nextBtn.href;
                }, 2000);
            } else {
                // No more pages in this year, transition to next year
                let currentYearIndex = res.amazonCurrentYearIndex || 0;
                let targetYears = res.amazonTargetYears || [];
                let nextYearIndex = currentYearIndex + 1;

                if (nextYearIndex < targetYears.length) {
                    let nextYear = targetYears[nextYearIndex];
                    console.log(`[Amazon Scraper] Year ${targetYears[currentYearIndex]} finished. Shifting to year ${nextYear} in 2.5 seconds...`);

                    chrome.storage.local.set({ amazonCurrentYearIndex: nextYearIndex }, () => {
                        window.amazonScraperTimeout = setTimeout(() => {
                            let base = window.location.origin + window.location.pathname;
                            window.location.href = `${base}?timeFilter=${nextYear}`;
                        }, 2500);
                    });
                } else {
                    // All years completed!
                    console.log(`%c [Amazon Scraper] Extraction Complete! Scraped ${updatedOrdersList.length} orders in total. `, 'background: #27ae60; color: #fff; font-weight: bold; padding: 4px;');

                    chrome.storage.local.get("amazonPayScrapingActive", (payRes) => {
                        chrome.storage.local.set({ amazonScraperStatus: "completed" }, () => {
                            window.amazonScraperState.status = "completed";
                            let overlay = document.getElementById('amazonOrdersScraperOverlay');
                            if (overlay) overlay.remove();
                            showAmazonFloatingControlPanel(updatedOrdersList);
                            if (!payRes.amazonPayScrapingActive) {
                                chrome.runtime.sendMessage({ action: "extractionComplete" }, (res) => {
                                    if (chrome.runtime.lastError) { /* ignore */ }
                                });
                            }
                        });
                    });
                }
            }
        });
    });
}

function injectGoogleFonts() {
    if (!document.getElementById('amazonScraperGoogleFonts')) {
        let link1 = document.createElement('link');
        link1.rel = 'preconnect';
        link1.href = 'https://fonts.googleapis.com';
        let link2 = document.createElement('link');
        link2.rel = 'preconnect';
        link2.href = 'https://fonts.gstatic.com';
        link2.crossOrigin = 'anonymous';
        let link3 = document.createElement('link');
        link3.id = 'amazonScraperGoogleFonts';
        link3.rel = 'stylesheet';
        link3.href = 'https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700&display=swap';
        document.head.appendChild(link1);
        document.head.appendChild(link2);
        document.head.appendChild(link3);
    }
}

function showAmazonFloatingControlPanel(orders) {
    if (document.getElementById('amazonScraperControlDock')) return;

    injectGoogleFonts();

    let controlDock = document.createElement('div');
    controlDock.id = 'amazonScraperControlDock';
    controlDock.style.cssText = 'position: fixed; bottom: 24px; right: 24px; background: rgba(255, 255, 255, 0.85); backdrop-filter: blur(12px) saturate(180%); -webkit-backdrop-filter: blur(12px) saturate(180%); border: 1px solid rgba(255, 255, 255, 0.4); padding: 20px; border-radius: 16px; z-index: 10000000; box-shadow: 0 10px 30px rgba(0, 0, 0, 0.1), inset 0 1px 1px rgba(255, 255, 255, 0.3); font-family: "Outfit", sans-serif; width: 280px; text-align: center; box-sizing: border-box;';

    controlDock.innerHTML = `
        <style>
            #amazonScraperControlDock * { box-sizing: border-box; }
            #closeAmazonDock:hover { background: rgba(0,0,0,0.1) !important; color: #1e293b !important; }
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
            .dock-btn:hover:not(:disabled) { transform: translateY(-1px); }
            .dock-btn:disabled { opacity: 0.6; cursor: not-allowed; transform: none !important; }
            .dock-btn-csv { background: linear-gradient(135deg, #ff9900, #e68a00); }
            .dock-btn-csv:hover:not(:disabled) { background: linear-gradient(135deg, #e68a00, #cc7a00); box-shadow: 0 4px 12px rgba(255, 153, 0, 0.3); }
            .dock-btn-coins { background: linear-gradient(135deg, #f59e0b, #d97706); }
            .dock-btn-coins:hover:not(:disabled) { background: linear-gradient(135deg, #d97706, #b45309); box-shadow: 0 4px 12px rgba(245, 158, 11, 0.3); }
            .dock-btn-pdf { background: linear-gradient(135deg, #475569, #334155); }
            .dock-btn-pdf:hover:not(:disabled) { background: linear-gradient(135deg, #334155, #1e293b); box-shadow: 0 4px 12px rgba(71, 85, 105, 0.3); }
            .dock-btn-pdf-ready { background: linear-gradient(135deg, #16a34a, #15803d) !important; }
            .dock-btn-pdf-ready:hover:not(:disabled) { background: linear-gradient(135deg, #15803d, #166534) !important; box-shadow: 0 4px 12px rgba(22, 163, 74, 0.3) !important; }
            @keyframes dock-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
            .pay-status-badge { display: flex; align-items: center; gap: 6px; justify-content: center; font-size: 10px; font-weight: 600; color: #b45309; background: #fffbeb; border: 1px solid #fef3c7; border-radius: 6px; padding: 5px 8px; margin-bottom: 8px; }
            .pay-status-badge .dot { width: 6px; height: 6px; border-radius: 50%; background: #f59e0b; animation: dock-pulse 1.5s ease-in-out infinite; flex-shrink: 0; }
            .pay-status-badge.done { color: #166534; background: #f0fdf4; border-color: #bbf7d0; }
            .pay-status-badge.done .dot { background: #16a34a; animation: none; }
        </style>
        <div style="position: absolute; top: 12px; right: 12px; cursor: pointer; display: flex; align-items: center; justify-content: center; width: 24px; height: 24px; border-radius: 50%; background: rgba(0,0,0,0.05); color: #64748b; font-size: 14px; font-weight: bold; transition: all 0.2s;" id="closeAmazonDock">×</div>
        <div style="display: flex; align-items: center; justify-content: center; gap: 8px; font-weight: 700; color: #1e293b; font-size: 15px; margin-bottom: 6px;">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#27ae60" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>
            Amazon Scrape Done
        </div>
        <div style="font-size: 11px; color: #64748b; margin-bottom: 12px; font-weight: 500; line-height: 1.4;">Cached ${orders.length} order entries. Select your target format:</div>
        <div id="payStatusBadge" class="pay-status-badge">
            <span class="dot"></span>
            <span id="payStatusText">Awaiting Pay Ledger data...</span>
        </div>
        <button id="dockAmazonCSV" class="dock-btn dock-btn-csv">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
            Download Orders CSV
        </button>
        <button id="dockAmazonPayCSV" class="dock-btn dock-btn-coins">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
            Download Pay Ledger CSV
        </button>
        <button id="dockAmazonPDF" class="dock-btn dock-btn-pdf" style="margin-bottom: 0;" disabled>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>
            <span id="dockPDFLabel">Waiting for Pay data...</span>
        </button>
    `;
    document.body.appendChild(controlDock);

    // Helper: mark PDF button as ready
    function enablePDFButton() {
        let pdfBtn = document.getElementById('dockAmazonPDF');
        let pdfLabel = document.getElementById('dockPDFLabel');
        let badge = document.getElementById('payStatusBadge');
        let badgeText = document.getElementById('payStatusText');
        if (pdfBtn) {
            pdfBtn.disabled = false;
            pdfBtn.classList.add('dock-btn-pdf-ready');
        }
        if (pdfLabel) pdfLabel.textContent = 'Generate Financial PDF';
        if (badge) badge.classList.add('done');
        if (badgeText) badgeText.textContent = 'Pay Ledger data ready!';
    }

    // Check current state immediately — maybe Pay already finished
    chrome.storage.local.get(['amazonPayScrapingActive', 'amazonPayHistory'], (res) => {
        let payStillRunning = res.amazonPayScrapingActive === true;
        let payDataExists = res.amazonPayHistory && res.amazonPayHistory.length > 0;
        if (!payStillRunning || payDataExists) {
            enablePDFButton();
        }
    });

    // Watch storage for Pay scraper to finish
    let payStorageListener = (changes, area) => {
        if (area !== 'local') return;
        if (changes.amazonPayScrapingActive && changes.amazonPayScrapingActive.newValue === false) {
            setTimeout(() => enablePDFButton(), 100);
            chrome.storage.onChanged.removeListener(payStorageListener);
        }
        if (changes.amazonPayHistory && changes.amazonPayHistory.newValue && changes.amazonPayHistory.newValue.length > 0) {
            enablePDFButton();
            chrome.storage.onChanged.removeListener(payStorageListener);
        }
    };
    chrome.storage.onChanged.addListener(payStorageListener);

    document.getElementById('closeAmazonDock').addEventListener('click', () => {
        chrome.storage.onChanged.removeListener(payStorageListener);
        controlDock.remove();
    });

    document.getElementById('dockAmazonCSV').addEventListener('click', () => {
        let csvContent = "data:text/csv;charset=utf-8,OrderId,Date,Category,Item,CashAmount,Recipient\n" +
            orders.map(e => `"${e.OrderId}","${getStandardizedDateString(e.Date, 'Amazon')}","${e.Category}","${e.Item.replace(/"/g, '""')}",${e.CashAmount},"${e.Recipient.replace(/"/g, '""')}"`).join("\n");
        let link = document.createElement("a");
        link.setAttribute("href", encodeURI(csvContent));
        link.setAttribute("download", "amazon_order_history.csv");
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    });

    document.getElementById('dockAmazonPayCSV').addEventListener('click', () => {
        chrome.storage.local.get(["amazonPayHistory"], (res) => {
            let history = res.amazonPayHistory || [];
            if (history.length === 0) {
                alert("No Amazon Pay history available to export!");
                return;
            }
            let csvContent = "data:text/csv;charset=utf-8,Index,Date,Description,Type,Status,Amount\n" +
                history.map(e => `"${e.Index}","${getStandardizedDateString(e.Date, 'Amazon')}","${e.Title.replace(/"/g, '""')}","${e.Type}","${e.Status}",${e.Amount}`).join("\n");
            let link = document.createElement("a");
            link.setAttribute("href", encodeURI(csvContent));
            link.setAttribute("download", "amazon_pay_ledger.csv");
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        });
    });

    document.getElementById('dockAmazonPDF').addEventListener('click', () => {
        if (document.getElementById('dockAmazonPDF').disabled) return;
        // Open window synchronously (inside click handler) to avoid popup blocker
        let printWindow = window.open('', '_blank');
        if (!printWindow) {
            alert('Please allow popups for this site to generate the PDF report.');
            return;
        }
        chrome.storage.local.get([
            "amazonPayBalance",
            "amazonWalletBalance",
            "amazonGiftCardBalance",
            "amazonPayHistory"
        ], (res) => {
            printWindow.document.write(buildAmazonPDFHTML(
                orders,
                res.amazonPayHistory || [],
                res.amazonPayBalance || "₹0.00",
                res.amazonWalletBalance || "₹0.00",
                res.amazonGiftCardBalance || "₹0.00"
            ));
            printWindow.document.close();
            setTimeout(() => {
                printWindow.print();
                controlDock.remove();
            }, 1000);
        });
    });
}


function parseAmazonDate(dateStr) {
    if (!dateStr) return { valid: false };
    let clean = dateStr.replace(/(Expected Credit on:|Refund Completed:|Delivered on:|Cancelled on:|Refund completed:|Ordered on:|Credited on:)/gi, '').trim();
    let parsed = Date.parse(clean);
    if (!isNaN(parsed)) {
        let d = new Date(parsed);
        return { valid: true, month: d.getMonth(), year: d.getFullYear(), clean: clean };
    }
    return { valid: false };
}

function getAmazonAnalytics(orders) {
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
        let parsed = parseAmazonDate(o.Date);
        if (parsed.valid) {
            let monthLabel = new Date(parsed.year, parsed.month).toLocaleString('en-IN', { month: 'short', year: 'numeric' });
            let yearLabel = String(parsed.year);

            monthlyCount[monthLabel] = (monthlyCount[monthLabel] || 0) + 1;

            if (o.Category === 'Delivered/Kept') {
                monthlySpend[monthLabel] = (monthlySpend[monthLabel] || 0) + o.CashAmount;

                if (!yearlySpend[yearLabel]) {
                    yearlySpend[yearLabel] = { cash: 0 };
                }
                yearlySpend[yearLabel].cash += o.CashAmount;
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

function getAmazonPayAnalytics(payHistory) {
    let totalCashback = 0;
    let totalRefunds = 0;
    let totalAdded = 0;
    let totalSpent = 0;

    let monthlyCashback = {};
    let monthlySpend = {};

    let paymentBreakdown = {
        "UPI": 0,
        "Credit Card": 0,
        "Debit Card": 0,
        "Amazon Pay Balance": 0,
        "Pay on Delivery": 0,
        "Others": 0
    };

    payHistory.forEach(p => {
        let amount = p.Amount || 0;
        let titleLower = p.Title.toLowerCase();
        let parsed = parseAmazonDate(p.Date);
        let monthLabel = "Unknown";
        if (parsed.valid) {
            monthLabel = new Date(parsed.year, parsed.month).toLocaleString('en-IN', { month: 'short', year: 'numeric' });
        }

        if (p.Status === 'SUCCESS') {
            if (p.Type === 'CREDIT') {
                if (titleLower.includes('cashback')) {
                    totalCashback += amount;
                    if (monthLabel !== "Unknown") {
                        monthlyCashback[monthLabel] = (monthlyCashback[monthLabel] || 0) + amount;
                    }
                } else if (titleLower.includes('refund')) {
                    totalRefunds += amount;
                } else {
                    totalAdded += amount;
                }
            } else if (p.Type === 'DEBIT') {
                totalSpent += amount;
                if (monthLabel !== "Unknown") {
                    monthlySpend[monthLabel] = (monthlySpend[monthLabel] || 0) + amount;
                }

                // Categorize debit method
                if (titleLower.includes('upi')) {
                    paymentBreakdown["UPI"] += amount;
                } else if (titleLower.includes('credit card') || titleLower.includes('credit/debit card')) {
                    paymentBreakdown["Credit Card"] += amount;
                } else if (titleLower.includes('debit card')) {
                    paymentBreakdown["Debit Card"] += amount;
                } else if (titleLower.includes('amazon pay balance') || titleLower.includes('balance')) {
                    paymentBreakdown["Amazon Pay Balance"] += amount;
                } else if (titleLower.includes('pay on delivery') || titleLower.includes('delivery')) {
                    paymentBreakdown["Pay on Delivery"] += amount;
                } else {
                    paymentBreakdown["Others"] += amount;
                }
            }
        }
    });

    let peakCashbackMonth = { label: "N/A", amount: 0 };
    for (let month in monthlyCashback) {
        if (monthlyCashback[month] > peakCashbackMonth.amount) {
            peakCashbackMonth = { label: month, amount: monthlyCashback[month] };
        }
    }

    let peakPaySpendMonth = { label: "N/A", amount: 0 };
    for (let month in monthlySpend) {
        if (monthlySpend[month] > peakPaySpendMonth.amount) {
            peakPaySpendMonth = { label: month, amount: monthlySpend[month] };
        }
    }

    return {
        totalCashback,
        totalRefunds,
        totalAdded,
        totalSpent,
        peakCashbackMonth,
        peakPaySpendMonth,
        paymentBreakdown
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

function parseDate(dateStr) {
    if (!dateStr) return { valid: false };
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

function buildAmazonPDFHTML(orders, payHistory = [], payBalance = "₹0.00", walletBalance = "₹0.00", giftBalance = "₹0.00") {
    let delivered = orders.filter(o => o.Category === 'Delivered/Kept');
    let refunded = orders.filter(o => o.Category === 'Refunded');
    let cancelled = orders.filter(o => o.Category === 'Cancelled');

    let delCash = delivered.reduce((sum, o) => sum + o.CashAmount, 0);
    let refCash = refunded.reduce((sum, o) => sum + o.CashAmount, 0);
    let canCash = cancelled.reduce((sum, o) => sum + o.CashAmount, 0);

    // Calculate recipient breakdown
    let recipientCounts = {};
    delivered.forEach(o => {
        let rec = (o.Recipient || 'Unknown').trim();
        recipientCounts[rec] = (recipientCounts[rec] || 0) + 1;
    });
    let sortedRecipients = Object.entries(recipientCounts).sort((a, b) => b[1] - a[1]);
    let recipientHtml = sortedRecipients.map(([rec, count]) => {
        return `
            <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 6px 8px; text-align: center;">
                <div style="font-size: 8px; font-weight: bold; color: #64748b; text-transform: uppercase; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${rec}">${rec}</div>
                <div style="font-size: 11px; font-weight: bold; color: #1e293b; margin-top: 2px;">${count} Package${count > 1 ? 's' : ''}</div>
            </div>
        `;
    }).join('');
    if (!recipientHtml) {
        recipientHtml = '<div style="font-size: 10px; color: #7f8c8d; font-style: italic; grid-column: span 4;">No recipient information available.</div>';
    }

    let currentDate = new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
    let analytics = getAmazonAnalytics(orders);
    let payAnalytics = getAmazonPayAnalytics(payHistory);

    const makeTableRows = (items) => {
        return items.map(o => {
            let annotations = [];
            let matches = payHistory.filter(p => p.OrderId === o.OrderId);
            matches.forEach(m => {
                if (m.Type === 'DEBIT' && m.Status === 'SUCCESS') {
                    annotations.push(`<span style="display:inline-block; font-size:8px; background:#fffbeb; color:#b45309; border:1px solid #fef3c7; border-radius:3px; padding:1px 4px; margin-top:2px; margin-right:4px; font-weight:600;">Paid ₹${m.Amount.toFixed(2)} via Pay</span>`);
                } else if (m.Type === 'CREDIT' && m.Status === 'SUCCESS') {
                    if (m.Title.toLowerCase().includes('cashback')) {
                        annotations.push(`<span style="display:inline-block; font-size:8px; background:#ecfdf5; color:#047857; border:1px solid #d1fae5; border-radius:3px; padding:1px 4px; margin-top:2px; margin-right:4px; font-weight:600;">+₹${m.Amount.toFixed(2)} Cashback</span>`);
                    } else if (m.Title.toLowerCase().includes('refund')) {
                        annotations.push(`<span style="display:inline-block; font-size:8px; background:#eff6ff; color:#1d4ed8; border:1px solid #dbeafe; border-radius:3px; padding:1px 4px; margin-top:2px; margin-right:4px; font-weight:600;">Refunded ₹${m.Amount.toFixed(2)}</span>`);
                    } else {
                        annotations.push(`<span style="display:inline-block; font-size:8px; background:#f3f4f6; color:#374151; border:1px solid #e5e7eb; border-radius:3px; padding:1px 4px; margin-top:2px; margin-right:4px; font-weight:600;">+₹${m.Amount.toFixed(2)} Credit</span>`);
                    }
                }
            });

            let annotationHtml = annotations.length > 0 ? `<div style="margin-top:2px;">${annotations.join('')}</div>` : '';
            return `<tr><td>${getStandardizedDateString(o.Date, 'Amazon')}</td><td><small>${o.OrderId}</small></td><td class="title-cell">${o.Item}${annotationHtml}</td><td>${o.Recipient}</td><td class="right font-bold">₹${o.CashAmount.toLocaleString('en-IN')}</td></tr>`;
        }).join('') + `<tr class="total-row"><td colspan="4" class="right">Total Section Summary:</td><td class="right">₹${items.reduce((s, o) => s + o.CashAmount, 0).toLocaleString('en-IN')}</td></tr>`;
    };

    let yearlyRows = Object.keys(analytics.yearlySpend)
        .sort((a, b) => b - a)
        .map(year => `
            <tr>
                <td class="font-bold" style="font-size:11px;">${year}</td>
                <td class="font-bold" style="font-size:11px;color:#ff9900;">₹${analytics.yearlySpend[year].cash.toLocaleString('en-IN')}</td>
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
                        <div style="background:#ff9900; height:100%; width:${pct}%;"></div>
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

    let payRows = "";
    if (payHistory && payHistory.length > 0) {
        payRows = payHistory.map(p => {
            let amtClass = p.Type === 'CREDIT' ? 'style="color:#16a34a; font-weight:bold;"' : 'style="color:#dc2626; font-weight:bold;"';
            let prefix = p.Type === 'CREDIT' ? '+' : '-';

            let matchOrder = p.OrderId ? orders.find(o => o.OrderId === p.OrderId) : null;
            let orderBadge = matchOrder
                ? `<div style="margin-top:2px; font-size:8px; color:#475569; font-weight:500;">🛒 Order Purchase: <span style="font-weight:600; color:#1e293b;">${matchOrder.Item}</span></div>`
                : (p.OrderId ? `<div style="margin-top:2px; font-size:8px; color:#64748b; font-weight:500;">🛒 Order ID: <span style="font-weight:600;">${p.OrderId}</span></div>` : '');

            return `
                <tr>
                    <td>${getStandardizedDateString(p.Date, 'Amazon')}</td>
                    <td class="title-cell">${p.Title}${orderBadge}</td>
                    <td class="center font-bold" style="color: ${p.Type === 'CREDIT' ? '#16a34a' : '#2c3e50'};">${p.Type}</td>
                    <td class="center font-bold">${p.Status}</td>
                    <td class="right" ${amtClass}>${prefix}₹${p.Amount.toFixed(2)}</td>
                </tr>
            `;
        }).join('') + `
            <tr class="total-row">
                <td colspan="4" class="right">Net Ledger Outlay (Credits minus Debits):</td>
                <td class="right" style="color: ${(payHistory.filter(p => p.Type === 'CREDIT' && p.Status === 'SUCCESS').reduce((s, o) => s + o.Amount, 0) - payHistory.filter(p => p.Type === 'DEBIT' && p.Status === 'SUCCESS').reduce((s, o) => s + o.Amount, 0)) >= 0 ? '#16a34a' : '#dc2626'}; font-weight: bold;">
                    ₹${(payHistory.filter(p => p.Type === 'CREDIT' && p.Status === 'SUCCESS').reduce((s, o) => s + o.Amount, 0) - payHistory.filter(p => p.Type === 'DEBIT' && p.Status === 'SUCCESS').reduce((s, o) => s + o.Amount, 0)).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </td>
            </tr>
        `;
    }

    return `
        <html>
        <head>
            <meta charset="UTF-8">
            <title>Amazon Financial Statement</title>
            <style>
                body { font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; color: #2c3e50; padding: 20px; font-size: 11px; }
                .header-banner { background-color: #232f3e; color: white; padding: 15px 20px; border-radius: 4px; margin-bottom: 20px; display: flex; justify-content: space-between; align-items: center; border-bottom: 4px solid #ff9900; }
                .header-banner h1 { margin: 0; font-size: 20px; font-weight: bold; }
                
                .kpi-grid { display: grid; grid-template-columns: repeat(4, 1fr) !important; gap: 10px; margin-bottom: 20px; }
                .kpi-card { background-color: #f8f9fa; border: 1px solid #eaeded; padding: 10px; border-radius: 4px; text-align: center; }
                .kpi-label { font-size: 9px; font-weight: bold; color: #7f8c8d; text-transform: uppercase; margin-bottom: 4px; }
                .kpi-val { font-size: 14px; font-weight: bold; }
                .kpi-orange { color: #ff9900; }
                .kpi-subtext { font-size: 8px; color: #7f8c8d; margin-top: 2px; }
                .kpi-green { color: #27ae60; }

                .dashboard-container { background: #fdfefe; border: 1px solid #d5dbdb; border-radius: 6px; padding: 12px; margin-bottom: 20px; }
                .dashboard-title { margin-top: 0; margin-bottom: 10px; font-size: 13px; color: #232f3e; border-bottom: 2px solid #ff9900; padding-bottom: 3px; font-weight: bold; text-transform: uppercase; }
                
                .insights-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-bottom: 12px; }
                .insight-card { background: #f2f4f4; border: 1px solid #eaeded; padding: 8px; border-radius: 4px; text-align: center; }
                .insight-val { font-size: 11px; font-weight: bold; color: #232f3e; }
                .insight-desc { font-size: 8px; color: #7f8c8d; margin-top: 2px; }

                .extremes-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 12px; }
                .extreme-card { background: #f8f9fa; border: 1px solid #eaeded; padding: 8px; border-radius: 4px; }
                .extreme-title { font-size: 9px; font-weight: 500; color: #2c3e50; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-top: 2px; }
                .extreme-price { font-size: 11px; font-weight: bold; color: #ff9900; }

                h2 { font-size: 12px; color: #232f3e; border-bottom: 1px solid #232f3e; padding-bottom: 4px; margin-top: 20px; margin-bottom: 8px; text-transform: uppercase; }
                table { width: 100%; border-collapse: collapse; margin-bottom: 15px; }
                th { background-color: #232f3e; color: white; font-weight: bold; text-align: left; padding: 5px 8px; font-size: 9px; text-transform: uppercase; }
                td { padding: 5px 8px; border-bottom: 1px solid #f2f4f4; vertical-align: middle; }
                tr:nth-child(even):not(.total-row) { background-color: #fafafa; }
                .title-cell { max-width: 250px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
                .center { text-align: center; } .right { text-align: right; } .font-bold { font-weight: bold; }
                .total-row { background-color: #eaeded !important; font-weight: bold; border-top: 1px solid #232f3e; }
                
                .yearly-table th { background-color: #34495e; color: white; }
                
                @media print { body { padding: 0; margin: 0; } @page { size: letter; margin: 0.5in; } }
            </style>
        </head>
        <body>
            <div class="header-banner">
                <h1>Amazon Financial Spending Statement</h1>
                <span>Report Created: ${currentDate}</span>
            </div>
            
            <div class="kpi-grid">
                <div class="kpi-card"><div class="kpi-label">Net Capital Outlay</div><div class="kpi-val kpi-orange">₹${delCash.toLocaleString('en-IN')}</div><div class="kpi-subtext">Orders Spending</div></div>
                <div class="kpi-card"><div class="kpi-label">Refund Reversals</div><div class="kpi-val">₹${refCash.toLocaleString('en-IN')}</div><div class="kpi-subtext">Returns Value</div></div>
                <div class="kpi-card"><div class="kpi-label">Amazon Pay Balance</div><div class="kpi-val kpi-green">${payBalance}</div><div class="kpi-subtext">Wallet: ${walletBalance} | Gift: ${giftBalance}</div></div>
                <div class="kpi-card"><div class="kpi-label">Cancelled Value</div><div class="kpi-val">₹${canCash.toLocaleString('en-IN')}</div><div class="kpi-subtext">Saved/Non-executed</div></div>
            </div>

            <div class="dashboard-container">
                <div class="dashboard-title">Shopping Analytics Dashboard</div>
                
                <div class="insights-grid">
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
                        </tr>
                    </thead>
                    <tbody>
                        ${yearlyRows}
                    </tbody>
                </table>
                ` : ''}

                <div class="kpi-label" style="margin-bottom: 6px; margin-top: 10px;">Recipient Delivery Breakdown</div>
                <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: 8px; margin-bottom: 6px;">
                    ${recipientHtml}
                </div>
            </div>

            ${payHistory && payHistory.length > 0 ? `
            <div class="dashboard-container" style="border-color:#ff9900; margin-top: 15px;">
                <div class="dashboard-title" style="color:#232f3e; border-bottom-color:#ff9900;">Amazon Pay Ledger Insights</div>
                <div class="insights-grid" style="grid-template-columns: repeat(5, 1fr); margin-bottom: 12px;">
                    <div class="insight-card" style="background:#fffaf0; border-color:#ff9900;">
                        <div class="kpi-label" style="color:#cc7a00;">Cashback Earned</div>
                        <div class="insight-val" style="color:#cc7a00;">₹${payAnalytics.totalCashback.toFixed(2)}</div>
                        <div class="insight-desc">Lifetime Rewards</div>
                    </div>
                    <div class="insight-card" style="background:#f0f9ff; border-color:#0284c7;">
                        <div class="kpi-label" style="color:#0369a1;">Refunds Received</div>
                        <div class="insight-val" style="color:#0369a1;">₹${payAnalytics.totalRefunds.toFixed(2)}</div>
                        <div class="insight-desc">Returned Credits</div>
                    </div>
                    <div class="insight-card" style="background:#f0fdf4; border-color:#15803d;">
                        <div class="kpi-label" style="color:#166534;">Money Added</div>
                        <div class="insight-val" style="color:#166534;">₹${payAnalytics.totalAdded.toFixed(2)}</div>
                        <div class="insight-desc">Manual Loads</div>
                    </div>
                    <div class="insight-card" style="background:#fef2f2; border-color:#b91c1c;">
                        <div class="kpi-label" style="color:#991b1b;">Wallet Outflow</div>
                        <div class="insight-val" style="color:#991b1b;">₹${payAnalytics.totalSpent.toFixed(2)}</div>
                        <div class="insight-desc">Payments Made</div>
                    </div>
                    <div class="insight-card" style="background:#f9fafb; border-color:#d1d5db;">
                        <div class="kpi-label" style="color:#374151;">Peak Cashback</div>
                        <div class="insight-val" style="font-size:10px; color:#1f2937;">${payAnalytics.peakCashbackMonth.label}</div>
                        <div class="insight-desc">${payAnalytics.peakCashbackMonth.amount > 0 ? `+₹${payAnalytics.peakCashbackMonth.amount.toFixed(2)}` : 'N/A'}</div>
                    </div>
                </div>

                <div class="kpi-label" style="margin-bottom: 6px;">Amazon Pay Outflow Breakdown by Payment Instrument</div>
                <div style="display: flex; gap: 8px; justify-content: space-between; margin-top: 6px;">
                    ${Object.entries(payAnalytics.paymentBreakdown).map(([method, amt]) => {
        let pct = payAnalytics.totalSpent > 0 ? ((amt / payAnalytics.totalSpent) * 100).toFixed(0) : 0;
        if (amt === 0) return '';
        return `
                            <div style="flex: 1; min-width: 80px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 6px 8px; text-align: center;">
                                <div style="font-size: 8px; font-weight: bold; color: #64748b; text-transform: uppercase;">${method}</div>
                                <div style="font-size: 11px; font-weight: bold; color: #1e293b; margin-top: 2px;">₹${amt.toFixed(2)}</div>
                                <div style="font-size: 8px; color: #94a3b8; margin-top: 1px;">${pct}% of pay spend</div>
                            </div>
                        `;
    }).join('')}
                </div>
            </div>
            ` : ''}

            <h2>1. Executed Transactions (Delivered & Kept Purchases)</h2>
            <table><thead><tr><th style="width:15%">Date</th><th style="width:25%">Order ID</th><th style="width:40%">Description</th><th style="width:10%">Recipient</th><th style="width:10%;text-align:right">Amount</th></tr></thead><tbody>${makeTableRows(delivered)}</tbody></table>
            
            <h2>2. Returned Transactions & Account Reversals (Refunded)</h2>
            <table><thead><tr><th style="width:15%">Date</th><th style="width:25%">Order ID</th><th style="width:40%">Description</th><th style="width:10%">Recipient</th><th style="width:10%;text-align:right">Amount</th></tr></thead><tbody>${makeTableRows(refunded)}</tbody></table>
            
            <h2>3. Cancelled Order Value (Saved)</h2>
            <table><thead><tr><th style="width:15%">Date</th><th style="width:25%">Order ID</th><th style="width:40%">Description</th><th style="width:10%">Recipient</th><th style="width:10%;text-align:right">Amount</th></tr></thead><tbody>${makeTableRows(cancelled)}</tbody></table>

            ${payRows ? `
            <h2>4. Amazon Pay Transaction History</h2>
            <table>
                <thead>
                    <tr>
                        <th style="width:20%">Date</th>
                        <th style="width:40%">Description</th>
                        <th style="width:15%;text-align:center">Type</th>
                        <th style="width:10%;text-align:center">Status</th>
                        <th style="width:15%;text-align:right">Amount</th>
                    </tr>
                </thead>
                <tbody>
                    ${payRows}
                </tbody>
            </table>
            ` : ''}
        </body>
        </html>
    `;
}

function showAmazonScraperOverlay(message, submessage = "") {
    let overlay = document.getElementById('amazonOrdersScraperOverlay');
    if (!overlay) {
        injectGoogleFonts();
        overlay = document.createElement('div');
        overlay.id = 'amazonOrdersScraperOverlay';
        overlay.style.cssText = 'position: fixed; top: 24px; right: 24px; background: rgba(255, 255, 255, 0.85); backdrop-filter: blur(12px) saturate(180%); -webkit-backdrop-filter: blur(12px) saturate(180%); border: 1px solid rgba(255, 255, 255, 0.4); padding: 20px; border-radius: 16px; z-index: 10000000; box-shadow: 0 10px 30px rgba(0, 0, 0, 0.1), inset 0 1px 1px rgba(255, 255, 255, 0.3); font-family: "Outfit", sans-serif; width: 280px; box-sizing: border-box; transition: all 0.3s ease;';

        overlay.innerHTML = `
            <div style="display: flex; align-items: center; gap: 10px; font-weight: 700; color: #ff9900; font-size: 15px; margin-bottom: 6px;">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="spinner-icon"><line x1="12" y1="2" x2="12" y2="6"></line><line x1="12" y1="18" x2="12" y2="22"></line><line x1="4.93" y1="4.93" x2="7.76" y2="7.76"></line><line x1="16.24" y1="16.24" x2="19.07" y2="19.07"></line><line x1="2" y1="12" x2="6" y2="12"></line><line x1="18" y1="12" x2="22" y2="12"></line><line x1="6.34" y1="17.66" x2="8.46" y2="15.54"></line><line x1="15.54" y1="8.46" x2="17.66" y2="6.34"></line></svg>
                Amazon Spend History
            </div>
            <div id="ordersScraperMessage" style="font-size: 13px; font-weight: 600; color: #1e293b; margin-bottom: 4px;"></div>
            <div id="ordersScraperSubmessage" style="font-size: 11px; color: #64748b; font-weight: 500; line-height: 1.4; margin-bottom: 8px;"></div>
            <button id="inPageStopOrdersBtn" style="width: 100%; border: 1px solid #ef4444; color: #ef4444; font-weight: 600; background: rgba(239, 68, 68, 0.05); cursor: pointer; transition: all 0.2s; padding: 8px 12px; border-radius: 8px; font-family: 'Outfit', sans-serif; font-size: 12px; box-sizing: border-box;" onmouseover="this.style.background='rgba(239, 68, 68, 0.1)';" onmouseout="this.style.background='rgba(239, 68, 68, 0.05)';">Stop Extraction</button>
            <style>
                @keyframes spin { 100% { transform: rotate(360deg); } }
                .spinner-icon { animation: spin 1.5s linear infinite; }
            </style>
        `;
        document.body.appendChild(overlay);

        // Attach stop listener
        const stopBtn = overlay.querySelector('#inPageStopOrdersBtn');
        if (stopBtn) {
            stopBtn.addEventListener('click', () => {
                console.log("[Amazon Scraper] In-page stop button clicked. Terminating...");
                chrome.storage.local.set({
                    amazonScraperStatus: "idle",
                    amazonTargetYears: [],
                    amazonCurrentYearIndex: 0
                }, () => {
                    window.amazonScraperState.status = "idle";
                    if (window.amazonScraperTimeout) {
                        clearTimeout(window.amazonScraperTimeout);
                        window.amazonScraperTimeout = null;
                    }
                    overlay.remove();
                });
            });
        }
    }

    document.getElementById('ordersScraperMessage').innerText = message;
    document.getElementById('ordersScraperSubmessage').innerText = submessage;
}
