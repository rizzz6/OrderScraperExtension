(function () {
    if (window.__amazonPayInterceptorHooked) {
        return;
    }
    window.__amazonPayInterceptorHooked = true;
    console.log("%c [Amazon Pay Interceptor] Hooking network requests in MAIN world... ", "color: #9b59b6; font-weight: bold;");

    // Hook Fetch
    const originalFetch = window.fetch;
    window.fetch = async function(...args) {
        const response = await originalFetch.apply(this, args);
        try {
            const clone = response.clone();
            const text = await clone.text();
            if (text.includes('transactionDetails') || text.includes('transactionDetailPageURL')) {
                const json = JSON.parse(text);
                dispatchData(json);
            }
        } catch (e) {}
        return response;
    };

    // Hook XHR
    const originalOpen = XMLHttpRequest.prototype.open;
    const originalSend = XMLHttpRequest.prototype.send;
    
    XMLHttpRequest.prototype.open = function(method, url, ...args) {
        this._url = url;
        return originalOpen.apply(this, [method, url, ...args]);
    };
    
    XMLHttpRequest.prototype.send = function(...args) {
        this.addEventListener('load', function() {
            try {
                const text = this.responseText;
                if (text.includes('transactionDetails') || text.includes('transactionDetailPageURL')) {
                    const json = JSON.parse(text);
                    dispatchData(json);
                }
            } catch (e) {}
        });
        return originalSend.apply(this, args);
    };

    function dispatchData(json) {
        // Dispatch custom DOM event to route data to content script (ISOLATED world)
        const event = new CustomEvent('amazonPayDataIntercepted', { detail: json });
        window.dispatchEvent(event);
    }
})();
