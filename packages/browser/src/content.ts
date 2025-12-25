// Listen for messages from background script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'getPageContent') {
        const content = document.body.innerText;
        const selection = window.getSelection()?.toString() || '';
        const title = document.title;
        const url = window.location.href;

        sendResponse({
            title,
            url,
            content: content.substring(0, 50000), // Limit payload
            selection
        });
    }

    if (request.action === 'injectText') {
        const activeElement = document.activeElement as HTMLElement;
        if (activeElement && (activeElement.tagName === 'INPUT' || activeElement.tagName === 'TEXTAREA' || activeElement.isContentEditable)) {
            // Simple injection
            if (activeElement.tagName === 'TEXTAREA' || activeElement.tagName === 'INPUT') {
                const el = activeElement as HTMLInputElement | HTMLTextAreaElement;
                const start = el.selectionStart || 0;
                const end = el.selectionEnd || 0;
                const text = el.value;
                el.value = text.substring(0, start) + request.text + text.substring(end);
                el.selectionStart = el.selectionEnd = start + request.text.length;
                // Trigger events
                el.dispatchEvent(new Event('input', { bubbles: true }));
                el.dispatchEvent(new Event('change', { bubbles: true }));
            } else {
                // ContentEditable
                activeElement.innerText += request.text;
                activeElement.dispatchEvent(new Event('input', { bubbles: true }));
            }
            sendResponse({ status: 'injected' });
        } else {
            sendResponse({ status: 'error', message: 'No active input element found.' });
        }
    }
    return true; // Keep channel open
});
