/* global chrome */
import { createNativeSearchService } from "./native-search.js";

const service = createNativeSearchService(chrome);
chrome.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
  service.handle(message, sender).then(sendResponse);
  return true;
});
chrome.alarms.onAlarm.addListener((alarm) => {
  void service.onAlarm(alarm).catch(() => {});
});
chrome.tabs.onRemoved.addListener((tabId) => {
  void service.onTabRemoved(tabId).catch(() => {});
});
