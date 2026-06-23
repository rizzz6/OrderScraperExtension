let pollInterval = null;
let activeOrdersData = [];
let activeCoinsData = [];
let currentPlatform = 'general'; // 'flipkart' | 'amazon' | 'general'

let flipkartOrders = [];
let amazonOrders = [];
let flipkartCoins = [];
let amazonPayLedger = [];

function showView(viewName) {
    document.getElementById('viewIdle').classList.add('hidden');
    document.getElementById('viewRunning').classList.add('hidden');
    document.getElementById('viewCompleted').classList.add('hidden');
    
    if (viewName === 'idle') {
        document.getElementById('viewIdle').classList.remove('hidden');
    } else if (viewName === 'running') {
        document.getElementById('viewRunning').classList.remove('hidden');
    } else if (viewName === 'completed') {
        document.getElementById('viewCompleted').classList.remove('hidden');
    }
}

function showToast(message, type = 'info') {
    const container = document.getElementById('toastContainer');
    if (!container) return;
    
    container.innerHTML = '';
    
    const toast = document.createElement('div');
    toast.className = `toast-card toast-${type}`;
    
    let iconSvg = '';
    if (type === 'success') {
        iconSvg = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
    } else if (type === 'error') {
        iconSvg = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>`;
    } else {
        iconSvg = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>`;
    }
    
    toast.innerHTML = `
        <div class="toast-icon">${iconSvg}</div>
        <div style="flex-grow: 1;">${message}</div>
    `;
    
    container.appendChild(toast);
    container.classList.add('show');
    
    if (window.toastTimeout) {
        clearTimeout(window.toastTimeout);
    }
    window.toastTimeout = setTimeout(() => {
        container.classList.remove('show');
    }, 3500);
}

function startPolling() {
    if (pollInterval) return;
    pollInterval = setInterval(checkTabStatus, 1000);
}

function stopPolling() {
    if (pollInterval) {
        clearInterval(pollInterval);
        pollInterval = null;
    }
}

