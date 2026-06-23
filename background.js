chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "openCoinsTab") {
        console.log("[Background Service Worker] Opening Coins Activity tab...");
        // Open the coins page in the foreground to prevent browser throttling on scroll/lazy load events
        chrome.tabs.create({
            url: "https://www.flipkart.com/plus/coins-activity",
            active: true
        }, (tab) => {
            chrome.storage.local.set({ coinsScrapingTabId: tab.id });
            sendResponse({ tabId: tab.id });
        });
        return true; // Keep message channel open for async response
    } else if (request.action === "openAmazonPayTab") {
        console.log("[Background Service Worker] Opening Amazon Pay landing tab...");
        chrome.tabs.create({
            url: "https://www.amazon.in/apay/landing/add-money",
            active: true
        }, (tab) => {
            chrome.storage.local.set({ amazonPayScrapingTabId: tab.id });
            sendResponse({ tabId: tab.id });
        });
        return true;
    } else if (request.action === "closeTab") {
        const tabId = sender.tab ? sender.tab.id : null;
        if (tabId) {
            console.log(`[Background Service Worker] Closing tab: ${tabId}`);
            chrome.tabs.remove(tabId);
        }
        sendResponse({ status: "closed" });
    } else if (request.action === "extractionComplete") {
        console.log("[Background Service Worker] Extraction complete. Attempting to open action popup...");
        if (chrome.action && typeof chrome.action.openPopup === "function") {
            chrome.action.openPopup().catch(err => {
                console.warn("[Background Service Worker] Failed to open popup programmatically:", err);
            });
        }
        sendResponse({ status: "popup_triggered" });
    }
    return true;
});

// Watch for tab removal to handle premature manual closure of scraping tabs
chrome.tabs.onRemoved.addListener((tabId) => {
    chrome.storage.local.get(["amazonPayScrapingTabId", "amazonPayScrapingActive", "coinsScrapingTabId", "coinsScrapingActive"], (res) => {
        let updates = {};
        let needUpdate = false;
        if (res.amazonPayScrapingActive && res.amazonPayScrapingTabId === tabId) {
            console.log("[Background Service Worker] Amazon Pay scraping tab closed prematurely.");
            updates.amazonPayScrapingActive = false;
            updates.amazonPayScrapingTabId = null;
            needUpdate = true;
        }
        if (res.coinsScrapingActive && res.coinsScrapingTabId === tabId) {
            console.log("[Background Service Worker] Flipkart Coins scraping tab closed prematurely.");
            updates.coinsScrapingActive = false;
            updates.coinsScrapingTabId = null;
            needUpdate = true;
        }
        if (needUpdate) {
            chrome.storage.local.set(updates);
        }
    });
});
