console.log("AIOS Browser Extension Content Script Loaded");

// Listen for messages from background script if needed
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "ping") {
        sendResponse({ status: "pong" });
    }
});