async function checkTabStatus() {
    let [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    if (!tab || !tab.url) {
        setPlatformUI('general');
        showView('idle');
        checkAndRenderConsolidatedDashboard();
        stopPolling();
        return;
    }

    let isFlipkart = tab.url.includes('flipkart.com/account/orders');
    let isAmazon = tab.url.includes('amazon.in/your-orders') || 
                   tab.url.includes('amazon.in/gp/css/order-history') || 
                   tab.url.includes('amazon.com/your-orders') || 
                   tab.url.includes('amazon.com/gp/css/order-history');

    if (isFlipkart) {
        setPlatformUI('flipkart');
        chrome.tabs.sendMessage(tab.id, { action: "checkStatus" }, (response) => {
            if (chrome.runtime.lastError) {
                chrome.storage.local.get(["scraperStatus", "orders", "coinsHistory"], (res) => {
                    if (res.scraperStatus === "completed" && res.orders && res.orders.length > 0) {
                        handleStateUpdate({
                            status: "completed",
                            orders: res.orders,
                            coinsHistory: res.coinsHistory,
                            itemCount: res.orders.length
                        });
                    } else {
                        showView('idle');
                        stopPolling();
                    }
                });
                return;
            }
            if (response) {
                handleStateUpdate(response);
            }
        });
    } else if (isAmazon) {
        setPlatformUI('amazon');
        chrome.tabs.sendMessage(tab.id, { action: "checkStatus" }, (response) => {
            if (chrome.runtime.lastError) {
                chrome.storage.local.get(["amazonScraperStatus", "amazonOrders"], (res) => {
                    if (res.amazonScraperStatus === "running") {
                        handleStateUpdate({
                            status: "running",
                            itemCount: (res.amazonOrders || []).length,
                            orders: res.amazonOrders || []
                        });
                        startPolling();
                    } else if (res.amazonScraperStatus === "completed" && res.amazonOrders && res.amazonOrders.length > 0) {
                        handleStateUpdate({
                            status: "completed",
                            itemCount: res.amazonOrders.length,
                            orders: res.amazonOrders
                        });
                        stopPolling();
                    } else {
                        showView('idle');
                        stopPolling();
                    }
                });
                return;
            }
            if (response) {
                handleStateUpdate(response);
            }
        });
    } else {
        setPlatformUI('general');
        showView('idle');
        checkAndRenderConsolidatedDashboard();
        stopPolling();
        return;
    }
}

function setPlatformUI(platform) {
    currentPlatform = platform;
    let headerBanner = document.getElementById('headerBanner');
    let headerTitle = document.getElementById('headerTitle');
    
    let flipkartPrompt = document.getElementById('flipkartPrompt');
    let amazonPrompt = document.getElementById('amazonPrompt');
    let generalPrompt = document.getElementById('generalPrompt');
    
    let flipkartDownloads = document.getElementById('flipkartDownloads');
    let amazonDownloads = document.getElementById('amazonDownloads');
    
    let runningRing = document.getElementById('runningRing');
    let runningTitle = document.getElementById('runningTitle');
    let progressCount = document.getElementById('progressCount');

    headerBanner.classList.remove('amazon');
    runningRing.classList.remove('amazon');
    runningTitle.classList.remove('amazon');
    progressCount.classList.remove('amazon');

    flipkartPrompt.classList.add('hidden');
    amazonPrompt.classList.add('hidden');
    generalPrompt.classList.add('hidden');
    flipkartDownloads.classList.add('hidden');
    amazonDownloads.classList.add('hidden');

    if (platform === 'flipkart') {
        headerTitle.innerText = "Flipkart Spend History";
        flipkartPrompt.classList.remove('hidden');
        flipkartDownloads.classList.remove('hidden');
        runningTitle.innerText = "Scanning Order History";
        document.getElementById('consolidatedDashboard').classList.add('hidden');
    } else if (platform === 'amazon') {
        headerBanner.classList.add('amazon');
        runningRing.classList.add('amazon');
        runningTitle.classList.add('amazon');
        progressCount.classList.add('amazon');
        
        headerTitle.innerText = "Amazon Spend History";
        amazonPrompt.classList.remove('hidden');
        amazonDownloads.classList.remove('hidden');
        runningTitle.innerText = "Scanning Amazon History";
        document.getElementById('consolidatedDashboard').classList.add('hidden');
    } else {
        headerTitle.innerText = "Spend History";
        generalPrompt.classList.remove('hidden');
        checkAndRenderConsolidatedDashboard();
    }
}

function handleStateUpdate(state) {
    if (state.status === "idle") {
        showView('idle');
        stopPolling();
    } else if (state.status === "running") {
        showView('running');
        document.getElementById('progressCount').innerText = state.itemCount || 0;
        startPolling();
    } else if (state.status === "completed") {
        showView('completed');
        stopPolling();
        
        activeOrdersData = (state.orders || []).map(o => ({...o, Store: currentPlatform === 'amazon' ? 'Amazon' : 'Flipkart'}));
        activeCoinsData = state.coinsHistory || [];
        
        let deliveredItems = activeOrdersData.filter(o => o.Category === 'Delivered/Kept');
        let totalSpent = deliveredItems.reduce((sum, o) => sum + o.CashAmount, 0);
        
        document.getElementById('statOrders').innerText = activeOrdersData.length;
        document.getElementById('statSpent').innerText = "₹" + totalSpent.toLocaleString('en-IN');
        
        if (currentPlatform === 'amazon') {
            document.getElementById('amazonPayStats').classList.remove('hidden');
            document.getElementById('flipkartCoinsStats').classList.add('hidden');
            chrome.storage.local.get([
                "amazonPayBalance", 
                "amazonWalletBalance", 
                "amazonGiftCardBalance",
                "amazonPayHistory"
            ], (res) => {
                document.getElementById('statAmazonPayBalance').innerText = res.amazonPayBalance || "₹0.00";
                document.getElementById('statAmazonWalletBalance').innerText = res.amazonWalletBalance || "₹0.00";
                document.getElementById('statAmazonGiftBalance').innerText = res.amazonGiftCardBalance || "₹0.00";
                
                let payHistory = res.amazonPayHistory || [];
                let payAnalytics = getAmazonPayAnalytics(payHistory);
                document.getElementById('statAmazonPayCashback').innerText = "₹" + payAnalytics.totalCashback.toFixed(2);
            });
        } else if (currentPlatform === 'flipkart') {
            document.getElementById('amazonPayStats').classList.add('hidden');
            document.getElementById('flipkartCoinsStats').classList.remove('hidden');
            let coinsAnalytics = getCoinsAnalytics(activeCoinsData, activeOrdersData);
            document.getElementById('statFlipkartCoinsEarned').innerText = coinsAnalytics.totalEarned.toLocaleString('en-IN');
            document.getElementById('statFlipkartCoinsSpent').innerText = coinsAnalytics.totalUsed.toLocaleString('en-IN');
            document.getElementById('statFlipkartCoinsExpired').innerText = coinsAnalytics.totalExpired.toLocaleString('en-IN');
        } else {
            document.getElementById('amazonPayStats').classList.add('hidden');
            document.getElementById('flipkartCoinsStats').classList.add('hidden');
        }

        renderAnalyticsAndVisuals(activeOrdersData, false);
    }
}

function checkAndRenderConsolidatedDashboard() {
    if (flipkartOrders.length > 0 || amazonOrders.length > 0) {
        document.getElementById('consolidatedDashboard').classList.remove('hidden');
        
        let fkDelivered = flipkartOrders.filter(o => o.Category === 'Delivered/Kept');
        let fkTotal = fkDelivered.reduce((sum, o) => sum + (o.CashAmount || 0), 0);
        
        let amzDelivered = amazonOrders.filter(o => o.Category === 'Delivered/Kept');
        let amzTotal = amzDelivered.reduce((sum, o) => sum + (o.CashAmount || 0), 0);
        
        let combinedTotal = fkTotal + amzTotal;
        
        document.getElementById('combinedStatSpent').innerText = "₹" + combinedTotal.toLocaleString('en-IN');
        document.getElementById('combinedStatAmazonSpent').innerText = "₹" + amzTotal.toLocaleString('en-IN');
        document.getElementById('combinedStatFlipkartSpent').innerText = "₹" + fkTotal.toLocaleString('en-IN');

        let combinedOrders = [
            ...flipkartOrders.map(o => ({...o, Store: 'Flipkart'})),
            ...amazonOrders.map(o => ({...o, Store: 'Amazon'}))
        ];
        renderAnalyticsAndVisuals(combinedOrders, true);
    } else {
        document.getElementById('consolidatedDashboard').classList.add('hidden');
    }
}

function updateThemeIcon(isDark) {
    const icon = document.getElementById("themeToggleIcon");
    if (!icon) return;
    if (isDark) {
        icon.innerHTML = `<circle cx="12" cy="12" r="5"></circle><line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line><line x1="1" y1="12" x2="3" y2="12"></line><line x1="21" y1="12" x2="23" y2="12"></line><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line>`;
    } else {
        icon.innerHTML = `<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>`;
    }
}

async function initPopup() {
    chrome.storage.local.get([
        "orders", 
        "coinsHistory", 
        "amazonOrders", 
        "amazonPayHistory", 
        "theme"
    ], (res) => {
        flipkartOrders = res.orders || [];
        flipkartCoins = res.coinsHistory || [];
        amazonOrders = res.amazonOrders || [];
        amazonPayLedger = res.amazonPayHistory || [];
        
        if (res.theme === "dark") {
            document.body.classList.add("dark");
            updateThemeIcon(true);
        } else {
            document.body.classList.remove("dark");
            updateThemeIcon(false);
        }

        if (currentPlatform === 'general') {
            checkAndRenderConsolidatedDashboard();
        }
    });

    document.getElementById("themeToggle").addEventListener("click", () => {
        let isDark = document.body.classList.toggle("dark");
        chrome.storage.local.set({ theme: isDark ? "dark" : "light" });
        updateThemeIcon(isDark);
        
        if (currentPlatform === 'general') {
            checkAndRenderConsolidatedDashboard();
        } else if (activeOrdersData.length > 0) {
            renderAnalyticsAndVisuals(activeOrdersData, false);
        }
    });

    document.getElementById('downloadCombinedCSV').addEventListener('click', () => {
        let combined = [];
        
        flipkartOrders.forEach(o => {
            combined.push({
                Store: "Flipkart",
                OrderId: o.OrderId || "N/A",
                Date: getStandardizedDateString(o.Date, 'Flipkart'),
                Category: o.Category,
                Item: o.Item,
                CashAmount: o.CashAmount,
                SupercoinsUsed: o.SupercoinsUsed,
                Recipient: "N/A"
            });
        });
        
        amazonOrders.forEach(o => {
            combined.push({
                Store: "Amazon",
                OrderId: o.OrderId || "Unknown ID",
                Date: getStandardizedDateString(o.Date, 'Amazon'),
                Category: o.Category,
                Item: o.Item,
                CashAmount: o.CashAmount,
                SupercoinsUsed: 0,
                Recipient: o.Recipient || "Unknown"
            });
        });
        
        if (combined.length === 0) {
            showToast("No cached store records available to export!", "error");
            return;
        }

        combined.sort((a, b) => {
            let dateA = Date.parse(a.Date) || 0;
            let dateB = Date.parse(b.Date) || 0;
            return dateB - dateA;
        });

        let csvContent = "data:text/csv;charset=utf-8,Store,OrderId,Date,Category,Item,CashAmount,SupercoinsUsed,Recipient\n" +
            combined.map(e => `"${e.Store}","${e.OrderId}","${e.Date}","${e.Category}","${e.Item.replace(/"/g, '""')}",${e.CashAmount},${e.SupercoinsUsed},"${e.Recipient.replace(/"/g, '""')}"`).join("\n");
        let link = document.createElement("a");
        link.setAttribute("href", encodeURI(csvContent));
        link.setAttribute("download", "consolidated_shopping_spend_history.csv");
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    });

    document.getElementById('downloadCombinedPDF').addEventListener('click', () => {
        let printWindow = window.open('', '_blank');
        if (!printWindow) {
            showToast("Please allow popups to generate the PDF report.", "error");
            return;
        }
        printWindow.document.write(buildCombinedPDFHTML());
        printWindow.document.close();
        setTimeout(() => { printWindow.print(); }, 1000);
    });

    document.getElementById('startScraper').addEventListener('click', async () => {
        let [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab || !tab.url || !tab.url.includes('flipkart.com/account/orders')) {
            showToast("Please open your Flipkart Orders page first!", "error");
            return;
        }

        let selectedRange = document.getElementById('flipkartRange').value;

        const sendFlipkartStart = (retrying) => {
            chrome.tabs.sendMessage(tab.id, { action: "startScraping", scope: selectedRange }, (response) => {
                if (chrome.runtime.lastError) {
                    if (!retrying) {
                        setTimeout(() => sendFlipkartStart(true), 1000);
                    } else {
                        showToast("Failed to connect to Flipkart. Try reloading the tab.", "error");
                    }
                } else if (response) {
                    if (response.status === "started") {
                        showView('running');
                        startPolling();
                    } else {
                        handleStateUpdate(response);
                    }
                }
            });
        };
        sendFlipkartStart(false);
    });

    document.getElementById('startAmazonScraper').addEventListener('click', async () => {
        let [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        let isAmazon = tab && tab.url && (tab.url.includes('amazon.in/your-orders') || 
                       tab.url.includes('amazon.in/gp/css/order-history') || 
                       tab.url.includes('amazon.com/your-orders') || 
                       tab.url.includes('amazon.com/gp/css/order-history'));

        if (!tab || !isAmazon) {
            showToast("Please open your Amazon Orders page first!", "error");
            return;
        }

        let selectedRange = document.getElementById('amazonRange').value;

        chrome.storage.local.set({
            amazonPayBalance: "₹0.00",
            amazonWalletBalance: "₹0.00",
            amazonGiftCardBalance: "₹0.00",
            amazonPayHistory: [],
            amazonPayScrapingActive: true
        }, () => {
            chrome.runtime.sendMessage({ action: "openAmazonPayTab" });
        });

        const sendAmazonStart = (retrying) => {
            chrome.tabs.sendMessage(tab.id, { action: "startScraping", scope: selectedRange }, (response) => {
                if (chrome.runtime.lastError) {
                    if (!retrying) {
                        setTimeout(() => sendAmazonStart(true), 1000);
                    } else {
                        chrome.storage.local.set({ amazonPayScrapingActive: false });
                        showToast("Failed to connect to Amazon. Try reloading the tab.", "error");
                    }
                } else if (response) {
                    if (response.status === "started") {
                        showView('running');
                        startPolling();
                    } else {
                        handleStateUpdate(response);
                    }
                }
            });
        };
        sendAmazonStart(false);
    });

    document.getElementById('goToFlipkart').addEventListener('click', () => {
        chrome.tabs.create({ url: "https://www.flipkart.com/account/orders" });
    });

    document.getElementById('goToAmazon').addEventListener('click', () => {
        chrome.tabs.create({ url: "https://www.amazon.in/your-orders/orders" });
    });

    document.getElementById('downloadCSV').addEventListener('click', () => {
        if (!activeOrdersData || activeOrdersData.length === 0) return;
        let csvContent = "data:text/csv;charset=utf-8,OrderId,Date,Category,Item,CashAmount,SupercoinsUsed\n" +
            activeOrdersData.map(e => `"${e.OrderId || 'N/A'}","${getStandardizedDateString(e.Date, 'Flipkart')}","${e.Category}","${e.Item.replace(/"/g, '""')}",${e.CashAmount},${e.SupercoinsUsed}`).join("\n");
        let link = document.createElement("a");
        link.setAttribute("href", encodeURI(csvContent));
        link.setAttribute("download", "flipkart_order_history.csv");
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    });

    document.getElementById('downloadCoinsCSV').addEventListener('click', () => {
        if (!activeCoinsData || activeCoinsData.length === 0) {
            showToast("No SuperCoin history available to export!", "error");
            return;
        }
        let csvContent = "data:text/csv;charset=utf-8,Date,ActivityDetails,Type,Amount\n" +
            activeCoinsData.map(e => `"${getStandardizedDateString(e.Date, 'Flipkart')}","${e.Title.replace(/"/g, '""')}","${e.Type}",${e.Amount}`).join("\n");
        let link = document.createElement("a");
        link.setAttribute("href", encodeURI(csvContent));
        link.setAttribute("download", "flipkart_supercoin_history.csv");
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    });

    document.getElementById('downloadPDF').addEventListener('click', () => {
        if (!activeOrdersData || activeOrdersData.length === 0) return;
        let printWindow = window.open('', '_blank');
        printWindow.document.write(buildPDFHTML(activeOrdersData, activeCoinsData));
        printWindow.document.close();
        setTimeout(() => { printWindow.print(); }, 1000);
    });

    document.getElementById('downloadAmazonCSV').addEventListener('click', () => {
        if (!activeOrdersData || activeOrdersData.length === 0) return;
        let csvContent = "data:text/csv;charset=utf-8,OrderId,Date,Category,Item,CashAmount,Recipient\n" +
            activeOrdersData.map(e => `"${e.OrderId}","${getStandardizedDateString(e.Date, 'Amazon')}","${e.Category}","${e.Item.replace(/"/g, '""')}",${e.CashAmount},"${e.Recipient.replace(/"/g, '""')}"`).join("\n");
        let link = document.createElement("a");
        link.setAttribute("href", encodeURI(csvContent));
        link.setAttribute("download", "amazon_order_history.csv");
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    });

    document.getElementById('downloadAmazonPayCSV').addEventListener('click', () => {
        chrome.storage.local.get(["amazonPayHistory"], (res) => {
            let history = res.amazonPayHistory || [];
            if (history.length === 0) {
                showToast("No Amazon Pay history available to export!", "error");
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

    document.getElementById('downloadAmazonPDF').addEventListener('click', () => {
        if (!activeOrdersData || activeOrdersData.length === 0) return;
        let printWindow = window.open('', '_blank');
        if (!printWindow) {
            showToast("Please allow popups to generate the PDF report.", "error");
            return;
        }
        chrome.storage.local.get([
            "amazonPayBalance", 
            "amazonWalletBalance", 
            "amazonGiftCardBalance", 
            "amazonPayHistory"
        ], (res) => {
            printWindow.document.write(buildAmazonPDFHTML(
                activeOrdersData,
                res.amazonPayHistory || [],
                res.amazonPayBalance || "₹0.00",
                res.amazonWalletBalance || "₹0.00",
                res.amazonGiftCardBalance || "₹0.00"
            ));
            printWindow.document.close();
            setTimeout(() => { printWindow.print(); }, 1000);
        });
    });

    document.getElementById('resetScraper').addEventListener('click', (e) => {
        e.preventDefault();
        document.getElementById('confirmModal').classList.remove('hidden');
    });

    document.getElementById('confirmNoBtn').addEventListener('click', () => {
        document.getElementById('confirmModal').classList.add('hidden');
    });

    document.getElementById('confirmYesBtn').addEventListener('click', async () => {
        document.getElementById('confirmModal').classList.add('hidden');
        let [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        
        if (currentPlatform === 'amazon') {
            chrome.storage.local.set({ 
                amazonScraperStatus: "idle", 
                amazonOrders: [], 
                amazonTargetYears: [], 
                amazonCurrentYearIndex: 0,
                amazonPayBalance: "₹0.00",
                amazonWalletBalance: "₹0.00",
                amazonGiftCardBalance: "₹0.00",
                amazonPayHistory: [],
                amazonPayScrapingActive: false
            }, async () => {
                activeOrdersData = [];
                flipkartOrders = [];
                amazonOrders = [];
                flipkartCoins = [];
                amazonPayLedger = [];
                if (tab && tab.url && (tab.url.includes('amazon.in') || tab.url.includes('amazon.com'))) {
                    chrome.tabs.sendMessage(tab.id, { action: "resetState" }, (response) => {
                        showView('idle');
                        checkTabStatus();
                    });
                } else {
                    showView('idle');
                    checkAndRenderConsolidatedDashboard();
                }
            });
        } else {
            chrome.storage.local.set({ scraperStatus: "idle", orders: [], coinsHistory: [] }, async () => {
                activeOrdersData = [];
                activeCoinsData = [];
                flipkartOrders = [];
                amazonOrders = [];
                flipkartCoins = [];
                amazonPayLedger = [];
                if (tab && tab.url && tab.url.includes('flipkart.com/account/orders')) {
                    chrome.tabs.sendMessage(tab.id, { action: "resetState" }, (response) => {
                        showView('idle');
                        checkTabStatus();
                    });
                } else {
                    showView('idle');
                    checkAndRenderConsolidatedDashboard();
                }
            });
        }
    });

    document.getElementById('stopScraperBtn').addEventListener('click', async () => {
        let [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
        
        if (currentPlatform === 'amazon') {
            chrome.storage.local.set({ 
                amazonScraperStatus: "idle", 
                amazonPayScrapingActive: false 
            }, () => {
                chrome.tabs.query({}, (tabs) => {
                    tabs.forEach(t => {
                        const isAmazonTab = t.url && t.url.includes("amazon.in");
                        const isActiveTab = activeTab && t.id === activeTab.id;
                        if (isAmazonTab || isActiveTab) {
                            chrome.tabs.sendMessage(t.id, { action: "stopScraping" }, (response) => {
                                if (chrome.runtime.lastError) { /* ignore */ }
                            });
                        }
                    });
                    showView('idle');
                    checkTabStatus();
                });
            });
        } else if (currentPlatform === 'flipkart') {
            chrome.storage.local.set({ 
                scraperStatus: "idle",
                coinsScrapingActive: false
            }, () => {
                chrome.tabs.query({}, (tabs) => {
                    tabs.forEach(t => {
                        const isFlipkartTab = t.url && t.url.includes("flipkart.com");
                        const isActiveTab = activeTab && t.id === activeTab.id;
                        if (isFlipkartTab || isActiveTab) {
                            chrome.tabs.sendMessage(t.id, { action: "stopScraping" }, (response) => {
                                if (chrome.runtime.lastError) { /* ignore */ }
                            });
                        }
                    });
                    showView('idle');
                    checkTabStatus();
                });
            });
        }
    });

    await checkTabStatus();
}

initPopup();

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

function getSixMonthWindow(orders) {
    let maxDate = new Date();
    let hasValidDate = false;
    
    orders.forEach(o => {
        let parsed = o.Store === 'Amazon' ? parseAmazonDate(o.Date) : parseDate(o.Date);
        if (parsed.valid) {
            let d = new Date(parsed.year, parsed.month, 1);
            if (!hasValidDate || d > maxDate) {
                maxDate = d;
                hasValidDate = true;
            }
        }
    });
    
    let months = [];
    for (let i = 5; i >= 0; i--) {
        let d = new Date(maxDate.getFullYear(), maxDate.getMonth() - i, 1);
        months.push({
            year: d.getFullYear(),
            month: d.getMonth(),
            label: d.toLocaleString('en-IN', { month: 'short' }),
            key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
            fkCash: 0,
            amzCash: 0
        });
    }
    return months;
}

function groupSpendByMonth(orders, monthsWindow) {
    orders.forEach(o => {
        if (o.Category !== 'Delivered/Kept') return;
        let parsed = o.Store === 'Amazon' ? parseAmazonDate(o.Date) : parseDate(o.Date);
        if (parsed.valid) {
            let key = `${parsed.year}-${String(parsed.month + 1).padStart(2, '0')}`;
            let mObj = monthsWindow.find(m => m.key === key);
            if (mObj) {
                let amt = Number(o.CashAmount) || 0;
                if (o.Store === 'Amazon') {
                    mObj.amzCash += amt;
                } else {
                    mObj.fkCash += amt;
                }
            }
        }
    });
}

function drawSpendChart(canvasId, orders) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    
    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    
    const dpr = window.devicePixelRatio || 1;
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    
    const width = rect.width;
    const height = rect.height;
    ctx.clearRect(0, 0, width, height);
    
    const months = getSixMonthWindow(orders);
    groupSpendByMonth(orders, months);
    
    let maxMonthlyTotal = 100;
    months.forEach(m => {
        let total = m.fkCash + m.amzCash;
        if (total > maxMonthlyTotal) maxMonthlyTotal = total;
    });
    
    const roundToCleanMax = (val) => {
        if (val <= 100) return 100;
        if (val <= 1000) return Math.ceil(val / 100) * 100;
        if (val <= 10000) return Math.ceil(val / 1000) * 1000;
        return Math.ceil(val / 5000) * 5000;
    };
    maxMonthlyTotal = roundToCleanMax(maxMonthlyTotal);
    
    const isDark = document.body.classList.contains('dark');
    
    const paddingLeft = 32;
    const paddingRight = 10;
    const paddingTop = 15;
    const paddingBottom = 20;
    
    const chartWidth = width - paddingLeft - paddingRight;
    const chartHeight = height - paddingTop - paddingBottom;
    
    ctx.font = "500 8px 'Outfit', sans-serif";
    ctx.fillStyle = isDark ? "#94a3b8" : "#64748b";
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    
    const gridLinesCount = 3;
    for (let i = 0; i <= gridLinesCount; i++) {
        const yVal = maxMonthlyTotal * (i / gridLinesCount);
        const yPos = paddingTop + chartHeight * (1 - i / gridLinesCount);
        
        ctx.beginPath();
        ctx.strokeStyle = isDark ? "rgba(255, 255, 255, 0.08)" : "rgba(0, 0, 0, 0.05)";
        ctx.lineWidth = 1;
        if (i > 0 && i < gridLinesCount) {
            ctx.setLineDash([4, 4]);
        } else {
            ctx.setLineDash([]);
        }
        ctx.moveTo(paddingLeft, yPos);
        ctx.lineTo(width - paddingRight, yPos);
        ctx.stroke();
        
        let formattedVal = yVal >= 1000 ? (yVal / 1000).toFixed(1) + 'k' : yVal;
        ctx.fillText("₹" + formattedVal, paddingLeft - 6, yPos);
    }
    ctx.setLineDash([]);
    
    const barWidth = Math.min(22, (chartWidth / months.length) * 0.55);
    const spacing = chartWidth / months.length;
    
    months.forEach((m, index) => {
        const xPos = paddingLeft + (index * spacing) + (spacing - barWidth) / 2;
        
        const fkHeight = (m.fkCash / maxMonthlyTotal) * chartHeight;
        const amzHeight = (m.amzCash / maxMonthlyTotal) * chartHeight;
        
        const totalHeight = fkHeight + amzHeight;
        
        if (totalHeight > 0) {
            let currentY = paddingTop + chartHeight;
            
            if (fkHeight > 0) {
                const fkGrad = ctx.createLinearGradient(xPos, currentY, xPos, currentY - fkHeight);
                fkGrad.addColorStop(0, '#1d4ed8');
                fkGrad.addColorStop(1, '#3b82f6');
                ctx.fillStyle = fkGrad;
                
                ctx.beginPath();
                if (amzHeight === 0) {
                    if (ctx.roundRect) {
                        ctx.roundRect(xPos, currentY - fkHeight, barWidth, fkHeight, [4, 4, 0, 0]);
                    } else {
                        ctx.rect(xPos, currentY - fkHeight, barWidth, fkHeight);
                    }
                } else {
                    ctx.rect(xPos, currentY - fkHeight, barWidth, fkHeight);
                }
                ctx.fill();
                currentY -= fkHeight;
            }
            
            if (amzHeight > 0) {
                const amzGrad = ctx.createLinearGradient(xPos, currentY, xPos, currentY - amzHeight);
                amzGrad.addColorStop(0, '#e68a00');
                amzGrad.addColorStop(1, '#ff9900');
                ctx.fillStyle = amzGrad;
                
                ctx.beginPath();
                if (ctx.roundRect) {
                    ctx.roundRect(xPos, currentY - amzHeight, barWidth, amzHeight, [4, 4, 0, 0]);
                } else {
                    ctx.rect(xPos, currentY - amzHeight, barWidth, amzHeight);
                }
                ctx.fill();
            }
        }
        
        ctx.fillStyle = isDark ? "#cbd5e1" : "#475569";
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        ctx.fillText(m.label, xPos + barWidth / 2, paddingTop + chartHeight + 6);
    });
}

function renderAnalyticsAndVisuals(orders, isCombined) {
    const deliveredCount = orders.filter(o => o.Category === 'Delivered/Kept').length;
    const deliveredAmount = orders.filter(o => o.Category === 'Delivered/Kept').reduce((s, o) => s + (Number(o.CashAmount) || 0), 0);
    const cancelledCount = orders.filter(o => o.Category === 'Cancelled').length;
    const cancelledAmount = orders.filter(o => o.Category === 'Cancelled').reduce((s, o) => s + (Number(o.CashAmount) || 0), 0);
    const refundedCount = orders.filter(o => o.Category === 'Refunded').length;
    const refundedAmount = orders.filter(o => o.Category === 'Refunded').reduce((s, o) => s + (Number(o.CashAmount) || 0), 0);
    const fundsSaved = cancelledAmount + refundedAmount;

    const pipelineGridId = isCombined ? 'combinedStatusPipelineGrid' : 'statusPipelineGrid';
    const pipelineGrid = document.getElementById(pipelineGridId);
    
    if (pipelineGrid) {
        pipelineGrid.innerHTML = `
            <div class="stat-item" style="border-color: rgba(16, 185, 129, 0.2); background: rgba(16, 185, 129, 0.03); padding: 8px;">
                <div class="stat-val" style="color: #10b981; font-size: 13px;">${deliveredCount}</div>
                <div class="stat-lbl" style="font-size: 8px;">Delivered<br>(₹${deliveredAmount.toLocaleString('en-IN')})</div>
            </div>
            <div class="stat-item" style="border-color: rgba(239, 68, 68, 0.2); background: rgba(239, 68, 68, 0.03); padding: 8px;">
                <div class="stat-val" style="color: #ef4444; font-size: 13px;">${cancelledCount}</div>
                <div class="stat-lbl" style="font-size: 8px;"><br>Cancelled</div>
            </div>
            <div class="stat-item" style="border-color: rgba(59, 130, 246, 0.2); background: rgba(59, 130, 246, 0.03); padding: 8px;">
                <div class="stat-val" style="color: #3b82f6; font-size: 13px;">${refundedCount}</div>
                <div class="stat-lbl" style="font-size: 8px;">Refunded<br>(₹${refundedAmount.toLocaleString('en-IN')})</div>
            </div>
            <div class="stat-item" style="border-color: rgba(16, 185, 129, 0.4); background: rgba(16, 185, 129, 0.08); padding: 8px;">
                <div class="stat-val" style="color: #10b981; font-size: 13px;">₹${fundsSaved.toLocaleString('en-IN')}</div>
                <div class="stat-lbl" style="font-size: 8px; font-weight: 700;"><br>Funds Saved</div>
            </div>
        `;
    }

    const catTotals = {
        "Electronics & Gadgets": 0,
        "Home & Living": 0,
        "Fashion & Apparel": 0,
        "Beauty & Personal Care": 0,
        "Books & Education": 0,
        "Grocery": 0,
        "Others / Miscellaneous": 0
    };

    let deliveredOrders = orders.filter(o => o.Category === 'Delivered/Kept');
    deliveredOrders.forEach(o => {
        let cat = categorizeItem(o.Item);
        catTotals[cat] = (catTotals[cat] || 0) + (Number(o.CashAmount) || 0);
    });

    let totalDeliveredCash = deliveredOrders.reduce((s, o) => s + (Number(o.CashAmount) || 0), 0) || 1;
    let sortedCats = Object.entries(catTotals).sort((a, b) => b[1] - a[1]);

    const catGradients = {
        "Electronics & Gadgets": 'linear-gradient(90deg, #3b82f6, #6366f1)',
        "Home & Living": 'linear-gradient(90deg, #14b8a6, #10b981)',
        "Fashion & Apparel": 'linear-gradient(90deg, #a855f7, #ec4899)',
        "Beauty & Personal Care": 'linear-gradient(90deg, #f43f5e, #ef4444)',
        "Books & Education": 'linear-gradient(90deg, #f59e0b, #f97316)',
        "Grocery": 'linear-gradient(90deg, #84cc16, #059669)',
        "Others / Miscellaneous": 'linear-gradient(90deg, #64748b, #475569)'
    };

    let categoryHtml = sortedCats.map(([catName, amt]) => {
        if (amt === 0) return '';
        let pct = Math.round((amt / totalDeliveredCash) * 100);
        let grad = catGradients[catName] || 'linear-gradient(90deg, #3b82f6, #6366f1)';
        return `
            <div class="category-row">
                <span class="category-lbl">${catName}</span>
                <span class="category-val">${pct}% (₹${amt.toLocaleString('en-IN')})</span>
            </div>
            <div class="progress-bar-bg">
                <div class="progress-bar-fill" style="width: ${pct}%; background: ${grad};"></div>
            </div>
        `;
    }).join('');

    if (!categoryHtml) {
        categoryHtml = '<div style="font-size: 11px; color: var(--text-secondary); text-align: center; margin: 10px 0;">No purchase records available.</div>';
    }

    const categoryContainerId = isCombined ? 'combinedCategoryBreakdown' : 'categoryBreakdown';
    const categoryContainer = document.getElementById(categoryContainerId);
    if (categoryContainer) {
        categoryContainer.innerHTML = categoryHtml;
        setTimeout(() => {
            const fills = categoryContainer.querySelectorAll('.progress-bar-fill');
            fills.forEach(fill => {
                const targetWidth = fill.style.width;
                fill.style.width = '0%';
                setTimeout(() => {
                    fill.style.width = targetWidth;
                }, 50);
            });
        }, 100);
    }

    const canvasId = isCombined ? 'combinedSpendChart' : 'spendChart';
    setTimeout(() => {
        drawSpendChart(canvasId, orders);
    }, 50);
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

    let delivered = orders.filter(o => o.Category === 'Delivered/Kept');
    let orderCoinsUsed = delivered.reduce((sum, o) => sum + o.SupercoinsUsed, 0);
    totalUsed = orderCoinsUsed;

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
                    totalUsed += amount;
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

function buildAmazonPDFHTML(orders, payHistory, payBalance, walletBalance, giftBalance) {
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
                <td class="right" style="color: ${ (payHistory.filter(p => p.Type==='CREDIT' && p.Status==='SUCCESS').reduce((s, o) => s + o.Amount, 0) - payHistory.filter(p => p.Type==='DEBIT' && p.Status==='SUCCESS').reduce((s, o) => s + o.Amount, 0)) >= 0 ? '#16a34a' : '#dc2626' }; font-weight: bold;">
                    ₹${(payHistory.filter(p => p.Type==='CREDIT' && p.Status==='SUCCESS').reduce((s, o) => s + o.Amount, 0) - payHistory.filter(p => p.Type==='DEBIT' && p.Status==='SUCCESS').reduce((s, o) => s + o.Amount, 0)).toLocaleString('en-IN', {minimumFractionDigits: 2, maximumFractionDigits: 2})}
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

function buildCombinedPDFHTML() {
    let fkDelivered = flipkartOrders.filter(o => o.Category === 'Delivered/Kept');
    let amzDelivered = amazonOrders.filter(o => o.Category === 'Delivered/Kept');
    
    let fkDelCash = fkDelivered.reduce((sum, o) => sum + (o.CashAmount || 0), 0);
    let fkDelCoins = fkDelivered.reduce((sum, o) => sum + (o.SupercoinsUsed || 0), 0);
    let amzDelCash = amzDelivered.reduce((sum, o) => sum + (o.CashAmount || 0), 0);
    let combinedDelCash = fkDelCash + amzDelCash;

    // Calculate recipient breakdown
    let recipientCounts = {};
    amzDelivered.forEach(o => {
        if (o.Recipient && o.Recipient !== 'N/A') {
            let rec = o.Recipient.trim();
            recipientCounts[rec] = (recipientCounts[rec] || 0) + 1;
        }
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

    // Combine all delivered orders
    let combinedDelivered = [];
    fkDelivered.forEach(o => {
        combinedDelivered.push({
            Store: 'Flipkart',
            Date: o.Date,
            Item: o.Item,
            CashAmount: o.CashAmount || 0,
            CoinsUsed: o.SupercoinsUsed || 0,
            OrderId: o.OrderId || 'N/A',
            Recipient: 'N/A'
        });
    });
    amzDelivered.forEach(o => {
        combinedDelivered.push({
            Store: 'Amazon',
            Date: o.Date,
            Item: o.Item,
            CashAmount: o.CashAmount || 0,
            CoinsUsed: 0,
            OrderId: o.OrderId || 'N/A',
            Recipient: o.Recipient || 'N/A'
        });
    });

    function getParsedTimestamp(dateStr, store) {
        let clean = dateStr;
        if (store === 'Flipkart') {
            clean = dateStr
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
        }
        let parsed = Date.parse(clean);
        if (!isNaN(parsed)) return parsed;
        
        let p = store === 'Amazon' ? parseAmazonDate(dateStr) : parseDate(dateStr);
        if (p && p.valid) {
            return new Date(p.year, p.month, 15).getTime();
        }
        return 0;
    }

    combinedDelivered.sort((a, b) => {
        let timeA = getParsedTimestamp(a.Date, a.Store);
        let timeB = getParsedTimestamp(b.Date, b.Store);
        return timeB - timeA;
    });

    let highestCosting = null;
    let lowestCosting = null;
    
    if (combinedDelivered.length > 0) {
        let sortedByCost = [...combinedDelivered].sort((a, b) => b.CashAmount - a.CashAmount);
        highestCosting = sortedByCost[0];
        
        let nonZero = combinedDelivered.filter(o => o.CashAmount > 0);
        if (nonZero.length > 0) {
            let sortedByCostAsc = [...nonZero].sort((a, b) => a.CashAmount - b.CashAmount);
            lowestCosting = sortedByCostAsc[0];
        }
    }

    let monthlySpend = {};
    let monthlyCount = {};
    combinedDelivered.forEach(o => {
        let parsed = o.Store === 'Amazon' ? parseAmazonDate(o.Date) : parseDate(o.Date);
        if (parsed && parsed.valid) {
            let monthLabel = new Date(parsed.year, parsed.month).toLocaleString('en-IN', { month: 'short', year: 'numeric' });
            monthlySpend[monthLabel] = (monthlySpend[monthLabel] || 0) + o.CashAmount;
            monthlyCount[monthLabel] = (monthlyCount[monthLabel] || 0) + 1;
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

    let avgOrderValue = combinedDelivered.length > 0 ? Math.round(combinedDelCash / combinedDelivered.length) : 0;
    
    let totalAllOrders = flipkartOrders.length + amazonOrders.length;
    let totalDeliveredCount = fkDelivered.length + amzDelivered.length;
    let successRate = totalAllOrders > 0 ? Math.round((totalDeliveredCount / totalAllOrders) * 100) : 0;

    let yearlySpend = {};
    fkDelivered.forEach(o => {
        let parsed = parseDate(o.Date);
        if (parsed && parsed.valid) {
            let year = String(parsed.year);
            if (!yearlySpend[year]) {
                yearlySpend[year] = { fkCash: 0, fkCoins: 0, amzCash: 0 };
            }
            yearlySpend[year].fkCash += o.CashAmount || 0;
            yearlySpend[year].fkCoins += o.SupercoinsUsed || 0;
        }
    });
    amzDelivered.forEach(o => {
        let parsed = parseAmazonDate(o.Date);
        if (parsed && parsed.valid) {
            let year = String(parsed.year);
            if (!yearlySpend[year]) {
                yearlySpend[year] = { fkCash: 0, fkCoins: 0, amzCash: 0 };
            }
            yearlySpend[year].amzCash += o.CashAmount || 0;
        }
    });

    let yearlyRows = Object.keys(yearlySpend)
        .sort((a, b) => b - a)
        .map(year => {
            let fkCash = yearlySpend[year].fkCash || 0;
            let fkCoins = yearlySpend[year].fkCoins || 0;
            let amzCash = yearlySpend[year].amzCash || 0;
            let combinedCash = fkCash + amzCash;
            return `
                <tr>
                    <td class="font-bold">${year}</td>
                    <td style="color:#0369a1;">₹${fkCash.toLocaleString('en-IN')}</td>
                    <td style="color:#d97706;">${fkCoins.toLocaleString('en-IN')} Coins</td>
                    <td style="color:#c2410c;">₹${amzCash.toLocaleString('en-IN')}</td>
                    <td class="font-bold" style="color:#16a34a;">₹${combinedCash.toLocaleString('en-IN')}</td>
                </tr>
            `;
        }).join('');

    let catTotals = {
        "Electronics & Gadgets": 0,
        "Home & Living": 0,
        "Fashion & Apparel": 0,
        "Beauty & Personal Care": 0,
        "Books & Education": 0,
        "Grocery": 0,
        "Others / Miscellaneous": 0
    };
    combinedDelivered.forEach(o => {
        let cat = categorizeItem(o.Item);
        catTotals[cat] = (catTotals[cat] || 0) + o.CashAmount;
    });
    let totalDelCash = combinedDelivered.reduce((sum, o) => sum + o.CashAmount, 0) || 1;
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
                        <div style="background:#16a34a; height:100%; width:${pct}%;"></div>
                    </div>
                </td>
            </tr>
        `;
    }).join('');

    let peakSpendText = peakSpendMonth.amount > 0 
        ? `${peakSpendMonth.label} (₹${peakSpendMonth.amount.toLocaleString('en-IN')})` 
        : 'N/A';
    
    let mostActiveText = mostActiveMonth.count > 0 
        ? `${mostActiveMonth.label} (${mostActiveMonth.count} orders)` 
        : 'N/A';

    const makeCombinedTableRows = (items) => {
        return items.map(o => {
            let storeBadge = o.Store === 'Flipkart' 
                ? `<span style="background:#e0f2fe; color:#0369a1; border:1px solid #bae6fd; padding:2px 6px; border-radius:4px; font-size:8px; font-weight:bold; text-transform:uppercase;">Flipkart</span>`
                : `<span style="background:#fff7ed; color:#c2410c; border:1px solid #ffedd5; padding:2px 6px; border-radius:4px; font-size:8px; font-weight:bold; text-transform:uppercase;">Amazon</span>`;
            
            let dateClean = getStandardizedDateString(o.Date, o.Store);
            
            let coinCell = o.CoinsUsed > 0 ? `${o.CoinsUsed} Coins` : '-';
            let recipientCell = o.Recipient !== 'N/A' ? o.Recipient : '-';
            let orderIdCell = o.OrderId !== 'N/A' ? `<small>${o.OrderId}</small>` : '-';
            
            return `
                <tr>
                    <td>${storeBadge}</td>
                    <td>${dateClean}</td>
                    <td>${orderIdCell}</td>
                    <td class="title-cell" title="${o.Item}">${o.Item}</td>
                    <td>${recipientCell}</td>
                    <td class="center">${coinCell}</td>
                    <td class="right font-bold">₹${o.CashAmount.toLocaleString('en-IN')}</td>
                </tr>
            `;
        }).join('') + `
            <tr class="total-row">
                <td colspan="5" class="right">Total Consolidated Outlay:</td>
                <td class="center" style="color:#d97706;">${fkDelCoins.toLocaleString('en-IN')} Coins</td>
                <td class="right" style="color:#16a34a;">₹${combinedDelCash.toLocaleString('en-IN')}</td>
            </tr>
        `;
    };

    let currentDate = new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

    return `
        <html>
        <head>
            <meta charset="UTF-8">
            <title>Consolidated Spend Statement</title>
            <style>
                body { font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; color: #2c3e50; padding: 20px; font-size: 11px; }
                .header-banner { background: linear-gradient(135deg, #1b3a4b 0%, #232f3e 100%); color: white; padding: 15px 20px; border-radius: 4px; margin-bottom: 20px; display: flex; justify-content: space-between; align-items: center; border-bottom: 4px solid #ff9900; }
                .header-banner h1 { margin: 0; font-size: 20px; font-weight: bold; }
                
                .kpi-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-bottom: 20px; }
                .kpi-card { background-color: #f8f9fa; border: 1px solid #eaeded; padding: 10px; border-radius: 4px; text-align: center; }
                .kpi-label { font-size: 9px; font-weight: bold; color: #7f8c8d; text-transform: uppercase; margin-bottom: 4px; }
                .kpi-val { font-size: 14px; font-weight: bold; }
                .kpi-green { color: #27ae60; }
                .kpi-blue { color: #0369a1; }
                .kpi-orange { color: #c2410c; }
                .kpi-subtext { font-size: 8px; color: #7f8c8d; margin-top: 2px; }

                .dashboard-container { background: #fdfefe; border: 1px solid #d5dbdb; border-radius: 6px; padding: 12px; margin-bottom: 20px; }
                .dashboard-title { margin-top: 0; margin-bottom: 10px; font-size: 13px; color: #1b3a4b; border-bottom: 2px solid #ff9900; padding-bottom: 3px; font-weight: bold; text-transform: uppercase; }
                
                .insights-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-bottom: 12px; }
                .insight-card { background: #f2f4f4; border: 1px solid #eaeded; padding: 8px; border-radius: 4px; text-align: center; }
                .insight-val { font-size: 11px; font-weight: bold; color: #1e293b; }
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
                .title-cell { max-width: 280px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
                .center { text-align: center; } .right { text-align: right; } .font-bold { font-weight: bold; }
                .total-row { background-color: #eaeded !important; font-weight: bold; border-top: 1px solid #1b3a4b; }
                
                .yearly-table th { background-color: #34495e; color: white; }
                
                @media print { body { padding: 0; margin: 0; } @page { size: letter; margin: 0.5in; } }
            </style>
        </head>
        <body>
            <div class="header-banner">
                <h1>Consolidated Financial Spending Statement</h1>
                <span>Report Created: ${currentDate}</span>
            </div>
            
            <div class="kpi-grid">
                <div class="kpi-card"><div class="kpi-label">Combined Net Spent</div><div class="kpi-val kpi-green">₹${combinedDelCash.toLocaleString('en-IN')}</div><div class="kpi-subtext">Multi-Store Total</div></div>
                <div class="kpi-card"><div class="kpi-label">Flipkart Spend</div><div class="kpi-val kpi-blue">₹${fkDelCash.toLocaleString('en-IN')}</div><div class="kpi-subtext">Burned: ${fkDelCoins.toLocaleString('en-IN')} Coins</div></div>
                <div class="kpi-card"><div class="kpi-label">Amazon Spend</div><div class="kpi-val kpi-orange">₹${amzDelCash.toLocaleString('en-IN')}</div><div class="kpi-subtext">Excludes Pay Balances</div></div>
                <div class="kpi-card"><div class="kpi-label">Total Transactions</div><div class="kpi-val">${combinedDelivered.length}</div><div class="kpi-subtext">Executed Orders</div></div>
            </div>

            <div class="dashboard-container">
                <div class="dashboard-title">Unified Shopping Analytics Dashboard</div>
                
                <div class="insights-grid">
                    <div class="insight-card">
                        <div class="kpi-label">Peak Spend Month</div>
                        <div class="insight-val">${peakSpendText}</div>
                        <div class="insight-desc">Combined store monthly peak</div>
                    </div>
                    <div class="insight-card">
                        <div class="kpi-label">Average Order Value</div>
                        <div class="insight-val">₹${avgOrderValue.toLocaleString('en-IN')}</div>
                        <div class="insight-desc">AOV per delivered item</div>
                    </div>
                    <div class="insight-card">
                        <div class="kpi-label">Order Success Rate</div>
                        <div class="insight-val">${successRate}%</div>
                        <div class="insight-desc">Delivered vs. total orders</div>
                    </div>
                    <div class="insight-card">
                        <div class="kpi-label">Most Active Month</div>
                        <div class="insight-val">${mostActiveText}</div>
                        <div class="insight-desc">Combined order frequency</div>
                    </div>
                </div>

                <div class="extremes-grid">
                    <div class="extreme-card">
                        <div class="kpi-label">Highest Costing Purchase</div>
                        <div class="extreme-title" title="${highestCosting ? highestCosting.Item : ''}">${highestCosting ? `[${highestCosting.Store}] ${highestCosting.Item}` : 'N/A'}</div>
                        <div class="extreme-price">₹${highestCosting ? highestCosting.CashAmount.toLocaleString('en-IN') : '0'}</div>
                    </div>
                    <div class="extreme-card">
                        <div class="kpi-label">Lowest Costing Purchase</div>
                        <div class="extreme-title" title="${lowestCosting ? lowestCosting.Item : ''}">${lowestCosting ? `[${lowestCosting.Store}] ${lowestCosting.Item}` : 'N/A'}</div>
                        <div class="extreme-price">₹${lowestCosting ? lowestCosting.CashAmount.toLocaleString('en-IN') : '0'}</div>
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
                <div class="kpi-label" style="margin-bottom: 6px;">Consolidated Yearly Spending Summary</div>
                <table class="yearly-table">
                    <thead>
                        <tr>
                            <th>Year</th>
                            <th>Flipkart Cash</th>
                            <th>Flipkart Coins</th>
                            <th>Amazon Cash</th>
                            <th>Combined Cash</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${yearlyRows}
                    </tbody>
                </table>
                ` : ''}

                <div class="kpi-label" style="margin-bottom: 6px; margin-top: 10px;">Amazon Recipient Delivery Breakdown</div>
                <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: 8px; margin-bottom: 6px;">
                    ${recipientHtml}
                </div>
            </div>

            <h2>Consolidated Transaction Log (Delivered & Kept Purchases)</h2>
            <table>
                <thead>
                    <tr>
                        <th style="width:10%">Store</th>
                        <th style="width:15%">Date</th>
                        <th style="width:20%">Order ID</th>
                        <th style="width:30%">Description</th>
                        <th style="width:10%">Recipient</th>
                        <th style="width:10%;text-align:center">Coins Used</th>
                        <th style="width:10%;text-align:right">Amount</th>
                    </tr>
                </thead>
                <tbody>
                    ${makeCombinedTableRows(combinedDelivered)}
                </tbody>
            </table>
        </body>
        </html>
    `;
}